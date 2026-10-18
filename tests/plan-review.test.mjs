// plan-review/SKILL.md の、レビューする側を決めるコードブロックと、レビューさせるコードブロックの動作確認。
// node --test tests/*.test.mjs で実行する。SKILL.md からコードブロックを取り出し、偽の codex と claude を PATH に置いて
// bash で実行する。Windows では Git Bash を使い、見つからなければ飛ばす（WSL の bash.exe を避けるため）。

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL = readFileSync(join(ROOT, "plan-review", "SKILL.md"), "utf8");

function findBash() {
  if (process.platform !== "win32") return "bash";
  const git = join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "bin", "bash.exe");
  return existsSync(git) ? git : null;
}
const BASH = findBash();
const skip = BASH ? false : "Git Bash が見つからない";

// 先頭の行が marker のコメントである bash のコードブロックを取り出す。
function block(marker) {
  const m = SKILL.match(new RegExp("```bash\\n(# " + marker + "\\n[\\s\\S]*?)\\n```", "u"));
  assert.ok(m, `SKILL.md に「# ${marker}」で始まるコードブロックが無い`);
  return m[1];
}

// 偽の codex と claude。受け取った引数と標準入力を記録し、FAKE_* の環境変数で決めた出力と終了コードを返す。
const FAKE_CODEX = `#!/bin/bash
if [ "$1 $2" = "login status" ]; then
  exit "\${FAKE_CODEX_LOGIN:-0}"
fi
printf '%s\\n' "$@" > "$FAKE_DIR/codex.args"
cat > "$FAKE_DIR/codex.stdin"
OUT=""
while [ $# -gt 0 ]; do
  if [ "$1" = "-o" ]; then OUT="$2"; shift; fi
  shift
done
echo "model: fake-codex-model" >&2
echo "reasoning effort: fake-effort" >&2
printf '%s\\n' "\${FAKE_OUTPUT:-指摘なし。}" > "$OUT"
exit "\${FAKE_STATUS:-0}"
`;
const FAKE_CLAUDE = `#!/bin/bash
printf '%s\\n' "$@" > "$FAKE_DIR/claude.args"
cat > "$FAKE_DIR/claude.stdin"
if [ -z "\${FAKE_EMPTY:-}" ]; then
  printf '%s\\n' "\${FAKE_OUTPUT:-指摘なし。}"
fi
exit "\${FAKE_STATUS:-0}"
`;

// 一時的なディレクトリを作り、偽のコマンドを fakebin/ に置く。commands は置くコマンドの名前。
function workspace(commands) {
  const dir = mkdtempSync(join(tmpdir(), "plan-review-"));
  mkdirSync(join(dir, "fakebin"));
  mkdirSync(join(dir, "fake"));
  for (const [name, body] of [["codex", FAKE_CODEX], ["claude", FAKE_CLAUDE]]) {
    if (!commands.includes(name)) continue;
    writeFileSync(join(dir, "fakebin", name), body);
    chmodSync(join(dir, "fakebin", name), 0o755);
  }
  return dir;
}

// コードブロックを bash で実行する。vars は実行の前に設定するシェルの変数、env は環境変数。
function runBlock(dir, script, { vars = {}, env = {} } = {}) {
  const preset = Object.entries(vars).map(([k, v]) => `${k}='${v}'`).join("\n");
  const body = `export PATH="$PWD/fakebin:/usr/bin:/bin"\nexport FAKE_DIR="$PWD/fake"\n${preset}\n${script}\n`;
  const file = join(dir, "run.sh");
  writeFileSync(file, body);
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("PLAN_REVIEW_")));
  return spawnSync(BASH, ["run.sh"], { cwd: dir, encoding: "utf8", env: { ...clean, ...env } });
}

const read = (dir, path) => readFileSync(join(dir, path), "utf8");

// レビューする側を決めるコードブロックを、$ARGUMENTS を args に置き換えて実行する。
function choose(args, { commands = ["codex", "claude"], env = {} } = {}) {
  const dir = workspace(commands);
  const script = `${block("レビューする側を決める").replaceAll("$ARGUMENTS", args)}\necho "RESULT=$REVIEWER|$PLAN_ARG"`;
  const r = runBlock(dir, script, { env });
  const result = r.stdout.match(/^RESULT=(.*)\|(.*)$/mu);
  return { ...r, reviewer: result?.[1], planArg: result?.[2] };
}

