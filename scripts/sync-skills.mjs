#!/usr/bin/env node
// リポジトリ直下の <name>/SKILL.md と、mods/<name>/.claude-plugin/plugin.json を集め、次のファイルを生成する。
// 依存パッケージは無く、Node.js 18 以降の標準機能だけで動く。
//
//   - <name>/README.md のインストール手順のブロック（マーカーの外の手書きの部分は残す）
//   - .claude-plugin/marketplace.json（Claude Code・Claude Desktop 向けのカタログ。Skill と mod の両方を載せる）
//   - README.md の Skill 一覧のブロックと、mod 一覧のブロック
//
// mod の README.md は生成しない（mod は1つで、入れ方も手で書く）。
//
// あわせて、Skill と mod を公開できる状態かを検査する（name とディレクトリ名の一致など）。改行と見えない文字は、
// リポジトリのすべてのテキストファイルについて調べる。
//
// 使い方:
//   node scripts/sync-skills.mjs           生成したファイルを書き込む
//   node scripts/sync-skills.mjs --check   書き込まずに検査する（CI 用）。ずれや問題があれば終了コード1

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "ngram/skills";
const MARKETPLACE = {
  name: "ngram-skills",
  description: "日本語の技術文書とGitの作業手順のSkill",
  owner: { name: "ngram" },
};

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL_BEGIN = "<!-- skills:readme:begin（scripts/sync-skills.mjs が生成する。このブロックは手で編集しない） -->";
const SKILL_END = "<!-- skills:readme:end -->";
const LIST_BEGIN = "<!-- skills:list:begin（scripts/sync-skills.mjs が生成する。このブロックは手で編集しない） -->";
const LIST_END = "<!-- skills:list:end -->";
const MODS_BEGIN = "<!-- skills:mods:begin（scripts/sync-skills.mjs が生成する。このブロックは手で編集しない） -->";
const MODS_END = "<!-- skills:mods:end -->";
// mod（Claude Code のフックモジュールのプラグイン）を置くディレクトリ。Skill のディレクトリには置かない。
const MODS_DIR = "mods";

// Agent Skills 仕様の name の規則（小文字の英数字とハイフン、先頭と末尾と連続のハイフンは不可）。
const NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
// Skill のディレクトリ直下にあると、Claude Code がプラグインの部品として読み込むディレクトリ。
const PLUGIN_COMPONENT_DIRS = ["bin", "hooks", "agents", "commands", ".claude-plugin"];
// BOM、ゼロ幅文字、双方向制御文字。APM が「hidden characters」として警告する。
const HIDDEN_CHARS = /[\uFEFF\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069]/u;
const JAPANESE = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;
// 体言止めでない終わり方。git-commit スキルの check_message.mjs と同じ判定である。
const PREDICATE_END = /(?:[うくぐすぶむるただ]|ない|無い|しい|です|ます|よい|きい|さい|[多長古早遅重軽高低強弱良広狭近遠]い)$/u;
// 上の形に当たるが、名詞として項目の終わりに来る語。
const NOUN_END = /(?:近く|多く|遠く)$/u;
// 末尾の句点、空白、括弧書き。
const TRAILER = /(?:[。.\s]+|（[^（）]*）|\([^()]*\))$/u;
// license の値の中の、ライセンスの本文のファイル名（LICENSE.txt、LICENSE-MIT.txt など）。
const LICENSE_FILE = /\b(?:LICENSE|COPYING|NOTICE)[\w.-]*/gu;

