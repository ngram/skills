#!/usr/bin/env node
// ステージした内容とメッセージの下書きの綴りを、typos で確かめる。依存パッケージは無く、Node.js 18 以降の標準機能だけで動く。
//
// 使い方:
//   node check_spelling.mjs staged
//   node check_spelling.mjs message <下書きのファイル>
//
// staged:  ステージした通常のファイル（モード 100644、100755）を、インデックスから一時ディレクトリに書き出して確かめる。
//          作業ツリーのファイルは読まないので、ステージした内容そのものが確かめられる。
//          指摘は「今回の変更の行」「変更していない行」「ファイル名」に分けて、行の中身とファイルの種類（文書かソースコードか）を添えて示す。
// message: 下書きを、リポジトリ直下の typos の設定ファイルと一緒に一時ディレクトリに写して確かめる。
//          下書きをリポジトリの外（スクラッチパッド）に置いても、リポジトリの設定が効く。
//
// どちらも、typos の設定ファイル（_typos.toml など）はインデックスから写す。ステージしていない設定の変更は効かない。
// typos が見つからなければ、確認を飛ばして終了コード 0 で終わる。
// 指摘があれば終了コード 1、無ければ 0。typos や git が誤字以外の理由で失敗したら、その出力を示して終了コード 2 で終わる。

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join } from "node:path";

const USAGE = `使い方:
  node check_spelling.mjs staged
  node check_spelling.mjs message <下書きのファイル>`;

// typos が読む設定ファイルの名前。typos.toml などは名前だけで、pyproject.toml と Cargo.toml は typos の表があるときだけ設定になる。
const CONFIG_NAMES = ["typos.toml", "_typos.toml", ".typos.toml", "pyproject.toml", "Cargo.toml"];
const TYPOS_TABLE = {
  "pyproject.toml": /^\s*\[tool\.typos[.\]]/mu,
  "Cargo.toml": /^\s*\[(?:package|workspace)\.metadata\.typos[.\]]/mu,
};
// 文書として扱う拡張子。ほかはソースコードとして扱う。
const DOC_EXTS = new Set([".md", ".markdown", ".mdx", ".txt", ".rst", ".adoc", ".asciidoc", ".org", ".textile"]);
const REGULAR_MODES = new Set(["100644", "100755"]);
// typos に1回で渡すパスの文字数の上限。Windows のコマンドラインの上限（32,767文字）より小さくする。
const ARGS_LIMIT = 24000;
// 指摘に添える行の中身の上限（文字数）。
const LINE_LIMIT = 200;
const SECTIONS = ["今回の変更の行", "変更していない行", "ファイル名"];

class CheckError extends Error {}

function git(args, { cwd, input } = {}) {
  const r = spawnSync("git", ["--no-replace-objects", ...args], { cwd, input, maxBuffer: 1 << 30 });
  if (r.error) throw new CheckError(`git を起動できない: ${r.error.message}`);
  if (r.status !== 0) {
    throw new CheckError(`git ${args.join(" ")} が終了コード ${r.status} で失敗した\n${r.stderr.toString("utf8").trim()}`);
  }
  return r.stdout;
}

// typos が起動できるか。入っていなければ false。
function typosAvailable() {
  const r = spawnSync("typos", ["--version"], { encoding: "utf8" });
  if (r.error?.code === "ENOENT") return false;
  if (r.error) throw new CheckError(`typos を起動できない: ${r.error.message}`);
  return true;
}

// typos.toml などの設定か。pyproject.toml と Cargo.toml は、typos の表があるときだけ設定とみなす。
function isTyposConfig(name, content) {
  if (!CONFIG_NAMES.includes(name)) return false;
  const table = TYPOS_TABLE[name];
  return table ? table.test(content) : true;
}

// git cat-file --batch で blob を読み、一時ディレクトリの同じ相対パスに書く。smudge フィルターと改行の変換はかけない。
function writeBlobs(top, entries, dir) {
  if (!entries.length) return;
  const out = git(["cat-file", "--batch"], { cwd: top, input: entries.map((e) => e.oid).join("\n") + "\n" });
  let pos = 0;
  for (const e of entries) {
    const nl = out.indexOf(0x0a, pos);
    const header = out.subarray(pos, nl).toString("utf8");
    const m = header.match(/^[0-9a-f]+ blob (\d+)$/u);
    if (!m) throw new CheckError(`blob を読めない（${e.path}）: ${header}`);
    const size = Number(m[1]);
    const file = join(dir, ...e.path.split("/"));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, out.subarray(nl + 1, nl + 1 + size));
    pos = nl + 1 + size + 1;
  }
}