test("レビューする側は、引数、環境変数、auto の順に決まる", { skip }, () => {
  let r = choose("--reviewer claude 20250621_x");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.reviewer, "claude");
  assert.equal(r.planArg, "20250621_x");
  assert.match(r.stdout, /レビューする側: claude（引数）/u);

  r = choose("20250621_x --reviewer=codex");
  assert.equal(r.reviewer, "codex");
  assert.equal(r.planArg, "20250621_x");

  r = choose("", { env: { PLAN_REVIEW_REVIEWER: "claude" } });
  assert.equal(r.reviewer, "claude");
  assert.match(r.stdout, /環境変数PLAN_REVIEW_REVIEWER/u);

  r = choose("--reviewer claude", { env: { PLAN_REVIEW_REVIEWER: "codex" } });
  assert.equal(r.reviewer, "claude", "引数が環境変数より優先される");
});

test("auto は、codex がありログイン済みなら Codex、そうでなければ Claude を選ぶ", { skip }, () => {
  let r = choose("");
  assert.equal(r.reviewer, "codex");
  assert.match(r.stdout, /既定のauto（codexにログイン済み）/u);

  r = choose("", { env: { FAKE_CODEX_LOGIN: "1" } });
  assert.equal(r.reviewer, "claude");
  assert.match(r.stdout, /既定のauto（codexにログインしていない）/u);

  r = choose("", { commands: ["claude"] });
  assert.equal(r.reviewer, "claude");
  assert.match(r.stdout, /既定のauto（codexが無い）/u);

  r = choose("", { env: { PLAN_REVIEW_REVIEWER: "auto" }, commands: ["claude"] });
  assert.equal(r.reviewer, "claude");
});

test("不正な値、値の無い --reviewer、明示した側のコマンドが無いときは中断する", { skip }, () => {
  let r = choose("--reviewer gemini");
  assert.equal(r.status, 1);
  assert.match(r.stdout, /「gemini」（引数）は使えません/u);

  r = choose("x --reviewer");
  assert.equal(r.status, 1);
  assert.match(r.stdout, /--reviewerの後に/u);

  r = choose("--reviewer codex", { commands: ["claude"] });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /codexコマンドが見つかりません/u);

  r = choose("--reviewer claude", { commands: ["codex"] });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /claudeコマンドが見つかりません/u);

});

test("Codex を明示したときは、codex login status が失敗しても中断せず、注意を出す", { skip }, () => {
  const r = choose("--reviewer codex", { env: { FAKE_CODEX_LOGIN: "1" } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.reviewer, "codex");
  assert.match(r.stdout, /注意: codex login statusが失敗しました/u);
});

test("前の版の PLAN_REVIEW_MODEL と PLAN_REVIEW_EFFORT は読まず、新しい名前を示す", { skip }, () => {
  const r = choose("--reviewer claude", { env: { PLAN_REVIEW_MODEL: "old", PLAN_REVIEW_EFFORT: "old" } });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /PLAN_REVIEW_MODELは読みません。PLAN_REVIEW_CODEX_MODELかPLAN_REVIEW_CLAUDE_MODEL/u);
  assert.match(r.stdout, /PLAN_REVIEW_EFFORTは読みません/u);
});

// レビューさせるコードブロックを、plan/sample.md を対象にして実行する。
function review(reviewer, { round = "01", env = {}, files = {} } = {}) {
  const dir = workspace(["codex", "claude"]);
  const reviewDir = "plan/.reviews/sample";
  mkdirSync(join(dir, reviewDir), { recursive: true });
  writeFileSync(join(dir, "plan", "sample.md"), "# sample\n\n## 保証の水準\n\n- 守るもの：Planの本文\n");
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, reviewDir, name), text);
  const r = runBlock(dir, block("レビューする側にレビューさせる"), {
    vars: { REVIEWER: reviewer, PLAN_FILE: "plan/sample.md", REVIEW_DIR: reviewDir, ROUND: round },
    env,
  });
  const out = join(dir, reviewDir, `r${round}_review.md`);
  return { ...r, dir, out, log: read(dir, `${reviewDir}/r${round}_review.log`) };
}