// frontmatter の最上位の「キー: 値」だけを読む。値は1行のスカラーか、> と | のブロックスカラーか、
// 1段だけ字下げした「キー: 値」の対応表（metadata など）に限る。
function parseFrontmatter(text, path) {
  const lines = text.split("\n");
  if (lines[0] !== "---") throw new Error(`${path}: frontmatter が無い`);
  const end = lines.indexOf("---", 1);
  if (end === -1) throw new Error(`${path}: frontmatter の終わりの --- が無い`);
  const body = lines.slice(1, end);
  const fields = {};
  for (let i = 0; i < body.length; i++) {
    const m = body[i].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    const [, key, raw] = m;
    if (raw === "") {
      // 値が空のキー（metadata など）は、字下げした「キー: 値」の行を対応表として読む。
      const map = {};
      while (i + 1 < body.length && /^\s+\S/.test(body[i + 1])) {
        const mm = body[++i].match(/^\s+([A-Za-z0-9_-]+):\s*(.*)$/);
        if (mm) map[mm[1]] = /^(["']).*\1$/.test(mm[2]) ? mm[2].slice(1, -1) : mm[2];
      }
      fields[key] = map;
    } else if (raw === ">" || raw === "|" || raw === ">-" || raw === "|-") {
      const block = [];
      while (i + 1 < body.length && /^\s+\S/.test(body[i + 1])) block.push(body[++i].trim());
      fields[key] = raw.startsWith(">") ? block.join(" ") : block.join("\n");
    } else if (/^(["']).*\1$/.test(raw)) {
      fields[key] = raw.slice(1, -1);
    } else {
      fields[key] = raw;
    }
  }
  return { fields, raw: body.join("\n") };
}

// git の管理外のディレクトリ（.git、依存パッケージ）は除く。
const IGNORED_DIRS = new Set([".git", "node_modules", "apm_modules"]);

function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return IGNORED_DIRS.has(e.name) ? [] : listFiles(p);
    return [p];
  });
}

// リポジトリのすべてのテキストファイルについて、改行が LF か、見えない文字が無いかを調べる。
// Skill のディレクトリの中身は利用者の環境にコピーされ、APM は見えない文字を警告する。
function textProblems() {
  const problems = [];
  for (const file of listFiles(ROOT)) {
    const buf = readFileSync(file);
    if (buf.includes(0)) continue; // バイナリは見ない
    const content = buf.toString("utf8");
    const rel = relative(ROOT, file);
    if (content.includes("\r")) problems.push(`${rel}: 改行が LF でない`);
    const lineNo = content.split("\n").findIndex((l) => HIDDEN_CHARS.test(l));
    if (lineNo !== -1) problems.push(`${rel}:${lineNo + 1}: 見えない文字（BOM、ゼロ幅文字、双方向制御文字）がある`);
  }
  return problems;
}

function isFile(path) {
  return existsSync(path) && statSync(path).isFile();
}

function findSkills() {
  return readdirSync(ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules")
    .filter((e) => existsSync(join(ROOT, e.name, "SKILL.md")))
    .map((e) => e.name)
    .sort();
}

function inspectSkill(dir) {
  const problems = [];
  const text = readFileSync(join(ROOT, dir, "SKILL.md"), "utf8");
  const { fields, raw } = parseFrontmatter(text.replace(/\r\n/g, "\n"), `${dir}/SKILL.md`);
  const { name, description, compatibility } = fields;

  if (!name) problems.push("name が無い");
  else {
    if (name !== dir) problems.push(`name「${name}」がディレクトリ名「${dir}」と違う`);
    if (!NAME_PATTERN.test(name) || name.length > 64) problems.push(`name「${name}」が Agent Skills の命名規則に合わない`);
  }
  if (!description) problems.push("description が無い");
  else {
    if ([...description].length > 1024) problems.push(`description が1024文字を超えている（${[...description].length}文字）`);
    // skill-creator の quick_validate.py と同じ規則。claude.ai は山括弧を含む Skill を、エラーを出さずに保存しない。
    if (/[<>]/u.test(description)) problems.push("description に山括弧（< か >）がある。claude.ai に入れられないので、括弧などに書き換える");
    // 最初の文は README の Skill 一覧の表のセルになる。表のセルは体言止めにする（japanese-tech-writing の「表のセルの書き方」）。
    const ending = tableCellEnding(firstSentence(description));
    if (ending) problems.push(`description の最初の文が体言止めになっていない（「…${ending}」で終わる）。README の Skill 一覧の表のセルになるので、体言止めにする`);
  }
  if (compatibility && [...compatibility].length > 500) problems.push("compatibility が500文字を超えている");
  if (compatibility) {
    const ending = tableCellEnding(compatibility);
    if (ending) problems.push(`compatibility が体言止めになっていない（「…${ending}」で終わる）。README の Skill 一覧の表のセルになるので、体言止めにする（「Node.js 18以降が必要」など）`);
  }
  for (const file of fields.license?.match(LICENSE_FILE) ?? []) {
    if (!isFile(join(ROOT, dir, file))) problems.push(`license に書いたファイル「${file}」が Skill のディレクトリに無い`);
  }
  // Claude Code は、Skill の本文の $ARGUMENTS と、ドル記号に数字が続く形（シェルの位置引数と同じ形）を、渡した引数で置き換える。
  // シェルの位置引数のつもりで書くと、引数の値に変わる。波括弧で囲んだ形（\${1}）は置き換わらない。
  const positional = /\$\d/u.exec(text);
  if (positional) {
    const line = text.slice(0, positional.index).split("\n").length;
    problems.push(`SKILL.md の${line}行目に「${positional[0]}」がある。Claude Code が引数で置き換えるので、波括弧で囲むか、書き換える`);
  }
  if (/^\s+github-/m.test(raw)) problems.push("gh skill install が書き込む metadata.github-* が残っている。導入したコピーではなく原本を置く");
  const claudeAi = typeof fields.metadata === "object" ? fields.metadata["claude-ai"] : undefined;
  if (claudeAi !== undefined && claudeAi !== "unsupported") {
    problems.push(`metadata.claude-ai は unsupported だけを書ける（「${claudeAi}」になっている）`);
  }

  for (const sub of PLUGIN_COMPONENT_DIRS) {
    if (existsSync(join(ROOT, dir, sub))) problems.push(`${sub}/ がある。Claude Code のプラグインの部品として読み込まれる`);
  }
  return {
    dir,
    name: name ?? dir,
    description: description ?? "",
    compatibility,
    license: fields.license,
    claudeAiUnsupported: claudeAi === "unsupported",
    problems,
  };
}

function findMods() {
  const dir = join(ROOT, MODS_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, ".claude-plugin", "plugin.json")))
    .map((e) => e.name)
    .sort();
}