// インデックスにある typos の設定ファイル。rootOnly を true にすると、リポジトリ直下のものだけにする。
function indexConfigs(top, rootOnly = false) {
  const out = git(["-c", "core.quotePath=false", "ls-files", "-s", "-z"], { cwd: top }).toString("utf8");
  const entries = [];
  for (const rec of out.split("\0")) {
    const m = rec.match(/^(\d+) ([0-9a-f]+) (\d)\t(.*)$/su);
    if (!m || m[3] !== "0" || !REGULAR_MODES.has(m[1])) continue;
    const path = m[4];
    if (rootOnly && path.includes("/")) continue;
    if (CONFIG_NAMES.includes(basename(path))) entries.push({ path, oid: m[2] });
  }
  return entries;
}

// 一時ディレクトリの直下に typos の設定が無ければ、空の _typos.toml を置く。一時ディレクトリの外（ホームなど）の設定まで、typos がさかのぼらないようにするため。
function stopConfigSearch(dir, rootEntries) {
  for (const e of rootEntries) {
    if (isTyposConfig(e.path, readFileSync(join(dir, e.path), "utf8"))) return;
  }
  writeFileSync(join(dir, "_typos.toml"), "");
}

// typos を一時ディレクトリで起動し、指摘を返す。ディレクトリではなくファイルのパスを渡す。ディレクトリを渡すと、サブディレクトリの設定が読まれないため。
function runTypos(dir, paths, extraArgs) {
  const batches = [];
  let cur = [];
  let len = 0;
  for (const p of paths) {
    if (cur.length && len + p.length + 1 > ARGS_LIMIT) {
      batches.push(cur);
      cur = [];
      len = 0;
    }
    cur.push(p);
    len += p.length + 1;
  }
  if (cur.length) batches.push(cur);

  const found = [];
  for (const batch of batches) {
    const r = spawnSync("typos", ["--format", "json", "--force-exclude", ...extraArgs, "--", ...batch], {
      cwd: dir,
      encoding: "utf8",
      maxBuffer: 1 << 30,
    });
    if (r.error) throw new CheckError(`typos を起動できない: ${r.error.message}`);
    if (r.status !== 0 && r.status !== 2) {
      throw new CheckError(`typos が終了コード ${r.status} で失敗した（78 は設定ファイルの誤り）\n${(r.stdout + r.stderr).trim()}`);
    }
    for (const line of r.stdout.split(/\r?\n/u)) {
      if (!line.trim()) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.type !== "typo") continue;
      const path = process.platform === "win32" ? msg.path.replace(/\\/gu, "/") : msg.path;
      found.push({ ...msg, path: path.replace(/^\.\//u, "") });
    }
  }
  return found;
}

// C 言語の形で引用符に囲まれたパス（"a\tb"）を戻す。
function unquote(s) {
  if (!s.startsWith('"')) return s;
  const bytes = [];
  const body = Buffer.from(s.slice(1, -1), "utf8");
  const simple = { a: 7, b: 8, f: 12, n: 10, r: 13, t: 9, v: 11, '"': 34, "\\": 92 };
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== 0x5c) {
      bytes.push(body[i]);
      continue;
    }
    const c = String.fromCharCode(body[i + 1]);
    if (/[0-7]/u.test(c)) {
      bytes.push(Number.parseInt(body.subarray(i + 1, i + 4).toString("latin1"), 8));
      i += 3;
    } else {
      bytes.push(simple[c] ?? body[i + 1]);
      i += 1;
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

// ステージした差分から、ファイルごとに足した行の番号を求める。
function addedLines(top) {
  const out = git(
    [
      "-c", "core.quotePath=false",
      "diff", "--cached", "-U0", "--text", "--no-textconv", "--no-ext-diff", "--no-color",
      "--src-prefix=a/", "--dst-prefix=b/", "--diff-filter=ACMRT",
    ],
    { cwd: top },
  ).toString("utf8");
  const added = new Map();
  let cur = null;
  // ファイルの見出し（diff --git から最初の @@ まで）の中だけで +++ を読む。足した行の中身が「++ 」で始まると、「+++ 」の行になるため。
  let inHeader = false;
  for (const line of out.split("\n")) {
    if (line.startsWith("diff --git ")) {
      inHeader = true;
      cur = null;
      continue;
    }
    if (inHeader && line.startsWith("+++ ")) {
      cur = unquote(line.slice(4).replace(/\t$/u, "")).replace(/^b\//u, "");
      if (!added.has(cur)) added.set(cur, new Set());
      continue;
    }
    const m = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/u);
    if (m) inHeader = false;
    if (m && cur !== null) {
      const start = Number(m[1]);
      const count = m[2] === undefined ? 1 : Number(m[2]);
      for (let n = start; n < start + count; n++) added.get(cur).add(n);
    }
  }
  return added;
}

function kindOf(path) {
  return DOC_EXTS.has(extname(path).toLowerCase()) ? "文書" : "ソースコード";
}

function lineOf(dir, path, num, cache) {
  if (!cache.has(path)) {
    let lines = [];
    try {
      lines = readFileSync(join(dir, ...path.split("/")), "utf8").split(/\r?\n/u);
    } catch {
      // 読めなければ、行の中身を添えない。
    }
    cache.set(path, lines);
  }
  const line = (cache.get(path)[num - 1] ?? "").trim();
  return [...line].length > LINE_LIMIT ? `${[...line].slice(0, LINE_LIMIT).join("")}…` : line;
}

function describe(t) {
  const corrections = t.corrections?.length ? t.corrections.map((c) => `\`${c}\``).join("、") : "（候補なし）";
  return `\`${t.typo}\` → ${corrections}`;
}

// 指摘を分類ごとに示す。groups は分類の名前から指摘の一覧への Map で、入れた順に示す。
function report(groups) {
  let total = 0;
  for (const [name, items] of groups) {
    if (!items.length) continue;
    console.log(`[${name}]（${items.length}件）`);
    for (const item of items) console.log(item);
    console.log("");
    total += items.length;
  }
  if (total) {
    console.log(`${total} 件の指摘があります`);
    return 1;
  }
  console.log("誤字は見つかりませんでした");
  return 0;
}

function staged(dir) {
  const top = git(["rev-parse", "--show-toplevel"]).toString("utf8").trim();
  const raw = git(
    ["-c", "core.quotePath=false", "diff", "--cached", "--raw", "-z", "--no-abbrev", "--diff-filter=ACMRT"],
    { cwd: top },
  ).toString("utf8");
  const tokens = raw.split("\0");
  const targets = [];
  for (let i = 0; i < tokens.length; i++) {
    const meta = tokens[i];
    if (!meta.startsWith(":")) continue;
    const [, newMode, , newOid, status] = meta.slice(1).split(" ");
    const path = /^[RC]/u.test(status) ? tokens[i + 2] : tokens[i + 1];
    i += /^[RC]/u.test(status) ? 2 : 1;
    if (REGULAR_MODES.has(newMode)) targets.push({ path, oid: newOid });
  }
  if (!targets.length) {
    console.log("確認するファイルがありません（ステージした通常のファイルが無い）");
    return 0;
  }

  const configs = indexConfigs(top);
  const paths = new Set(targets.map((t) => t.path));
  writeBlobs(top, [...targets, ...configs.filter((c) => !paths.has(c.path))], dir);
  stopConfigSearch(dir, configs.filter((c) => !c.path.includes("/")));

  const found = runTypos(dir, targets.map((t) => t.path), []);
  const added = addedLines(top);
  const partial = new Set(git(["-c", "core.quotePath=false", "diff", "--name-only", "-z"], { cwd: top }).toString("utf8").split("\0"));
  const cache = new Map();
  const groups = new Map(SECTIONS.map((name) => [name, []]));
  for (const t of found) {
    const mark = partial.has(t.path) ? "、一部だけステージ" : "";
    const head = `${t.path}${t.line_num ? `:${t.line_num}` : ""}（${kindOf(t.path)}${mark}）: ${describe(t)}`;
    let name;
    let item;
    if (!t.line_num) {
      name = "ファイル名";
      item = head;
    } else {
      name = added.get(t.path)?.has(t.line_num) ? "今回の変更の行" : "変更していない行";
      item = `${head}\n    ${lineOf(dir, t.path, t.line_num, cache)}`;
    }
    groups.get(name).push(item);
  }
  return report(groups);
}

function message(dir, draft) {
  let text;
  try {
    text = readFileSync(draft);
  } catch (e) {
    throw new CheckError(`下書きを読めない: ${e.message}`);
  }
  const name = basename(draft);
  let rootConfigs = [];
  const r = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" });
  if (!r.error && r.status === 0) {
    const top = r.stdout.trim();
    rootConfigs = indexConfigs(top, true).filter((c) => c.path !== name);
    writeBlobs(top, rootConfigs, dir);
  }
  stopConfigSearch(dir, rootConfigs);
  writeFileSync(join(dir, name), text);

  const found = runTypos(dir, [name], ["--no-check-filenames"]);
  const cache = new Map();
  const items = found.map(
    (t) => `${draft}:${t.line_num}: ${describe(t)}\n    ${lineOf(dir, name, t.line_num, cache)}`,
  );
  return report(new Map([["下書き", items]]));
}

function main(argv) {
  const [mode, draft] = argv;
  if (!(mode === "staged" && argv.length === 1) && !(mode === "message" && argv.length === 2)) {
    console.log(USAGE);
    return 2;
  }
  let dir = null;
  try {
    if (!typosAvailable()) {
      console.log("typosが見つからないため、スペルの確認を飛ばした");
      return 0;
    }
    dir = mkdtempSync(join(tmpdir(), "check-spelling-"));
    return mode === "staged" ? staged(dir) : message(dir, draft);
  } catch (e) {
    if (!(e instanceof CheckError)) throw e;
    console.error(e.message);
    return 2;
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

process.exitCode = main(process.argv.slice(2));
