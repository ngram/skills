#!/usr/bin/env node
// リポジトリ直下の <name>/SKILL.md を集め、frontmatter から次のファイルを生成する。
// 依存パッケージは無く、Node.js 18 以降の標準機能だけで動く。
//
//   - <name>/README.md のインストール手順のブロック（マーカーの外の手書きの部分は残す）
//   - .claude-plugin/marketplace.json（Claude Code・Claude Desktop 向けのカタログ）
//   - README.md の Skill 一覧のブロック
//
// あわせて、Skill を公開できる状態かを検査する（name とディレクトリ名の一致など）。改行と見えない文字は、
// リポジトリのすべてのテキストファイルについて調べる。
//
// 使い方:
//   node scripts/sync-skills.mjs           生成したファイルを書き込む
//   node scripts/sync-skills.mjs --check   書き込まずに検査する（CI 用）。ずれや問題があれば終了コード1

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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

// Agent Skills 仕様の name の規則（小文字の英数字とハイフン、先頭と末尾と連続のハイフンは不可）。
const NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
// Skill のディレクトリ直下にあると、Claude Code がプラグインの部品として読み込むディレクトリ。
const PLUGIN_COMPONENT_DIRS = ["bin", "hooks", "agents", "commands", ".claude-plugin"];
// BOM、ゼロ幅文字、双方向制御文字。APM が「hidden characters」として警告する。
const HIDDEN_CHARS = /[\uFEFF\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069]/u;

// frontmatter の最上位の「キー: 値」だけを読む。値は1行のスカラーか、> と | のブロックスカラーに限る。
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
    if (raw === ">" || raw === "|" || raw === ">-" || raw === "|-") {
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
  else if ([...description].length > 1024) problems.push(`description が1024文字を超えている（${[...description].length}文字）`);
  if (compatibility && [...compatibility].length > 500) problems.push("compatibility が500文字を超えている");
  if (/^\s+github-/m.test(raw)) problems.push("gh skill install が書き込む metadata.github-* が残っている。導入したコピーではなく原本を置く");

  for (const sub of PLUGIN_COMPONENT_DIRS) {
    if (existsSync(join(ROOT, dir, sub))) problems.push(`${sub}/ がある。Claude Code のプラグインの部品として読み込まれる`);
  }
  return { dir, name: name ?? dir, description: description ?? "", compatibility, license: fields.license, problems };
}

// 説明文の最初の文。マーケットプレイスと一覧の短い説明に使う。
function firstSentence(text) {
  const i = text.indexOf("。");
  return i === -1 ? text : text.slice(0, i + 1);
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
    "### claude.ai（Cowork・クラウドセッション）",
    "",
    `[最新のリリース](https://github.com/${REPO}/releases/latest)に添付した\`${s.name}.zip\`をダウンロードし、claude.aiのCustomize > Skillsで「+」→「Create skill」→「Upload a skill」の順に進んでアップロードする。最新版のZIPは次のURLでも取得できる。`,
    "",
    "```text",
    `https://github.com/${REPO}/releases/latest/download/${s.name}.zip`,
    "```",
    "",
    "claude.aiに入れたSkillは、Coworkとクラウドセッション、claude.aiにログインした手元のClaude Codeにも同期される。更新するときは、新しい版のZIPをアップロードし直す。",
    "",
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

function listBlock(skills) {
  const rows = skills.map((s) =>
    `| [${s.name}](${s.dir}/) | ${firstSentence(s.description)} | ${s.compatibility ?? "なし"} | ${s.license ?? "未設定"} |`,
  );
  return [
    LIST_BEGIN,
    "| Skill | 説明 | 必要なもの | ライセンス |",
    "| --- | --- | --- | --- |",
    ...rows,
    LIST_END,
  ].join("\n");
}

function marketplaceJson(skills) {
  const catalog = {
    ...MARKETPLACE,
    plugins: skills.map((s) => ({
      name: s.name,
      source: `./${s.dir}`,
      description: firstSentence(s.description),
    })),
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
  const outputs = new Map();
  const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : null);

  for (const s of skills) {
    const p = join(ROOT, s.dir, "README.md");
    outputs.set(p, splice(read(p), skillReadmeBlock(s), SKILL_BEGIN, SKILL_END));
  }
  outputs.set(join(ROOT, ".claude-plugin", "marketplace.json"), marketplaceJson(skills));
  const rootReadme = join(ROOT, "README.md");
  if (read(rootReadme)?.includes(LIST_BEGIN)) {
    outputs.set(rootReadme, splice(read(rootReadme), listBlock(skills), LIST_BEGIN, LIST_END));
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
  return 0;
}

process.exitCode = main(process.argv.slice(2));
