// scripts/package-skills.mjs の動作確認。node --test tests/*.test.mjs で実行する。

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

// HEAD の SKILL.md の frontmatter から、最上位のキーと、claude.ai のサポート外の印（metadata の claude-ai: unsupported）を読む。
function frontmatterAtHead(name) {
  const text = spawnSync("git", ["show", `HEAD:${name}/SKILL.md`], { cwd: ROOT, encoding: "utf8" }).stdout;
  const body = text.split("---")[1].split("\n");
  return {
    keys: body.map((l) => l.match(/^([A-Za-z0-9_-]+):/)?.[1]).filter(Boolean),
    claudeAiUnsupported: body.some((l) => /^\s+claude-ai:\s*unsupported\s*$/.test(l)),
  };
}

const skillsAtHead = () => gitFiles("HEAD").map((p) => p.match(/^([^./][^/]*)\/SKILL\.md$/)?.[1]).filter(Boolean);

test("Skill ごとに、ルートに Skill のディレクトリが1つ入った .skill を作り、ZIP は作らず、claude.ai のサポート外の Skill は作らない", () => {
  const out = mkdtempSync(join(tmpdir(), "package-skills-"));
  const r = run("--out", out);
  assert.equal(r.status, 0, r.stderr);
  const skills = skillsAtHead();
  assert.ok(skills.length > 0);
  for (const name of skills) {
    const skill = join(out, `${name}.skill`);
    assert.ok(!existsSync(join(out, `${name}.zip`)), `${name}.zip が作られた`);
    if (frontmatterAtHead(name).claudeAiUnsupported) {
      assert.ok(!existsSync(skill), `${name} は claude.ai のサポート外なのに作られた`);
      assert.ok(r.stdout.includes(`省略: ${name}`), `${name} を省いたことが出力に無い`);
      continue;
    }
    assert.ok(existsSync(skill), `${name}.skill が無い`);
    const files = zipEntries(skill).filter((p) => !p.endsWith("/"));
    assert.deepEqual(files.sort(), gitFiles("HEAD", `${name}/`).sort(), `${name}.skill の中身が git の管理するファイルと違う`);
  }
});

test("claude.ai のサポート外ではなく、frontmatter に skill-creator の検証が許していないキーがある Skill だけを警告する", () => {
  const out = mkdtempSync(join(tmpdir(), "package-skills-"));
  const r = run("--out", out);
  assert.equal(r.status, 0, r.stderr);
  const allowed = new Set(["name", "description", "license", "allowed-tools", "metadata", "compatibility"]);
  for (const name of skillsAtHead()) {
    const fm = frontmatterAtHead(name);
    const extra = fm.keys.filter((k) => !allowed.has(k));
    const warned = r.stderr.includes(`警告: ${name} の frontmatter`);
    assert.equal(warned, !fm.claudeAiUnsupported && extra.length > 0, `${name}: 許していないキー ${extra.join(", ") || "なし"}`);
  }
});

test("印の有無で、作るか省くかと警告が決まる（一時的なリポジトリで確かめる）", () => {
  const repo = mkdtempSync(join(tmpdir(), "package-skills-repo-"));
  const git = (...args) => {
    const r = spawnSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], { cwd: repo, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
  };
  git("init", "-q");
  mkdirSync(join(repo, "scripts"));
  copyFileSync(SCRIPT, join(repo, "scripts", "package-skills.mjs"));
  const skills = {
    plain: "---\nname: plain\ndescription: 印も余分なキーも無い\n---\n",
    extra: "---\nname: extra\ndescription: 余分なキーがある\nargument-hint: x\n---\n",
    local: "---\nname: local\ndescription: claude.ai のサポート外\nargument-hint: x\nmetadata:\n  claude-ai: unsupported\n---\n",
  };
  for (const [name, text] of Object.entries(skills)) {
    mkdirSync(join(repo, name));
    writeFileSync(join(repo, name, "SKILL.md"), text);
  }
  git("add", "-A");
  git("commit", "-q", "-m", "fixture");
  const out = join(repo, "dist");
  const r = spawnSync(process.execPath, [join(repo, "scripts", "package-skills.mjs"), "--out", out], { cwd: repo, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(out, "plain.skill")) && existsSync(join(out, "extra.skill")));
  assert.ok(!existsSync(join(out, "local.skill")) && !existsSync(join(out, "local.zip")));
  assert.match(r.stdout, /省略: local/);
  assert.match(r.stderr, /警告: extra の frontmatter の argument-hint/);
  assert.doesNotMatch(r.stderr, /警告: (plain|local) /);
});

test("知らないオプションは終了コード2", () => {
  assert.equal(run("--unknown").status, 2);
  assert.equal(run("--ref", "no-such-ref").status, 2);
});
