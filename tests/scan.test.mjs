// repo-privacy-audit/scripts/scan.mjs の動作確認。node --test tests/*.test.mjs で実行する。
// 仕込む値（トークン、メールアドレスなど）は、このファイル自体が検査に当たらないよう、実行時に組み立てる。

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "repo-privacy-audit", "scripts", "scan.mjs");
const ROOT = mkdtempSync(join(tmpdir(), "scan-"));
// 利用者の git の設定（署名の強制など）に左右されないよう、空の設定で動かす。
const GITCONFIG = join(ROOT, "gitconfig");
writeFileSync(GITCONFIG, "");
const BASE_ENV = { ...process.env, GIT_CONFIG_GLOBAL: GITCONFIG, GIT_CONFIG_NOSYSTEM: "1" };

const TOKEN = `ghp_${"a1B2c3D4e5".repeat(4).slice(0, 36)}`;
const PERSONAL = ["taro.yamada", "gmail.com"].join("@");
const NOREPLY = ["1+dev", "users.noreply.github.com"].join("@");
const DEV = ["Dev", NOREPLY];
const KEY_HEADER = ["-----BEGIN", "OPENSSH", "PRIVATE", "KEY-----"].join(" ");
const PASSWORD = "Hunter2".repeat(2);
const HOME_PATH = ["", "Users", "hanako", "work"].join("/");
const PRIVATE_IP = [10, 1, 2, 3].join(".");

let count = 0;

function git(cwd, args, [name, email] = DEV) {
  const env = { ...BASE_ENV, GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email };
  const r = spawnSync("git", args, { cwd, env, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}

function newRepo() {
  const dir = join(ROOT, `repo-${++count}`);
  mkdirSync(dir);
  git(dir, ["init", "-q", "-b", "main"]);
  return dir;
}

// files の値が null のファイルは消す。
function commit(dir, files, message, who = DEV) {
  for (const [path, content] of Object.entries(files)) {
    const p = join(dir, path);
    if (content === null) rmSync(p);
    else {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, content);
    }
  }
  git(dir, ["add", "-A"], who);
  git(dir, ["commit", "-q", "-m", message], who);
  return git(dir, ["rev-parse", "HEAD"]);
}

function scan(...args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", env: BASE_ENV });
}

// 秘密情報を入れてから消したリポジトリ。
function leakyRepo() {
  const dir = newRepo();
  commit(dir, { "config.yml": `github:\n  token: "${TOKEN}"\n`, ".env": "X=1\n" }, "設定の追加", ["Taro Yamada", PERSONAL]);
  commit(dir, { "config.yml": "github:\n  token: ${GITHUB_TOKEN}\n", ".env": null }, `設定の整理\n\n連絡先: ${PERSONAL}\n`);
  git(dir, ["tag", "-a", "v0.1.0", "-m", "社内コード名 kumquat の初版"]);
  return dir;
}

test("秘密情報の無いリポジトリは終了コード0", () => {
  const dir = newRepo();
  commit(dir, { "README.md": `# 例\n\n連絡は ${NOREPLY} へ。サーバーは 192.0.2.10、仕様は RFC 9309 の 2.3.1.4 節。\n` }, "最初のコミット");
  const r = scan("--repo", dir);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /見つかったもの: なし/);
});

test("消したトークンを履歴から見つけ、値を伏せて出す", () => {
  const r = scan("--repo", leakyRepo());
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stdout, /\[高\] GitHub のトークン: ghp_…（40文字）/);
  assert.match(r.stdout, /config\.yml:2（blob [0-9a-f]{7}、初出 [0-9a-f]{7}、履歴だけ、参照: main, v0\.1\.0）/);
  assert.ok(!r.stdout.includes(TOKEN), "トークンがそのまま出ている");
  assert.ok(!r.stdout.includes("パスワード・トークンらしい値の代入"), "同じトークンを代入の規則でも出している");
});

test("コミットメッセージと作成者の個人のメールアドレスを見つける", () => {
  const r = scan("--repo", leakyRepo());
  assert.match(r.stdout, /\[高\] メールアドレス: t\*\*\*@gmail\.com/);
  assert.match(r.stdout, /コミット [0-9a-f]{7} のメッセージ 3 行目/);
  assert.match(r.stdout, /\[高\] 作成者・コミッター・タグの作成者のメールアドレス: t\*\*\*@gmail\.com/);
  assert.ok(!r.stdout.includes(PERSONAL), "メールアドレスがそのまま出ている");
});