// mod の plugin.json を読み、公開できる状態かを検査する。
function inspectMod(dir) {
  const problems = [];
  const rel = `${MODS_DIR}/${dir}`;
  let manifest = {};
  try {
    manifest = JSON.parse(readFileSync(join(ROOT, MODS_DIR, dir, ".claude-plugin", "plugin.json"), "utf8"));
  } catch (e) {
    problems.push(`.claude-plugin/plugin.json を JSON として読めない（${e.message}）`);
  }
  const { name, description, license } = manifest;
  if (!name) problems.push("plugin.json に name が無い");
  else {
    if (name !== dir) problems.push(`plugin.json の name「${name}」がディレクトリ名「${dir}」と違う`);
    if (!NAME_PATTERN.test(name) || name.length > 64) problems.push(`plugin.json の name「${name}」が命名規則に合わない`);
  }
  if (!description) problems.push("plugin.json に description が無い");
  else {
    const ending = tableCellEnding(firstSentence(description));
    if (ending) problems.push(`plugin.json の description の最初の文が体言止めになっていない（「…${ending}」で終わる）。README の mod 一覧の表のセルになるので、体言止めにする`);
  }
  if (!license) problems.push("plugin.json に license が無い");
  return { dir, rel, name: name ?? dir, description: description ?? "", license, problems };
}

// 説明文の最初の文。マーケットプレイスと一覧の短い説明に使う。1行の説明なので、末尾の句点は付けない。
function firstSentence(text) {
  const i = text.indexOf("。");
  return i === -1 ? text : text.slice(0, i);
}

// 体言止めでなければ、終わりの数文字を返す。git-commit スキルの check_message.mjs と同じ関数である。
function predicateEnding(text) {
  let s = text;
  for (let prev = null; s !== prev; ) {
    prev = s;
    s = s.replace(TRAILER, "");
  }
  if (!PREDICATE_END.test(s) || NOUN_END.test(s)) return null;
  return [...s].slice(-3).join("");
}

function tableCellEnding(text) {
  return JAPANESE.test(text) ? predicateEnding(text) : null;
}

