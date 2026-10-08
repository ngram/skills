// git-commit/scripts/check_message.mjs の動作確認。node --test tests/*.test.mjs で実行する。

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "git-commit", "scripts", "check_message.mjs");
const DIR = mkdtempSync(join(tmpdir(), "check-message-"));

function run(message, ...args) {
  const file = join(DIR, `${Math.random().toString(36).slice(2)}.md`);
  writeFileSync(file, message);
  return spawnSync(process.execPath, [SCRIPT, file, ...args], { encoding: "utf8" });
}

test("書式に合うメッセージは終了コード0", () => {
  const r = run("fix: 月次DBの無い月の案内\n\n## 対応\n- `GET /v1/views`の呼び出しの追加\n");
  assert.equal(r.status, 0, r.stdout);
});

test("BOMとCRLFを含むファイルも読める", () => {
  const r = run("\uFEFFfix: 案内の追加\r\n\r\n- 項目\r\n");
  assert.equal(r.status, 0, r.stdout);
});

test("1行目が表示幅72桁を超えると終了コード1", () => {
  const r = run(`fix: ${"あ".repeat(40)}\n`);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /1行目の表示幅が上限 72 桁を超えている/);
});

test("2つ目の引数で1行目の上限を変えられる", () => {
  const r = run(`fix: ${"あ".repeat(36)}\n`, "80");
  assert.equal(r.status, 0, r.stdout);
});

test("箇条書きの折り返しを検出する", () => {
  const r = run("fix: 案内の追加\n\n- 長い項目\n  の続き\n");
  assert.equal(r.status, 1);
  assert.match(r.stdout, /箇条書きを折り返している/);
});

test("バッククォートの外でくっついたHTTPのメソッドとパスを検出する", () => {
  const r = run("fix: 案内の追加\n\n- GET/v1/viewsの呼び出し\n");
  assert.equal(r.status, 1);
  assert.match(r.stdout, /HTTP のメソッドとパスがくっついている/);
});

test("全角文字と記号で始まる語の間の空白を検出する", () => {
  const r = run("fix: 案内の追加\n\n- テンプレート .gitmessage の追加\n");
  assert.equal(r.status, 1);
  assert.match(r.stdout, /全角文字と記号の間に空白/);
});
