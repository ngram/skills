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

function fixture(description, compatibility, license = "MIT") {
  const dir = mkdtempSync(join(tmpdir(), "sync-skills-"));
  mkdirSync(join(dir, "scripts"));
  copyFileSync(join(ROOT, "scripts", "sync-skills.mjs"), join(dir, "scripts", "sync-skills.mjs"));
  writeFileSync(join(dir, "README.md"), `# 一覧\n\n${MARKERS.join("\n")}\n`);
  mkdirSync(join(dir, "sample"));
  const compat = compatibility ? `compatibility: ${compatibility}\n` : "";
  writeFileSync(join(dir, "sample", "SKILL.md"), `---\nname: sample\ndescription: ${description}\n${compat}license: ${license}\n---\n\n# sample\n`);
  return dir;
}

function sync(dir, ...args) {
  return spawnSync(process.execPath, [join(dir, "scripts", "sync-skills.mjs"), ...args], { cwd: dir, encoding: "utf8" });
}

test("description に山括弧があれば、claude.ai に入れられないとして失敗する", () => {
  const dir = fixture("plan/YYYYMMDD_<機能名>.md への保存。");
  const r = sync(dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /sample: description に山括弧（< か >）がある/);
});

test("山括弧の無い description なら、生成したあとの --check が通る", () => {
  const dir = fixture("plan/YYYYMMDD_機能名.md への保存。");
  const r = sync(dir);
  assert.equal(r.status, 0, r.stderr);
  const check = sync(dir, "--check");
  assert.equal(check.status, 0, check.stderr);
});

test("description の最初の文と compatibility が体言止めでなければ、表のセルになるとして失敗する", () => {
  const dir = fixture("計画を書き、ファイルに残す。2文目は動詞でよい。", "Node.js 18以降を使う");
  const r = sync(dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /sample: description の最初の文が体言止めになっていない（「…に残す」で終わる）/);
  assert.match(r.stderr, /sample: compatibility が体言止めになっていない（「…を使う」で終わる）/);
});

test("一覧の表とマーケットプレイスには、description の最初の文を末尾の句点を除いて入れる", () => {
  const dir = fixture("計画の作成とファイルへの保存。2文目は動詞でよい。", "gitが必要。パッケージを調べるときは、ネットワーク接続も必要");
  const r = sync(dir);
  assert.equal(r.status, 0, r.stderr);
  const readme = readFileSync(join(dir, "README.md"), "utf8");
  assert.match(readme, /^\| \[sample\]\(sample\/\) \| 計画の作成とファイルへの保存 \| gitが必要。パッケージを調べるときは、ネットワーク接続も必要 \| MIT \|$/mu);
  const catalog = JSON.parse(readFileSync(join(dir, ".claude-plugin", "marketplace.json"), "utf8"));
  assert.equal(catalog.plugins[0].description, "計画の作成とファイルへの保存");
});

test("SKILL.md にドル記号と数字の並びがあれば、Claude Code が引数で置き換えるとして失敗する", () => {
  const dir = fixture("計画の作成。");
  writeFileSync(join(dir, "sample", "SKILL.md"), "---\nname: sample\ndescription: 計画の作成。\nlicense: MIT\n---\n\n# sample\n\n```bash\ncase \"$1\" in\n```\n");
  const r = sync(dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /sample: SKILL\.md の10行目に「\$1」がある/);

  writeFileSync(join(dir, "sample", "SKILL.md"), "---\nname: sample\ndescription: 計画の作成。\nlicense: MIT\n---\n\n# sample\n\n```bash\necho \"${1}\" \"$ARGUMENTS\"\n```\n");
  assert.equal(sync(dir).status, 0, "波括弧で囲んだ形と $ARGUMENTS は通る");
});

test("一覧の表のライセンスの列で、license に書いたファイルと、ルートの LICENSE をリンクにする", () => {
  const dir = fixture("計画の作成。", undefined, "Unlicense AND MIT。元の部分はUnlicense（LICENSE.txt）、足した部分はMIT（LICENSE-MIT.txt）");
  writeFileSync(join(dir, "sample", "LICENSE.txt"), "Unlicense\n");
  writeFileSync(join(dir, "sample", "LICENSE-MIT.txt"), "MIT\n");
  const r = sync(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(
    readFileSync(join(dir, "README.md"), "utf8"),
    /\| Unlicense AND MIT。元の部分はUnlicense（\[LICENSE\.txt\]\(sample\/LICENSE\.txt\)）、足した部分はMIT（\[LICENSE-MIT\.txt\]\(sample\/LICENSE-MIT\.txt\)） \|$/mu,
  );

  const mit = fixture("計画の作成。");
  writeFileSync(join(mit, "LICENSE"), "MIT License\n");
  assert.equal(sync(mit).status, 0);
  assert.match(readFileSync(join(mit, "README.md"), "utf8"), /\| \[MIT\]\(LICENSE\) \|$/mu);
});

test("license に書いたファイルが Skill のディレクトリに無ければ失敗する", () => {
  const dir = fixture("計画の作成。", undefined, "Unlicense（LICENSE.txt）");
  const r = sync(dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /sample: license に書いたファイル「LICENSE\.txt」が Skill のディレクトリに無い/);
});