// README の claude.ai の節。frontmatter の metadata に claude-ai: unsupported があるSkillは、サポート外と案内する。
function claudeAiSection(s) {
  const head = ["### claude.ai（Cowork・クラウドセッション）", ""];
  if (s.claudeAiUnsupported) {
    return [
      ...head,
      "このSkillはclaude.aiのサポート外で、リリースに`.skill`を添付しない。手元のClaude Codeには、ほかの経路で入れる。",
      "",
    ];
  }
  return [
    ...head,
    `[最新のリリース](https://github.com/${REPO}/releases/latest)に添付した\`${s.name}.skill\`を、claude.aiに入れる。最新版は次のURLで取得できる。`,
    "",
    "```text",
    `https://github.com/${REPO}/releases/latest/download/${s.name}.skill`,
    "```",
    "",
    "入れ方は次の2つ。",
    "",
    "- Claudeのセッションで、Claudeにこの`.skill`をファイルとして渡してもらい、ファイルのカードの「Save skill」を押す",
    "- claude.aiのCustomize > Skillsで「+」→「Create skill」→「Upload a skill」の順に進んでアップロードする。`.skill`を選べないときは、拡張子を`.zip`に変える（中身はZIP）",
    "",
    "claude.aiに入れたSkillは、Coworkとクラウドセッション、claude.aiにログインした手元のClaude Codeにも同期される。更新するときは、新しい版の`.skill`を同じ方法で入れ直す。",
    "",
  ];
}

function skillReadmeBlock(s) {
  const lines = [
    SKILL_BEGIN,
    `# ${s.name}`,
    "",
    `> ${s.description}`,
    "",
  ];
  if (s.compatibility) lines.push(`必要なもの：${s.compatibility}`, "");
  lines.push(
    "## インストール",
    "",
    "### Claude Code・Claude Desktop（プラグイン）",
    "",
    "```text",
    `/plugin marketplace add ${REPO}`,
    `/plugin install ${s.name}@${MARKETPLACE.name}`,
    "```",
    "",
    `導入後は\`/${s.name}:${s.name}\`で呼び出せる。`,
    "",
    ...claudeAiSection(s),
    "### GitHub CLI（gh skill、gh 2.90以降）",
    "",
    "```bash",
    `gh skill install ${REPO} ${s.name} --agent claude-code --scope user`,
    "```",
    "",
    "`--agent`を変えると、GitHub Copilot（`github-copilot`）、Codex（`codex`）、Cursor（`cursor`）などに入る。",
    "",
    "### APM",
    "",
    "```bash",
    `apm install -g ${REPO}/${s.dir}`,
    "```",
    "",
    "プロジェクトに入れるときは`-g`を外す。`apm.yml`に書くときは次のとおり。",
    "",
    "```yaml",
    "dependencies:",
    "  apm:",
    `    - ${REPO}/${s.dir}`,
    "```",
    "",
    "### skills CLI（npx skills）",
    "",
    "```bash",
    `npx skills add ${REPO} --skill ${s.name}`,
    "```",
    "",
    "### フォルダを直接コピーする",
    "",
    "```bash",
    `npx degit ${REPO}/${s.dir} ~/.claude/skills/${s.name}`,
    "```",
    "",
    "Skillの内容は[SKILL.md](./SKILL.md)にある。",
    SKILL_END,
  );
  return lines.join("\n");
}

// 一覧の表のライセンスの列。license の値に書いたファイル名を、Skill のディレクトリのファイルへのリンクにする。
// ファイルを書いていない MIT は、ルートの LICENSE（MIT）へのリンクにする。
function licenseCell(s) {
  if (!s.license) return "未設定";
  if (s.license === "MIT" && isFile(join(ROOT, "LICENSE"))) return "[MIT](LICENSE)";
  return s.license.replace(LICENSE_FILE, (file) => (isFile(join(ROOT, s.dir, file)) ? `[${file}](${s.dir}/${file})` : file));
}

