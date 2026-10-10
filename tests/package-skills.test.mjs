// scripts/package-skills.mjs の動作確認。node --test tests/*.test.mjs で実行する。

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(ROOT, "scripts", "package-skills.mjs");

function run(...args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: "utf8" });
}

function gitFiles(...args) {
  return spawnSync("git", ["ls-tree", "-r", "--name-only", ...args], { cwd: ROOT, encoding: "utf8" }).stdout.split("\n").filter(Boolean);
}

// ZIP の中央ディレクトリから、入っているパスの一覧を読む。
function zipEntries(file) {
  const buf = readFileSync(file);
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(end + 10);
  let pos = buf.readUInt32LE(end + 16);
  const names = [];
  for (let i = 0; i < count; i++) {
    const nameLength = buf.readUInt16LE(pos + 28);
    names.push(buf.toString("utf8", pos + 46, pos + 46 + nameLength));
    pos += 46 + nameLength + buf.readUInt16LE(pos + 30) + buf.readUInt16LE(pos + 32);
  }
  return names;
}

test("Skill ごとに、ルートに Skill のディレクトリが1つ入った ZIP を作る", () => {
  const out = mkdtempSync(join(tmpdir(), "package-skills-"));
  const r = run("--out", out);
  assert.equal(r.status, 0, r.stderr);
  const skills = gitFiles("HEAD").map((p) => p.match(/^([^./][^/]*)\/SKILL\.md$/)?.[1]).filter(Boolean);
  assert.ok(skills.length > 0);
  for (const name of skills) {
    const file = join(out, `${name}.zip`);
    assert.ok(existsSync(file), `${name}.zip が無い`);
    const files = zipEntries(file).filter((p) => !p.endsWith("/"));
    assert.deepEqual(files.sort(), gitFiles("HEAD", `${name}/`).sort(), `${name}.zip の中身が git の管理するファイルと違う`);
  }
});

test("知らないオプションは終了コード2", () => {
  assert.equal(run("--unknown").status, 2);
  assert.equal(run("--ref", "no-such-ref").status, 2);
});
