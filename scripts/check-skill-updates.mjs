#!/usr/bin/env node
// claude.ai に入っている Skill が、リリースに添付した .skill と同じかを確かめ、入れ直しが要る .skill を手元に用意する。
// 依存パッケージは無く、Node.js 18 以降の標準機能と git、curl だけで動く。
//
// claude.ai の Skill は、Claude Code のセッションの <設定ディレクトリ>/skills/synced/<id>/<name>/ に同期される
// （セッションの開始時と、その後およそ10分ごと）。この写しと、リリースの <name>.skill の中身を比べる。
//   - SKILL.md の frontmatter の値の引用符の有無は比べない（claude.ai は取り込むときに name を "..." で囲むことがある）
//   - README.md は比べない（利用者向けの説明で、Claude の動作には使わない）
// frontmatter の metadata に claude-ai: unsupported がある Skill は比べない。
//
// 結果が「更新あり」か「未導入」の Skill について、.skill を --out のディレクトリに置く。
// これをセッションにファイルとして送ると、ファイルのカードに「Save skill」のボタンが出て、押すと claude.ai に入る。
//
// 使い方:
//   node scripts/check-skill-updates.mjs [--tag <版>] [--out <ディレクトリ>] [--json]
//     --tag     比べるリリースの版（既定は、v で始まるタグのうち最新の版）
//     --out     .skill を置くディレクトリ（既定は dist/skill-updates）
//     --json    結果を JSON で出す
//   テストのための指定:
//     --from    リリースからダウンロードする代わりに、このディレクトリの <name>.skill を使う
//     --synced  同期先の代わりに、このディレクトリの <name>/ を claude.ai の写しとして使う
//
// 終了コード: 0 = すべての Skill を確かめた（更新の有無は問わない）、2 = 確かめられない Skill があった

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

const REPO = "ngram/skills";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const USAGE = "使い方: node scripts/check-skill-updates.mjs [--tag <版>] [--out <ディレクトリ>] [--json]";
const IGNORED_FILES = new Set(["README.md"]);
const STATUS_LABEL = { update: "更新あり", missing: "未導入", same: "同じ", skipped: "省略", unavailable: "確かめられない" };

function run(cmd, args, encoding = "utf8") {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding, maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw new Error(`${cmd} を実行できない: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} が失敗した: ${String(r.stderr).trim()}`);
  return r.stdout;
}

function compareVersions(a, b) {
  const pa = a.slice(1).split(".").map(Number);
  const pb = b.slice(1).split(".").map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

// v で始まるタグのうち、最新の版。
function latestTag() {
  const tags = run("git", ["ls-remote", "--tags", "--refs", "origin", "v*"])
    .split("\n")
    .map((l) => l.split("\t")[1]?.replace("refs/tags/", ""))
    .filter((t) => t && /^v\d+\.\d+\.\d+$/.test(t));
  if (tags.length === 0) throw new Error("v で始まる版のタグが無い");
  return tags.sort(compareVersions).at(-1);
}

// タグの版を手元に用意する。浅い clone でもタグを取ってこられるように、タグだけを fetch する。
function ensureTag(tag) {
  const r = spawnSync("git", ["rev-parse", "--verify", "--quiet", `refs/tags/${tag}^{commit}`], { cwd: ROOT });
  if (r.status === 0) return;
  run("git", ["fetch", "--quiet", "--no-tags", "origin", `refs/tags/${tag}:refs/tags/${tag}`]);
}

// タグの版の、直下の <name>/SKILL.md と、claude.ai のサポート外の印の有無。
function skillsAt(tag) {
  return run("git", ["ls-tree", "-r", "--name-only", tag])
    .split("\n")
    .map((p) => p.match(/^([^./][^/]*)\/SKILL\.md$/)?.[1])
    .filter(Boolean)
    .sort()
    .map((name) => {
      const lines = run("git", ["show", `${tag}:${name}/SKILL.md`]).replace(/\r\n/g, "\n").split("\n");
      const end = lines[0] === "---" ? lines.indexOf("---", 1) : -1;
      let inMetadata = false;
      let unsupported = false;
      for (const l of end === -1 ? [] : lines.slice(1, end)) {
        if (/^metadata:\s*$/.test(l)) inMetadata = true;
        else if (/^\S/.test(l)) inMetadata = false;
        else if (inMetadata && /^\s+claude-ai:\s*["']?unsupported["']?\s*$/.test(l)) unsupported = true;
      }
      return { name, unsupported };
    });
}

// リリースに添付した <name>.skill を取ってくる。.skill を添付していない古い版のために、<name>.zip も試す（中身は同じ形式）。
function download(tag, name) {
  for (const ext of ["skill", "zip"]) {
    const url = `https://github.com/${REPO}/releases/download/${tag}/${name}.${ext}`;
    const r = spawnSync("curl", ["-fsSL", url], { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 });
    if (r.error) throw new Error(`curl を実行できない: ${r.error.message}`);
    if (r.status === 0) return { buf: r.stdout, url };
  }
  return null;
}

// ZIP の中身を、Skill のディレクトリからの相対パスと内容の対応表にする。
function unzip(buf, name) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd === -1) throw new Error("ZIP の形式ではない");
  const count = buf.readUInt16LE(eocd + 10);
  let pos = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) throw new Error("ZIP の中央ディレクトリが壊れている");
    const method = buf.readUInt16LE(pos + 10);
    const size = buf.readUInt32LE(pos + 20);
    const nameLength = buf.readUInt16LE(pos + 28);
    const local = buf.readUInt32LE(pos + 42);
    const path = buf.toString("utf8", pos + 46, pos + 46 + nameLength);
    pos += 46 + nameLength + buf.readUInt16LE(pos + 30) + buf.readUInt16LE(pos + 32);
    if (path.endsWith("/")) continue;
    if (!path.startsWith(`${name}/`)) throw new Error(`ルートが ${name}/ ではないファイルがある: ${path}`);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    if (method === 0) files.set(path.slice(name.length + 1), Buffer.from(data));
    else if (method === 8) files.set(path.slice(name.length + 1), inflateRawSync(data));
    else throw new Error(`対応していない圧縮方式: ${method}（${path}）`);
  }
  return files;
}

