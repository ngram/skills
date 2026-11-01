// git-commit/scripts/check_spelling.mjs の動作確認。node --test tests/*.test.mjs で実行する。
// typos が無ければ、typos が要るテストは飛ばす。CI では REQUIRE_TYPOS=1 にして、黙って飛ばされないようにする。
// 仕込む誤字は、このファイル自体が typos の指摘に当たらないよう、実行時に組み立てる。

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "git-commit", "scripts", "check_spelling.mjs");
const ROOT = mkdtempSync(join(tmpdir(), "check-spelling-test-"));
// 利用者の git の設定（diff.relative、フックなど）に左右されないよう、空の設定で動かす。
const GITCONFIG = join(ROOT, "gitconfig");
writeFileSync(GITCONFIG, "");
const BASE_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: GITCONFIG,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

const TYPO_RECEIVE = ["rec", "ieve"].join("");
const TYPO_SEPARATE = ["sepe", "rate"].join("");
const TYPO_ENVIRONMENT = ["envi", "roment"].join("");

const HAS_TYPOS = spawnSync("typos", ["--version"]).error?.code !== "ENOENT";
const skip = HAS_TYPOS ? false : "typos が見つからない";

let count = 0;

function git(cwd, args, input) {
  const r = spawnSync("git", args, { cwd, env: BASE_ENV, encoding: "utf8", input });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}

function newRepo() {
  const dir = join(ROOT, `repo-${++count}`);
  mkdirSync(dir);
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "core.autocrlf", "false"]);
  return dir;
}

// files の値が null のファイルは消す。
function write(dir, files) {
  for (const [path, content] of Object.entries(files)) {
    const p = join(dir, path);
    if (content === null) rmSync(p);
    else {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, content);
    }
  }
}

function stage(dir, files) {
  write(dir, files);
  git(dir, ["add", "-A"]);
}

function commit(dir, files) {
  stage(dir, files);
  git(dir, ["commit", "-q", "--no-verify", "-m", "c"]);
}

function run(cwd, args, env = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd, env: { ...BASE_ENV, ...env }, encoding: "utf8" });
}

// 一時ディレクトリの場所を変える環境変数。
function tmpEnv(dir) {
  return { TMPDIR: dir, TEMP: dir, TMP: dir };
}

// 出力の、分類（[今回の変更の行] など）ごとの部分。
function section(stdout, name) {
  const m = stdout.match(new RegExp(`^\\[${name}\\][^\\n]*\\n([\\s\\S]*?)(?=^\\[|^\\d+ 件の指摘|(?![\\s\\S]))`, "mu"));
  return m ? m[1] : "";
}

if (process.env.REQUIRE_TYPOS === "1") {
  test("REQUIRE_TYPOS=1 のときは typos が要る", () => {
    assert.ok(HAS_TYPOS, "typos が見つからない");
  });
}

test("使い方に合わない引数は終了コード2", () => {
  assert.equal(run(ROOT, []).status, 2);
  assert.equal(run(ROOT, ["message"]).status, 2);
  assert.equal(run(ROOT, ["staged", "x"]).status, 2);
});

