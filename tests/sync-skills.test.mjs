// scripts/sync-skills.mjs の動作確認。node --test tests/*.test.mjs で実行する。
// 一時的なディレクトリに、スクリプトと Skill と README.md を置いて実行する。

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ルートの README.md から、Skill 一覧のブロックの目印の行を取り出す。
const MARKERS = readFileSync(join(ROOT, "README.md"), "utf8")
  .split("\n")
  .filter((l) => l.includes("skills:list:begin") || l.includes("skills:list:end"));

function fixture(description) {
  const dir = mkdtempSync(join(tmpdir(), "sync-skills-"));
  mkdirSync(join(dir, "scripts"));
  copyFileSync(join(ROOT, "scripts", "sync-skills.mjs"), join(dir, "scripts", "sync-skills.mjs"));
  writeFileSync(join(dir, "README.md"), `# 一覧\n\n${MARKERS.join("\n")}\n`);
  mkdirSync(join(dir, "sample"));
  writeFileSync(join(dir, "sample", "SKILL.md"), `---\nname: sample\ndescription: ${description}\nlicense: MIT\n---\n\n# sample\n`);
  return dir;
}

function sync(dir, ...args) {
  return spawnSync(process.execPath, [join(dir, "scripts", "sync-skills.mjs"), ...args], { cwd: dir, encoding: "utf8" });
}

test("description に山括弧があれば、claude.ai に入れられないとして失敗する", () => {
  const dir = fixture("plan/YYYYMMDD_<機能名>.md に残す。");
  const r = sync(dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /sample: description に山括弧（< か >）がある/);
});

test("山括弧の無い description なら、生成したあとの --check が通る", () => {
  const dir = fixture("plan/YYYYMMDD_機能名.md に残す。");
  const r = sync(dir);
  assert.equal(r.status, 0, r.stderr);
  const check = sync(dir, "--check");
  assert.equal(check.status, 0, check.stderr);
});