function listBlock(skills) {
  const rows = skills.map((s) =>
    `| [${s.name}](${s.dir}/) | ${firstSentence(s.description)} | ${s.compatibility ?? "なし"} | ${licenseCell(s)} |`,
  );
  return [
    LIST_BEGIN,
    "| Skill | 説明 | 必要なもの | ライセンス |",
    "| --- | --- | --- | --- |",
    ...rows,
    LIST_END,
  ].join("\n");
}

// README の mod 一覧の表。説明とライセンスは plugin.json から取る。必要なものは、mod の README に手で書く。
function modsBlock(mods) {
  const rows = mods.map((m) => {
    const license = m.license === "MIT" && isFile(join(ROOT, "LICENSE")) ? "[MIT](LICENSE)" : (m.license ?? "未設定");
    return `| [${m.name}](${m.rel}/) | ${firstSentence(m.description)} | ${license} |`;
  });
  return [MODS_BEGIN, "| mod | 説明 | ライセンス |", "| --- | --- | --- |", ...rows, MODS_END].join("\n");
}

function marketplaceJson(skills, mods) {
  const catalog = {
    ...MARKETPLACE,
    plugins: [
      ...skills.map((s) => ({
        name: s.name,
        source: `./${s.dir}`,
        description: firstSentence(s.description),
      })),
      ...mods.map((m) => ({
        name: m.name,
        source: `./${m.rel}`,
        description: firstSentence(m.description),
      })),
    ],
  };
  return `${JSON.stringify(catalog, null, 2)}\n`;
}

// マーカーで囲んだブロックを差し替える。マーカーが無ければ、先頭（README.md は見出しの後）に置く。
function splice(existing, block, begin, end) {
  if (existing === null || existing.trim() === "") return `${block}\n`;
  const b = existing.indexOf(begin);
  const e = existing.indexOf(end);
  if (b !== -1 && e !== -1) return existing.slice(0, b) + block + existing.slice(e + end.length);
  return `${block}\n\n${existing.trimStart()}`;
}

function main(argv) {
  const check = argv.includes("--check");
  const skills = findSkills().map(inspectSkill);
  const mods = findMods().map(inspectMod);
  const outputs = new Map();
  const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : null);

  for (const s of skills) {
    const p = join(ROOT, s.dir, "README.md");
    outputs.set(p, splice(read(p), skillReadmeBlock(s), SKILL_BEGIN, SKILL_END));
  }
  outputs.set(join(ROOT, ".claude-plugin", "marketplace.json"), marketplaceJson(skills, mods));
  const rootReadme = join(ROOT, "README.md");
  if (read(rootReadme)?.includes(LIST_BEGIN)) {
    let readme = splice(read(rootReadme), listBlock(skills), LIST_BEGIN, LIST_END);
    if (readme.includes(MODS_BEGIN)) readme = splice(readme, modsBlock(mods), MODS_BEGIN, MODS_END);
    else if (mods.length > 0) {
      console.error(`README.md に mod 一覧のマーカーが無い: ${MODS_BEGIN}`);
      return 1;
    }
    outputs.set(rootReadme, readme);
  } else {
    console.error(`README.md に一覧のマーカーが無い: ${LIST_BEGIN}`);
    return 1;
  }

  let failed = false;
  for (const p of textProblems()) {
    console.error(p);
    failed = true;
  }
  for (const s of skills) {
    for (const p of s.problems) {
      console.error(`${s.dir}: ${p}`);
      failed = true;
    }
  }
  for (const m of mods) {
    for (const p of m.problems) {
      console.error(`${m.rel}: ${p}`);
      failed = true;
    }
  }
  for (const [path, content] of outputs) {
    if (read(path) === content) continue;
    const rel = relative(ROOT, path);
    if (check) {
      console.error(`${rel}: 生成した内容と違う（node scripts/sync-skills.mjs を実行する）`);
      failed = true;
    } else {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
      console.log(`更新: ${rel}`);
    }
  }
  if (failed) return 1;
  console.log(`${skills.length}個のSkillを確かめた: ${skills.map((s) => s.name).join(", ")}`);
  if (mods.length > 0) console.log(`${mods.length}個のmodを確かめた: ${mods.map((m) => m.name).join(", ")}`);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