test("typos が無ければ、確認を飛ばして終了コード0", () => {
  const r = run(ROOT, ["staged"], { PATH: "", Path: "" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /typosが見つからないため、スペルの確認を飛ばした/);
});

test("message: 誤字のある下書きは終了コード1で、下書きのパスと行を示す", { skip }, () => {
  const draft = join(ROOT, "draft-1.md");
  writeFileSync(draft, `fix: 案内の追加\n\n- requestを${TYPO_RECEIVE}しない\n`);
  const r = run(ROOT, ["message", draft]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.ok(r.stdout.includes(`${draft}:3: \`${TYPO_RECEIVE}\``), r.stdout);
  assert.ok(r.stdout.includes(`- requestを${TYPO_RECEIVE}しない`), r.stdout);
});

test("message: 誤字の無い下書きは終了コード0", { skip }, () => {
  const draft = join(ROOT, "draft-2.md");
  writeFileSync(draft, "fix: 案内の追加\n\n- requestをreceiveしない\n");
  const r = run(ROOT, ["message", draft]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("message: リポジトリの外の下書きにも、リポジトリ直下のステージした設定が効く", { skip }, () => {
  const repo = newRepo();
  commit(repo, { "_typos.toml": `[default.extend-words]\n${TYPO_SEPARATE} = "${TYPO_SEPARATE}"\n\n[type.md.extend-words]\n${TYPO_ENVIRONMENT} = "${TYPO_ENVIRONMENT}"\n` });
  const md = join(ROOT, "draft-3.md");
  const txt = join(ROOT, "draft-3.txt");
  const body = `fix: ${TYPO_SEPARATE}と${TYPO_ENVIRONMENT}\n`;
  writeFileSync(md, body);
  writeFileSync(txt, body);
  const r = run(repo, ["message", md]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  // [type.md] の設定は、.md の下書きにだけ効く。
  const t = run(repo, ["message", txt]);
  assert.equal(t.status, 1, t.stdout);
  assert.ok(t.stdout.includes(`\`${TYPO_ENVIRONMENT}\``));
  assert.ok(!t.stdout.includes(`\`${TYPO_SEPARATE}\``));
});

test("staged: 足した行、変更していない行、ファイル名に分けて、行の中身とファイルの種類を示す", { skip }, () => {
  const repo = newRepo();
  commit(repo, { "a.md": `${TYPO_RECEIVE} old\nclean\n` });
  stage(repo, {
    "a.md": `${TYPO_RECEIVE} old\nclean\nnew ${TYPO_ENVIRONMENT}\n++ ${TYPO_SEPARATE}\n`,
    "b.ts": `// ${TYPO_RECEIVE} the data\nconst x = 1;\n`,
    [`${TYPO_SEPARATE}_list.txt`]: "x\n",
  });
  const r = run(repo, ["staged"]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const added = section(r.stdout, "今回の変更の行");
  assert.ok(added.includes(`a.md:3（文書）: \`${TYPO_ENVIRONMENT}\``), r.stdout);
  assert.ok(added.includes(`a.md:4（文書）: \`${TYPO_SEPARATE}\``), r.stdout);
  assert.ok(added.includes(`b.ts:1（ソースコード）: \`${TYPO_RECEIVE}\``), r.stdout);
  assert.ok(added.includes(`// ${TYPO_RECEIVE} the data`), r.stdout);
  const old = section(r.stdout, "変更していない行");
  assert.ok(old.includes(`a.md:1（文書）: \`${TYPO_RECEIVE}\``), r.stdout);
  assert.ok(section(r.stdout, "ファイル名").includes(`${TYPO_SEPARATE}_list.txt（文書）`), r.stdout);
});

test("staged: ステージした内容を確かめ、作業ツリーだけの変更は見ない", { skip }, () => {
  const repo = newRepo();
  commit(repo, { "keep.md": "ok\n" });
  stage(repo, {
    "fixed.md": `${TYPO_RECEIVE}\n`,
    "later.md": "ok\n",
    "deleted.md": `${TYPO_SEPARATE}\n`,
    "binary.md": `${TYPO_ENVIRONMENT}\n`,
  });
  write(repo, {
    "fixed.md": "receive\n",
    "later.md": `${TYPO_RECEIVE}\n`,
    "deleted.md": null,
    "binary.md": Buffer.from([0, 1, 2, 0, 255]),
  });
  const r = run(repo, ["staged"]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.ok(r.stdout.includes(`fixed.md:1（文書、一部だけステージ）: \`${TYPO_RECEIVE}\``), r.stdout);
  assert.ok(!r.stdout.includes("later.md"), r.stdout);
  assert.ok(r.stdout.includes(`deleted.md:1（文書、一部だけステージ）: \`${TYPO_SEPARATE}\``), r.stdout);
  assert.ok(r.stdout.includes(`binary.md:1（文書、一部だけステージ）: \`${TYPO_ENVIRONMENT}\``), r.stdout);
});

test("staged: 設定の除外と種類ごとの設定が効き、ステージしていない設定の変更は効かない", { skip }, () => {
  const repo = newRepo();
  commit(repo, {
    "_typos.toml": `[files]\nextend-exclude = ["vendor/"]\n\n[type.md.extend-words]\n${TYPO_SEPARATE} = "${TYPO_SEPARATE}"\n`,
  });
  stage(repo, {
    "vendor/x.md": `${TYPO_RECEIVE}\n`,
    "a.md": `${TYPO_SEPARATE}\n`,
    "a.txt": `${TYPO_SEPARATE}\n`,
    "b.md": `${TYPO_ENVIRONMENT}\n`,
  });
  write(repo, { "_typos.toml": `[default.extend-words]\n${TYPO_ENVIRONMENT} = "${TYPO_ENVIRONMENT}"\n` });
  const r = run(repo, ["staged"]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.ok(!r.stdout.includes("vendor/x.md"), r.stdout);
  assert.ok(!r.stdout.includes("a.md"), r.stdout);
  assert.ok(r.stdout.includes(`a.txt:1（文書）: \`${TYPO_SEPARATE}\``), r.stdout);
  assert.ok(r.stdout.includes(`b.md:1（文書）: \`${TYPO_ENVIRONMENT}\``), r.stdout);
});

test("staged: サブディレクトリの設定はそのディレクトリのファイルに効き、親の設定は引き継がない", { skip }, () => {
  const repo = newRepo();
  stage(repo, {
    "_typos.toml": `[default.extend-words]\n${TYPO_RECEIVE} = "${TYPO_RECEIVE}"\n`,
    "sub/_typos.toml": `[default.extend-words]\n${TYPO_SEPARATE} = "${TYPO_SEPARATE}"\n`,
    "top.md": `${TYPO_RECEIVE} ${TYPO_SEPARATE}\n`,
    "sub/a.md": `${TYPO_RECEIVE} ${TYPO_SEPARATE}\n`,
  });
  const r = run(repo, ["staged"]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.ok(r.stdout.includes(`top.md:1（文書）: \`${TYPO_SEPARATE}\``), r.stdout);
  assert.ok(!r.stdout.includes(`top.md:1（文書）: \`${TYPO_RECEIVE}\``), r.stdout);
  assert.ok(r.stdout.includes(`sub/a.md:1（文書）: \`${TYPO_RECEIVE}\``), r.stdout);
  assert.ok(!r.stdout.includes(`sub/a.md:1（文書）: \`${TYPO_SEPARATE}\``), r.stdout);
});

test("staged: extend-ignore-re に登録した名前は示さず、同じファイルのコメントの誤字は示す", { skip }, () => {
  const repo = newRepo();
  stage(repo, {
    "_typos.toml": `[default]\nextend-ignore-re = ['service\\.${TYPO_RECEIVE}', '${TYPO_SEPARATE}-list', '${TYPO_RECEIVE}Data']\n`,
    [`${TYPO_SEPARATE}-list.ts`]: `cfg["service.${TYPO_RECEIVE}"];\n${TYPO_RECEIVE}Data();\n// ${TYPO_RECEIVE} the data\n`,
  });
  const r = run(repo, ["staged"]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.equal(r.stdout.match(/^\S.*（ソースコード）: /gmu)?.length, 1, r.stdout);
  assert.ok(r.stdout.includes(`${TYPO_SEPARATE}-list.ts:3（ソースコード）: \`${TYPO_RECEIVE}\``), r.stdout);
});

test("staged: Cargo.toml と pyproject.toml の typos の設定が効く", { skip }, () => {
  const repo = newRepo();
  stage(repo, {
    "Cargo.toml": `[package]\nname = "c"\nversion = "0.1.0"\n\n[package.metadata.typos.default.extend-words]\n${TYPO_RECEIVE} = "${TYPO_RECEIVE}"\n`,
    "a.md": `${TYPO_RECEIVE}\n`,
    "py/pyproject.toml": `[tool.typos.default.extend-words]\n${TYPO_SEPARATE} = "${TYPO_SEPARATE}"\n`,
    "py/b.md": `${TYPO_SEPARATE}\n`,
  });
  const r = run(repo, ["staged"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("staged: 通常のファイルだけを確かめ、シンボリックリンクから通常のファイルへの変更は確かめる", { skip }, () => {
  const repo = newRepo();
  // ファイルシステムにシンボリックリンクを作らずに、インデックスにだけ置く。Windows でも動かすため。
  const target = git(repo, ["hash-object", "-w", "--stdin"], `${TYPO_RECEIVE}\n`);
  const head = git(repo, ["commit-tree", git(repo, ["write-tree"]), "-m", "empty"]);
  git(repo, ["update-index", "--add", "--cacheinfo", `120000,${target},link`]);
  git(repo, ["update-index", "--add", "--cacheinfo", `120000,${target},retyped`]);
  git(repo, ["commit", "-q", "--no-verify", "-m", "links"]);
  git(repo, ["update-index", "--add", "--cacheinfo", `120000,${git(repo, ["hash-object", "-w", "--stdin"], `${TYPO_SEPARATE}\n`)},link`]);
  git(repo, ["update-index", "--add", "--cacheinfo", `160000,${head},sub`]);
  git(repo, ["update-index", "--cacheinfo", `100644,${git(repo, ["hash-object", "-w", "--stdin"], `${TYPO_ENVIRONMENT}\n`)},retyped`]);
  const r = run(repo, ["staged"]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  // インデックスにだけ置いたので、作業ツリーとの差があり、一部だけステージした印も付く。
  assert.ok(r.stdout.includes(`retyped:1（ソースコード、一部だけステージ）: \`${TYPO_ENVIRONMENT}\``), r.stdout);
  assert.ok(!r.stdout.includes(`\`${TYPO_SEPARATE}\``), r.stdout);
  assert.ok(!r.stdout.match(/^sub/mu), r.stdout);
});

test("staged: smudge フィルター、textconv、-diff、git replace の影響を受けない", { skip }, () => {
  const repo = newRepo();
  const helper = join(ROOT, `helper-${count}.mjs`);
  // smudge なら綴りを直し、textconv なら行を2つ足す。どちらも、呼ばれれば結果が変わる。
  writeFileSync(helper, [
    "import { readFileSync } from 'node:fs';",
    "const [mode, file] = process.argv.slice(2);",
    `const fix = (s) => s.replaceAll('${TYPO_RECEIVE}', 'receive').replaceAll('${TYPO_SEPARATE}', 'separate');`,
    "if (mode === 'smudge') process.stdout.write(fix(readFileSync(0, 'utf8')));",
    "else process.stdout.write('extra\\nextra\\n' + fix(readFileSync(file, 'utf8')));",
    "",
  ].join("\n"));
  const node = process.execPath.replace(/\\/gu, "/");
  const h = helper.replace(/\\/gu, "/");
  git(repo, ["config", "filter.fix.smudge", `"${node}" "${h}" smudge`]);
  git(repo, ["config", "diff.fix.textconv", `"${node}" "${h}" textconv`]);
  commit(repo, { ".gitattributes": "*.md filter=fix diff=fix\n*.txt -diff\n", "a.md": "one\n", "b.txt": "one\n", "c.md": "one\n" });
  stage(repo, { "a.md": `one\n${TYPO_RECEIVE}\n`, "b.txt": `one\n${TYPO_SEPARATE}\n`, "c.md": `one\n${TYPO_ENVIRONMENT}\n` });
  const clean = git(repo, ["hash-object", "-w", "--stdin"], "one\nenvironment\n");
  git(repo, ["replace", git(repo, ["rev-parse", ":c.md"]), clean]);
  const r = run(repo, ["staged"]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const added = section(r.stdout, "今回の変更の行");
  assert.ok(added.includes(`a.md:2（文書）: \`${TYPO_RECEIVE}\``), r.stdout);
  assert.ok(added.includes(`b.txt:2（文書）: \`${TYPO_SEPARATE}\``), r.stdout);
  assert.ok(added.includes(`c.md:2（文書）: \`${TYPO_ENVIRONMENT}\``), r.stdout);
});

test("staged: 一時ディレクトリの親にある typos の設定は効かず、終わったあと一時ディレクトリは残らない", { skip }, () => {
  const repo = newRepo();
  const parent = join(ROOT, `tmp-${count}`);
  mkdirSync(parent);
  writeFileSync(join(parent, "_typos.toml"), "[default]\ncheck-file = false\n");
  stage(repo, { "a.md": `${TYPO_RECEIVE}\n` });
  const r = run(repo, ["staged"], tmpEnv(parent));
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.ok(r.stdout.includes(`a.md:1（文書）: \`${TYPO_RECEIVE}\``), r.stdout);
  assert.deepEqual(readdirSync(parent), ["_typos.toml"]);
});

test("staged: 日本語のファイル名を正しいパスで示す", { skip }, () => {
  const repo = newRepo();
  stage(repo, { "文書/説明.md": `${TYPO_RECEIVE}\n` });
  const r = run(repo, ["staged"]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.ok(r.stdout.includes(`文書/説明.md:1（文書）: \`${TYPO_RECEIVE}\``), r.stdout);
});

test("staged: ステージしたファイルが無い、または削除だけなら終了コード0", { skip }, () => {
  const repo = newRepo();
  const none = run(repo, ["staged"]);
  assert.equal(none.status, 0, none.stdout + none.stderr);
  assert.match(none.stdout, /確認するファイルがありません/);
  commit(repo, { "a.md": `${TYPO_RECEIVE}\n` });
  stage(repo, { "a.md": null });
  const deleted = run(repo, ["staged"]);
  assert.equal(deleted.status, 0, deleted.stdout + deleted.stderr);
});

test("staged: リポジトリの外では終了コード2", { skip }, () => {
  const outside = mkdtempSync(join(tmpdir(), "check-spelling-outside-"));
  const r = run(outside, ["staged"], { GIT_CEILING_DIRECTORIES: dirname(outside) });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  rmSync(outside, { recursive: true, force: true });
});

test("typos が設定ファイルの誤りで失敗したら終了コード2", { skip }, () => {
  const repo = newRepo();
  stage(repo, { "_typos.toml": "[default.extend-words]\nbad.key = \"x\"\n", "a.md": "ok\n" });
  const r = run(repo, ["staged"]);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /typos が終了コード 78/);
});