test("消した .env ファイルを、追加したコミットとともに示す", () => {
  const r = scan("--repo", leakyRepo());
  assert.match(r.stdout, /\[高\] \.env ファイル: \.env\n {4}コミット [0-9a-f]{7} で追加、履歴だけ/);
});

test("指定した語をタグのメッセージと作成者の名前から見つけ、一覧でも伏せる", () => {
  const dir = leakyRepo();
  const terms = join(ROOT, "terms.txt");
  writeFileSync(terms, "# 実名\nyamada\n");
  const r = scan("--repo", dir, "--term", "kumquat", "--terms-file", terms);
  assert.match(r.stdout, /\[高\] 指定した語 1: k…（7文字）\n {4}タグ v0\.1\.0 のメッセージ 1 行目/);
  assert.match(r.stdout, /\[高\] 指定した語 2: y…（6文字）（2 か所）\n {4}コミット [0-9a-f]{7} のメッセージ 3 行目（参照: main, v0\.1\.0）\n {4}Taro Y\*\*\*（作成者・コミッター/);
  assert.ok(!/yamada/i.test(r.stdout), "指定した語がそのまま出ている");
});

test("PR の参照からだけ辿れるコミットをそう示す", () => {
  const dir = newRepo();
  commit(dir, { "README.md": "# 例\n" }, "最初のコミット");
  git(dir, ["checkout", "-q", "-b", "feature"]);
  commit(dir, { "notes.txt": `password = "${PASSWORD}"\n` }, "メモ");
  git(dir, ["update-ref", "refs/pull/1/head", "HEAD"]);
  git(dir, ["checkout", "-q", "main"]);
  git(dir, ["branch", "-q", "-D", "feature"]);
  const r = scan("--repo", dir);
  assert.match(r.stdout, /参照: ブランチ 1、タグ 0、リモート追跡 0、PR 1、その他 0/);
  assert.match(r.stdout, /\[中\] パスワード・トークンらしい値の代入: password: Hun…（14文字）/);
  assert.match(r.stdout, /PR の参照からだけ辿れる: pull\/1\/head/);
});

test("ディレクトリを調べ、鍵のファイルと秘密鍵を見つける", () => {
  const dir = join(ROOT, "package");
  mkdirSync(join(dir, "lib"), { recursive: true });
  writeFileSync(join(dir, "lib", "deploy.pem"), `${KEY_HEADER}\nabc\n`);
  writeFileSync(join(dir, "lib", "main.rb"), `HOST = '${PRIVATE_IP}'\npath = '${HOME_PATH}'\n`);
  const r = scan("--dir", dir);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /\[高\] 鍵・証明書のファイル: lib\/deploy\.pem/);
  assert.ok(r.stdout.includes(`[高] 秘密鍵: ${KEY_HEADER}\n    lib/deploy.pem:1`), r.stdout);
  assert.match(r.stdout, /\[中\] ユーザー名入りのパス: \/Users\/h\*\*\*\n {4}lib\/main\.rb:2/);
  assert.match(r.stdout, /\[低\] IP アドレス: 10\.1\.2\.3/);
});

test("説明文の例やダミーの値は出さない", () => {
  const dir = join(ROOT, "docs");
  mkdirSync(dir);
  const example = ["scheme://ユーザー", "パスワード@ホスト"].join(":");
  writeFileSync(join(dir, "guide.md"), `形は ${example} になる。ダミーの番号は ${["090", "0000", "0000"].join("-")} とする。\n`);
  const r = scan("--dir", dir);
  assert.equal(r.status, 0, r.stdout);
});

test("--show を付けると値を伏せない", () => {
  const r = scan("--repo", leakyRepo(), "--show");
  assert.ok(r.stdout.includes(TOKEN));
  assert.ok(r.stdout.includes(PERSONAL));
});

test("--exclude で外したファイルの中身は調べない", () => {
  const r = scan("--repo", leakyRepo(), "--exclude", "^config\\.yml$");
  assert.ok(!r.stdout.includes("GitHub のトークン"), r.stdout);
  assert.match(r.stdout, /除外 2/); // config.yml の2つの版
});

test("使い方の誤りは終了コード2", () => {
  assert.equal(scan("--unknown").status, 2);
  assert.equal(scan("--repo", ROOT).status, 2); // git のリポジトリではない
});
