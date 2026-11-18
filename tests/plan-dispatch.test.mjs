// plan-dispatch の SKILL.md と雛形（assets/）の確認。node --test tests/*.test.mjs で実行する。
// Skill はスクリプトを持たず、手順は SKILL.md と worker.md に書くので、手順で参照する節やキーが揃っているかを見る。

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL_DIR = join(ROOT, "plan-dispatch");
const read = (...p) => readFileSync(join(...p), "utf8").replace(/\r\n/g, "\n");
const skill = read(SKILL_DIR, "SKILL.md");
const worker = read(SKILL_DIR, "assets", "worker.md");
const task = read(SKILL_DIR, "assets", "task.md");

// 見出し（## か ###）の本文を、次の同じ深さ以上の見出しまで取り出す。
function section(text, heading) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.replace(/^#+\s*/u, "") === heading && /^#{2,3}\s/u.test(l));
  assert.notEqual(start, -1, `「${heading}」の節が無い`);
  const depth = lines[start].match(/^#+/u)[0].length;
  const end = lines.findIndex((l, i) => i > start && /^#+\s/u.test(l) && l.match(/^#+/u)[0].length <= depth);
  return lines.slice(start + 1, end === -1 ? undefined : end).join("\n");
}

const KINDS = ["invite", "join", "decline", "assign", "done", "blocked", "answer", "stop", "leader"];

test("SKILL.md が、リーダーとワーカーの手順と、守る決まりの節を持つ", () => {
  for (const h of ["引数", "チームのファイル", "メッセージの形式", "リーダーの手順", "ワーカーの手順", "呼び出しの重なりの決まり", "新しいタブの見つけ方と招待", "通知の見分け方", "ワーカーがいなくなったとき", "範囲の外の変更の見つけ方", "引き継ぎ", "守る決まり", "メッセージが届かないとき", "進捗のペイン（mod）"]) {
    section(skill, h);
  }
  // ワーカーの手順は worker.md だけに書き、SKILL.md はそれを指す。
  assert.match(section(skill, "ワーカーの手順"), /worker\.md/u);
});

test("メッセージの9つの種類が、SKILL.md の表と worker.md にある", () => {
  const table = section(skill, "メッセージの形式");
  const kinds = [...table.matchAll(/^\| `([a-z]+)` \|/gmu)].map((m) => m[1]);
  assert.deepEqual(kinds, KINDS);
  assert.match(table, /plan-dispatch <チームID> <種類> <対象>/u);
  for (const k of KINDS) assert.match(worker, new RegExp(`\`${k}\``, "u"), `worker.md に ${k} が無い`);
});

test("呼び出しの重なりの決まりが、7つの場合を順に持つ", () => {
  const rules = section(skill, "呼び出しの重なりの決まり");
  const items = rules.split("\n").filter((l) => /^\d+\. /u.test(l));
  assert.equal(items.length, 7);
  assert.match(items[0], /ワーカーとして参加中/u);
  assert.match(items[1], /続きから進める/u);
  assert.match(items[3], /引き継ぐか/u);
  assert.match(items[5], /\/plan-dispatch stop/u);
});

test("セッションの数の上限を、引数、環境変数、既定の10の順に決める", () => {
  const steps = section(skill, "リーダーの手順");
  const m = steps.match(/上限は、引数`--max-agents`、環境変数`PLAN_DISPATCH_MAX_AGENTS`[^、]*、既定の10の順に決める/u);
  assert.ok(m, "上限の決め方が、引数、環境変数、既定の10の順で書かれていない");
});

test("ワーカーIDとタスクIDを、W01とT01の形で振り、100件以上なら3桁にする", () => {
  const files = section(skill, "チームのファイル");
  assert.match(files, /ワーカーは`W`、タスクは`T`に、1から始まる番号を付ける（`W01`、`T01`）/u);
  assert.match(files, /タスクの数が100以上なら、すべてのタスクIDを3桁（`T001`）にする/u);
  // 古い形（worker01）が残っていない。
  assert.doesNotMatch(skill, /worker0\d/u);
});

test("タスクの題名を18文字以内にする決まりが、リーダーの手順と雛形の task.md にある", () => {
  assert.match(section(skill, "リーダーの手順"), /タスクの題名（`team\.json`の`title`と、タスクのファイルの見出し）は、18文字以内にする/u);
  assert.match(task, /題名は18文字以内にする/u);
});

test("雛形のファイルがあり、SKILL.md がその名前で指す", () => {
  for (const name of ["team.json", "task.md", "worker.md"]) {
    assert.ok(existsSync(join(SKILL_DIR, "assets", name)), `assets/${name} が無い`);
    assert.match(skill, new RegExp(`assets/${name.replace(".", "\\.")}`, "u"), `SKILL.md が assets/${name} を指していない`);
  }
});

test("雛形の team.json が JSON として読め、mod と SKILL.md が使うキーを持つ", () => {
  const team = JSON.parse(read(SKILL_DIR, "assets", "team.json"));
  for (const key of ["version", "teamId", "status", "plan", "leader", "invokedAs", "maxAgents", "sessionsAtStart", "baselineStatus", "workers", "tasks", "updatedAt"]) {
    assert.ok(key in team, `team.json に ${key} が無い`);
    // 配列のキーは `workers[]` の形で書く。
    assert.match(section(skill, "チームのファイル"), new RegExp(`\`${key}(\\[\\])?\``, "u"), `SKILL.md に ${key} の説明が無い`);
  }
  assert.ok(Array.isArray(team.workers) && Array.isArray(team.tasks));
  // mod が知っている版と、雛形の版が同じであること。
  const mod = read(ROOT, "mods", "plan-dispatch-view", "hooks", "register.tsx");
  const known = Number(mod.match(/const KNOWN_VERSION = (\d+)/u)?.[1]);
  assert.equal(team.version, known, "雛形の team.json の version と、mod の KNOWN_VERSION が違う");
});

test("worker.md が、参加、作業、報告と、送る前にリーダーの名前を読むことを持つ", () => {
  for (const h of ["参加する", "割り当てられたタスクを実行する", "終える", "守ること"]) section(worker, h);
  const join = section(worker, "参加する");
  assert.match(join, /招待（`invite`）を受けたとき/u);
  assert.match(join, /`join <チームID> <ワーカーID> <リーダー名>`/u);
  assert.match(section(worker, "守ること"), /メッセージを送る前に、いつも`team\.json`を読み、`leader`の名前に送る/u);
});

test("雛形の task.md が、手順で参照する節を持つ", () => {
  for (const h of ["目的", "編集してよいファイル", "先に終わる必要があるタスク", "完了の条件", "確認の方法", "結果", "要約", "変えたファイル"]) {
    section(task, h);
  }
  // 手順が、同じ名前で節を参照していること。
  for (const h of ["編集してよいファイル", "確認の方法", "結果"]) {
    assert.match(worker, new RegExp(`「${h}」`, "u"), `worker.md が「${h}」を参照していない`);
  }
});