function readTree(dir, base = dir, files = new Map()) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) readTree(p, base, files);
    else files.set(relative(base, p).split("\\").join("/"), readFileSync(p));
  }
  return files;
}

// claude.ai の写しを探す。同期先は <設定ディレクトリ>/skills/synced/<id>/<name>/。
function findSynced(name, syncedOverride) {
  if (syncedOverride) {
    const dir = join(syncedOverride, name);
    return existsSync(join(dir, "SKILL.md")) ? dir : null;
  }
  const root = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "skills", "synced");
  if (!existsSync(root)) return null;
  for (const bucket of readdirSync(root, { withFileTypes: true })) {
    const dir = join(root, bucket.name, name);
    if (bucket.isDirectory() && existsSync(join(dir, "SKILL.md"))) return dir;
  }
  return null;
}

// 比べる前の正規化。SKILL.md は改行を LF にそろえ、frontmatter の「キー: "値"」の引用符を外す。
function normalize(path, buf) {
  if (path !== "SKILL.md") return buf;
  const lines = buf.toString("utf8").replace(/\r\n/g, "\n").split("\n");
  const end = lines[0] === "---" ? lines.indexOf("---", 1) : -1;
  for (let i = 1; i < end; i++) {
    lines[i] = lines[i].replace(/^([A-Za-z0-9_-]+):\s*"([^"]*)"\s*$/, "$1: $2").replace(/^([A-Za-z0-9_-]+):\s*'([^']*)'\s*$/, "$1: $2");
  }
  return Buffer.from(lines.join("\n"));
}

// 違うファイルの一覧（README.md は除く）。
function differences(release, synced) {
  const paths = new Set([...release.keys(), ...synced.keys()]);
  return [...paths]
    .filter((p) => !IGNORED_FILES.has(p))
    .filter((p) => !release.has(p) || !synced.has(p) || !normalize(p, release.get(p)).equals(normalize(p, synced.get(p))))
    .sort();
}

function parseArgs(argv) {
  const opts = { tag: null, out: "dist/skill-updates", json: false, from: null, synced: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (["--tag", "--out", "--from", "--synced"].includes(a) && i + 1 < argv.length) opts[a.slice(2)] = argv[++i];
    else if (a === "--json") opts.json = true;
    else if (a === "-h" || a === "--help") return null;
    else throw new Error(`知らないオプションか、値の無いオプション: ${a}`);
  }
  return opts;
}

function main(argv) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    console.error(`${e.message}\n${USAGE}`);
    return 2;
  }
  if (!opts) {
    console.log(USAGE);
    return 0;
  }
  let tag;
  let skills;
  try {
    tag = opts.tag ?? latestTag();
    if (!/^v\d+\.\d+\.\d+$/.test(tag)) throw new Error(`版は v0.1.0 の形で指定する: ${tag}`);
    ensureTag(tag);
    skills = skillsAt(tag);
  } catch (e) {
    console.error(e.message);
    return 2;
  }
  const out = resolve(opts.out);
  const results = [];
  for (const { name, unsupported } of skills) {
    if (unsupported) {
      results.push({ name, status: "skipped", note: "claude.ai のサポート外" });
      continue;
    }
    try {
      let buf;
      let url;
      if (opts.from) {
        const file = join(opts.from, `${name}.skill`);
        if (!existsSync(file)) throw new Error(`${file} が無い`);
        buf = readFileSync(file);
        url = file;
      } else {
        const got = download(tag, name);
        if (!got) throw new Error(`リリース ${tag} に ${name}.skill も ${name}.zip も無い`);
        ({ buf, url } = got);
      }
      const release = unzip(buf, name);
      const syncedDir = findSynced(name, opts.synced);
      const differs = syncedDir ? differences(release, readTree(syncedDir)) : [];
      const status = !syncedDir ? "missing" : differs.length ? "update" : "same";
      const result = { name, status, differs, source: url };
      if (status !== "same") {
        mkdirSync(out, { recursive: true });
        result.file = join(out, `${name}.skill`);
        writeFileSync(result.file, buf);
      }
      results.push(result);
    } catch (e) {
      results.push({ name, status: "unavailable", note: e.message });
    }
  }

  const releaseUrl = `https://github.com/${REPO}/releases/tag/${tag}`;
  if (opts.json) {
    console.log(JSON.stringify({ tag, releaseUrl, skills: results }, null, 2));
  } else {
    console.log(`${tag}（${releaseUrl}）と、claude.ai に入っている Skill を比べた`);
    for (const r of results) {
      let detail = "";
      if (r.status === "update") detail = `（${r.differs.join("、")} が違う）`;
      if (r.note) detail = `（${r.note}）`;
      const file = r.file ? ` → ${relative(process.cwd(), r.file)}` : "";
      console.log(`  ${STATUS_LABEL[r.status]}: ${r.name}${detail}${file}`);
    }
  }
  return results.some((r) => r.status === "unavailable") ? 2 : 0;
}

process.exitCode = main(process.argv.slice(2));