test("Claude には、読むツールだけを渡し、既定の opus と high でプロンプトを標準入力から渡す", { skip }, () => {
  const r = review("claude", { env: { FAKE_OUTPUT: "1. 指摘\nVERDICT: APPROVED" } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(read(r.dir, "fake/claude.args").trim().split("\n"), [
    "-p", "--model", "opus", "--effort", "high", "--tools", "Read,Grep,Glob", "--restricted", "--strict-mcp-config",
    "--no-session-persistence",
  ]);
  const prompt = read(r.dir, "fake/claude.stdin");
  assert.match(prompt, /変更はできません/u);
  assert.match(prompt, /守るもの：Planの本文/u);
  assert.equal(readFileSync(r.out, "utf8"), "1. 指摘\nVERDICT: APPROVED\n");
  assert.match(r.log, /^plan-review reviewer: claude\nplan-review model: opus\nplan-review effort: high\n/u);
});

test("Claude のモデルと推論の強さは PLAN_REVIEW_CLAUDE_* で変わり、前の版の環境変数は渡さない", { skip }, () => {
  const r = review("claude", {
    env: { PLAN_REVIEW_CLAUDE_MODEL: "fable", PLAN_REVIEW_CLAUDE_EFFORT: "max", PLAN_REVIEW_MODEL: "old-model" },
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const args = read(r.dir, "fake/claude.args");
  assert.match(args, /^--model\nfable\n--effort\nmax\n/mu);
  assert.doesNotMatch(args, /old-model/u);
});

test("Codex には、-s read-only と -o で呼び、PLAN_REVIEW_CODEX_* を渡す", { skip }, () => {
  const r = review("codex", { env: { PLAN_REVIEW_CODEX_MODEL: "m1", PLAN_REVIEW_CODEX_EFFORT: "high", FAKE_OUTPUT: "VERDICT: REVISE" } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(read(r.dir, "fake/codex.args").trim().split("\n"), [
    "exec", "-s", "read-only", "-m", "m1", "-c", "model_reasoning_effort=high", "-o", "plan/.reviews/sample/r01_review.md.tmp", "-",
  ]);
  assert.equal(readFileSync(r.out, "utf8"), "VERDICT: REVISE\n");
  assert.match(r.stdout, /model: fake-codex-model/u);
  assert.match(r.log, /^plan-review reviewer: codex\nplan-review model: m1\nplan-review effort: high\n/u);
});

test("Codex は、PLAN_REVIEW_CODEX_* が無ければ -m と -c を渡さない", { skip }, () => {
  const r = review("codex");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(read(r.dir, "fake/codex.args").trim().split("\n"), [
    "exec", "-s", "read-only", "-o", "plan/.reviews/sample/r01_review.md.tmp", "-",
  ]);
  assert.match(r.log, /^plan-review reviewer: codex\nplan-review model: （CLIの既定）\nplan-review effort: （CLIの既定）\n/u);
});

test("レビューする側が0以外で終わると、応答を残さず、出力を実行ログに移す", { skip }, () => {
  for (const reviewer of ["claude", "codex"]) {
    const r = review(reviewer, { env: { FAKE_STATUS: "1", FAKE_OUTPUT: "You've hit your monthly spend limit" } });
    assert.ok(!existsSync(r.out), `${reviewer}: 失敗したのに応答が残った`);
    assert.ok(!existsSync(`${r.out}.tmp`), `${reviewer}: 一時ファイルが残った`);
    assert.match(r.log, /終了コード1。0以外で終わったか、応答が空のため、レビュー結果として扱わない）\nYou've hit your monthly spend limit/u, reviewer);
    assert.match(r.stdout, new RegExp(`${reviewer}が終了コード1で終わりました`, "u"));
  }
});

test("0で終わっても応答が空なら、応答を残さない", { skip }, () => {
  const r = review("claude", { env: { FAKE_EMPTY: "1" } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(!existsSync(r.out), "空の応答が残った");
  assert.match(r.log, /終了コード0。0以外で終わったか、応答が空のため/u);
  assert.match(r.stdout, /応答がありません/u);
});

test("2回目以降は前の回の応答を添付し、rNN_review.md が無ければ前の版の rNN_codex.md を使う", { skip }, () => {
  let r = review("claude", { round: "02", files: { "r01_codex.md": "前の版の指摘\nVERDICT: REVISE\n" } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(read(r.dir, "fake/claude.stdin"), /【前回のレビュー結果】\n前の版の指摘/u);

  r = review("claude", {
    round: "02",
    files: { "r01_codex.md": "前の版の指摘\n", "r01_review.md": "新しい名前の指摘\n" },
  });
  assert.match(read(r.dir, "fake/claude.stdin"), /【前回のレビュー結果】\n新しい名前の指摘/u);

  r = review("claude", { round: "03", files: { "r01_review.md": "1回目の指摘\n" } });
  assert.match(read(r.dir, "fake/claude.stdin"), /【前回のレビュー結果】\n1回目の指摘/u, "失敗した2回目を飛ばして1回目を添付する");

  r = review("claude");
  assert.doesNotMatch(read(r.dir, "fake/claude.stdin"), /【前回のレビュー結果】/u);
});
