// japanese-tech-writing/scripts/fix_spacing.mjs の動作確認。node --test tests/*.test.mjs で実行する。

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "japanese-tech-writing", "scripts", "fix_spacing.mjs");
const DIR = mkdtempSync(join(tmpdir(), "fix-spacing-"));
const BOM = String.fromCharCode(0xfeff);

function run(text, ...args) {
  const file = join(DIR, `${Math.random().toString(36).slice(2)}.md`);
  writeFileSync(file, text);
  const r = spawnSync(process.execPath, [SCRIPT, ...args, file], { encoding: "utf8" });
  return { ...r, after: readFileSync(file, "utf8") };
}

const fix = (text) => run(text, "--fix");

test("全角文字と英数字の間の空白を除き、英単語どうしの空白は残す", () => {
  const r = fix("これは Claude Code の設定を 3 つ変える話で、2026 年に書いた。\n");
  assert.equal(r.after, "これはClaude Codeの設定を3つ変える話で、2026年に書いた。\n");
  assert.equal(r.status, 0, r.stdout);
});

test("全角文字とインラインコードの間の空白を除き、コードの中は変えない", () => {
  const r = fix("`git log` で確かめ、その後 `git show` を実行する。`a あ` の中身。\n");
  assert.equal(r.after, "`git log`で確かめ、その後`git show`を実行する。`a あ`の中身。\n");
});

test("行頭の箇条書き、番号、見出し、引用、タスクリストの記号の後ろの空白は残す", () => {
  const r = fix("# Claude Code の設定\n- 箇条書きの API\n1. 番号の API\n> 引用の API\n- [ ] タスクの item\n");
  assert.equal(r.after, "# Claude Codeの設定\n- 箇条書きのAPI\n1. 番号のAPI\n> 引用のAPI\n- [ ] タスクのitem\n");
});

test("frontmatterとコードブロックは変えない", () => {
  const text = "---\ntitle: 日本語 と English\nkey: 値\n---\n\n```bash\necho 日本 語 English\n```\n\n~~~\nmix 日本 abc\n~~~\n";
  const r = fix(text);
  assert.equal(r.after, text);
  assert.equal(r.status, 0, r.stdout);
});

test("URLの前後、表の区切り、強調の記号の隣の空白は変えない", () => {
  const text = "詳細は https://example.com/path を参照する。\n| 説明 | 値 |\n| --- | --- |\nの **強調** を\n";
  const r = fix(text);
  assert.equal(r.after, text);
  assert.equal(r.status, 0, r.stdout);
});

test("HTMLのコメントの区切りの隣の空白は変えず、コメントの中の英数字の前後は除く", () => {
  const r = fix("<!-- ここから下は ngram/skills で足した節 -->\n");
  assert.equal(r.after, "<!-- ここから下はngram/skillsで足した節 -->\n");
  assert.equal(r.status, 0, r.stdout);
});

test("記号で始まる（終わる）語の前後の空白は直さずに場所を示し、終了コード1", () => {
  const r = fix("テンプレート .gitmessage の置き場所と ./internal/... の中身。\n");
  assert.equal(r.after, "テンプレート .gitmessageの置き場所と ./internal/... の中身。\n");
  assert.equal(r.status, 1);
  assert.match(r.stdout, /記号で始まる（または終わる）語の間に空白がある/);
  assert.equal((r.stdout.match(/:1: /g) ?? []).length, 3);
});

test("--fix を付けなければファイルを変えず、直せる箇所も示して終了コード1", () => {
  const text = "Claude Code の設定\n";
  const r = run(text);
  assert.equal(r.after, text);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /--fix で除ける/);
});

test("CRLFの改行と先頭のBOMは、そのまま書き戻す", () => {
  const r = fix(`${BOM}これは API の説明。\r\n- 項目の CLI\r\n`);
  assert.equal(r.after, `${BOM}これはAPIの説明。\r\n- 項目のCLI\r\n`);
});

test("絵文字と英数字の間の空白は変えない", () => {
  const text = "🤖 Generated with Claude Code\n- ✅ Done の確認\n";
  const r = fix(text);
  assert.equal(r.after, "🤖 Generated with Claude Code\n- ✅ Doneの確認\n");
  assert.equal(r.status, 0, r.stdout);
});

test("空白の無い文章は終了コード0", () => {
  const r = run("Claude Codeの設定を`git log`で確かめる。\n");
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /空白はありません/);
});
