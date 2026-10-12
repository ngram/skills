// scripts/check-skill-updates.mjs の動作確認。node --test tests/*.test.mjs で実行する。
// 一時的なリポジトリに Skill とタグを作り、.skill と claude.ai の写しを手元に置いて比べる（ネットワークは使わない）。

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function skillMd(name, extra = "") {
  return `---\nname: ${name}\ndescription: ${name} の説明\n${extra}---\n\n# ${name}\n\n本文\n`;
}

// Skill を置いてタグ v1.0.0 を付けた一時的なリポジトリと、その版の .skill を作る。
function fixture() {
  const repo = mkdtempSync(join(tmpdir(), "check-skill-updates-"));
  const git = (...args) => {
    const r = spawnSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], { cwd: repo, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
  };
  git("init", "-q");
  mkdirSync(join(repo, "scripts"));
  for (const s of ["check-skill-updates.mjs", "package-skills.mjs"]) copyFileSync(join(ROOT, "scripts", s), join(repo, "scripts", s));
  for (const name of ["same", "readme", "update", "missing"]) {
    mkdirSync(join(repo, name, "scripts"), { recursive: true });
    writeFileSync(join(repo, name, "SKILL.md"), skillMd(name));
    writeFileSync(join(repo, name, "README.md"), `# ${name}\n`);
    writeFileSync(join(repo, name, "scripts", "run.mjs"), "console.log(1);\n");
  }
  mkdirSync(join(repo, "local"));
  writeFileSync(join(repo, "local", "SKILL.md"), skillMd("local", "metadata:\n  claude-ai: unsupported\n"));
  git("add", "-A");
  git("commit", "-q", "-m", "fixture");
  git("tag", "v1.0.0");
  const from = join(repo, "release");
  const p = spawnSync(process.execPath, [join(repo, "scripts", "package-skills.mjs"), "--ref", "v1.0.0", "--out", from], { cwd: repo, encoding: "utf8" });
  assert.equal(p.status, 0, p.stderr);

  // claude.ai の写し。claude.ai は取り込むときに name を引用符で囲むことがあるので、それも再現する。
  const synced = join(repo, "synced");
  for (const name of ["same", "readme", "update"]) {
    cpSync(join(repo, name), join(synced, name), { recursive: true });
    const md = join(synced, name, "SKILL.md");
    writeFileSync(md, readFileSync(md, "utf8").replace(`name: ${name}`, `name: "${name}"`));
  }
  writeFileSync(join(synced, "readme", "README.md"), "# 古い README\n");
  writeFileSync(join(synced, "update", "SKILL.md"), skillMd("update").replace("本文", "古い本文"));
  return { repo, from, synced };
}

function check(repo, ...args) {
  return spawnSync(process.execPath, [join(repo, "scripts", "check-skill-updates.mjs"), "--tag", "v1.0.0", ...args], {
    cwd: repo,
    encoding: "utf8",
  });
}

test("同じ・README だけ違う・更新あり・未導入・サポート外を見分け、入れ直しが要る .skill だけを置く", () => {
  const { repo, from, synced } = fixture();
  const out = join(repo, "out");
  const r = check(repo, "--from", from, "--synced", synced, "--out", out, "--json");
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const result = JSON.parse(r.stdout);
  assert.equal(result.tag, "v1.0.0");
  const status = Object.fromEntries(result.skills.map((s) => [s.name, s.status]));
  assert.deepEqual(status, { local: "skipped", missing: "missing", readme: "same", same: "same", update: "update" });
  assert.deepEqual(result.skills.find((s) => s.name === "update").differs, ["SKILL.md"]);
  for (const name of ["update", "missing"]) {
    assert.ok(readFileSync(join(out, `${name}.skill`)).equals(readFileSync(join(from, `${name}.skill`))), `${name}.skill が置かれていない`);
  }
  for (const name of ["same", "readme", "local"]) assert.ok(!existsSync(join(out, `${name}.skill`)), `${name}.skill が置かれた`);
});

test("結果を文章でも出す", () => {
  const { repo, from, synced } = fixture();
  const r = check(repo, "--from", from, "--synced", synced, "--out", join(repo, "out"));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /更新あり: update（SKILL\.md が違う）/);
  assert.match(r.stdout, /未導入: missing/);
  assert.match(r.stdout, /省略: local（claude\.ai のサポート外）/);
});

test(".skill が手に入らない Skill があれば、確かめられないとして終了コード2", () => {
  const { repo, synced } = fixture();
  const empty = join(repo, "empty");
  mkdirSync(empty);
  const r = check(repo, "--from", empty, "--synced", synced, "--out", join(repo, "out"));
  assert.equal(r.status, 2);
  assert.match(r.stdout, /確かめられない: same/);
});

test("知らないオプションと、形の違う版は終了コード2", () => {
  const { repo } = fixture();
  assert.equal(check(repo, "--unknown").status, 2);
  const r = spawnSync(process.execPath, [join(repo, "scripts", "check-skill-updates.mjs"), "--tag", "1.0"], { cwd: repo, encoding: "utf8" });
  assert.equal(r.status, 2);
});
