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

test("体言止めを求めるのは1行目だけで、箇条書きの常体の用言止めは通す", () => {
  const ng = run("fix: 案内を追加する\n\n## 問題\n- 予算と比べる手段が無い\n");
  assert.equal(ng.status, 1);
  assert.equal(ng.stdout.match(/体言止めになっていない/g).length, 1);
  assert.match(ng.stdout, /1行目が体言止めになっていない（「…加する」で終わる）/);
  const ok = run([
    "fix: 案内の追加",
    "",
    "## 問題",
    "- 予算と比べる手段が無い",
    "- クラウドセッションで使えない",
    "- 実装計画が、リポジトリのファイルとしてコミットされている",
    "",
    "## 対応",
    "- レビューする側の決定",
    "- 初期状態への切り替え",
    "",
  ].join("\n"));
  assert.equal(ok.status, 0, ok.stdout);
});

test("箇条書きの、述語の後ろに足した「状態」と、です・ます調を検出する", () => {
  const r = run("fix: 案内の追加\n\n## 問題\n- クラウドセッションで使えない状態\n- 実装計画がコミットされている状態（plan/）。\n- 古い版も使えます\n- 初期状態\n");
  assert.equal(r.status, 1);
  assert.equal(r.stdout.match(/「状態」を足している/g).length, 2);
  assert.match(r.stdout, /「…えない状態」/);
  assert.equal(r.stdout.match(/です・ます調で終わっている/g).length, 1);
});

test("末尾の句点と括弧書きを除いて見て、名詞で終わる項目は通す", () => {
  const ok = run("fix: 案内の追加\n\n- 処理の追加（呼び出し元で確かめる）\n- 上限の近く\n- なし\n- 1件ずつの処理。\n- `--fix`\n");
  assert.equal(ok.status, 0, ok.stdout);
  const ng = run("fix: 処理を加える（詳しくは設計書）。\n\n- 処理の追加\n");
  assert.equal(ng.status, 1);
  assert.match(ng.stdout, /「…加える」で終わる/);
});

test("段落と表を検出し、見出し、コードブロック、トレーラー、URL、生成元の表示は通す", () => {
  const ok = run([
    "feat: 案内の追加",
    "",
    "## 対応",
    "- 案内の追加",
    "",
    "```",
    "コードの中は文章でもよいとする",
    "```",
    "",
    "Co-Authored-By: Example <noreply@example.com>",
    "🤖 Generated with [Claude Code](https://claude.com/claude-code)",
    "https://example.com/session",
    "",
  ].join("\n"));
  assert.equal(ok.status, 0, ok.stdout);
  const ng = run("feat: 案内の追加\n\n## テスト\n本文を文章で書いた。\n\n| 課題 | 結果 |\n|---|---|\n| 縮約 | 148行 |\n");
  assert.equal(ng.status, 1);
  assert.equal(ng.stdout.match(/箇条書きになっていない/g).length, 3);
});
