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
  for (const h of ["引数", "チームのファイル", "メッセージの形式", "リーダーの手順", "ワーカーの手順", "呼び出しの重なりの決まり", "新しいタブの見つけ方と招待", "通知の見分け方", "ワーカーがいなくなったとき", "範囲の外の変更の見つけ方", "引き継ぎ", "守る決まり", "メッセージが届かないとき", "進捗のペイン（mod）", "ToDoの管理"]) {
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
  // 自分がリーダーの別のチームが進行中なら、断らずに今のチームにタスクを足す。
  assert.match(items[5], /断らずに、今のチームにタスクを足す/u);
  assert.doesNotMatch(items[5], /：断る/u);
});

test("進行中のチームに頼まれた作業は、テーマが違っても今のチームのタスクとして足す", () => {
  const add = section(skill, "進行中のチームへのタスクの追加");
  assert.match(add, /`\/plan-dispatch`を付けたかどうかにかかわらず、今のチームのタスクとして足す/u);
  assert.match(add, /テーマが違っていても、そのことで新しいチームに分けることを勧めない/u);
  assert.match(add, /新しいチームに分けるのは、利用者が明示的に頼んだとき/u);
  assert.match(section(skill, "リーダーの手順"), /「進行中のチームへのタスクの追加」に従う/u);
});

test("リーダーはタスクを自分で実行せず、プロジェクトのファイルを編集しない", () => {
  const rules = section(skill, "守る決まり");
  assert.match(rules, /リーダーは、タスクを自分で実行しない/u);
  assert.match(rules, /プロジェクトのファイルは編集しない/u);
  assert.match(rules, /作業が小さくても、ワーカーに割り当てる/u);
});

test("セッションの数の上限を、引数、環境変数、既定の10の順に決める", () => {
  const steps = section(skill, "リーダーの手順");
  const m = steps.match(/上限は、引数`--max-agents`、環境変数`PLAN_DISPATCH_MAX_AGENTS`[^、]*、既定の10の順に決める/u);
  assert.ok(m, "上限の決め方が、引数、環境変数、既定の10の順で書かれていない");
});

test("ワーカーIDにチームの文字を入れ（WA01、WB01）、タスクIDは T01 の形で、100件以上なら3桁にする", () => {
  const files = section(skill, "チームのファイル");
  assert.match(files, /ほかの進行中のチームの`teamLetter`と重ならない最初の文字を、`A`、`B`…`Z`の順に選ぶ/u);
  assert.match(files, /`W`、チームの文字、1から始まる番号をつなげる（`WA01`、`WA02`…、2つ目のチームなら`WB01`…）/u);
  assert.match(files, /番号は2桁に0で埋め、上限（`maxAgents`）が100以上なら3桁（`WA001`）にする/u);
  assert.doesNotMatch(skill, /`W[A-Z]\d`/u);
  assert.match(files, /`teamLetter`：チームの文字/u);
  assert.match(files, /タスクの数が100以上なら、すべてのタスクIDを3桁（`T001`）にする/u);
  // 古い形（worker01、W01）が残っていない。
  assert.doesNotMatch(skill, /worker0\d|`W0\d`/u);
  assert.doesNotMatch(read(SKILL_DIR, "README.md"), /`W0\d`|join <チームID> W0\d/u);
});

test("チームのファイルを、gitのメインの作業ツリーのルートの plan/.dispatch に置き、メッセージのパスを絶対パスにする", () => {
  const files = section(skill, "チームのファイル");
  assert.match(files, /メインの作業ツリーのルート（`git worktree list --porcelain`の最初の`worktree`の行のパス）/u);
  assert.match(files, /メッセージに書くパスは、絶対パスにする/u);
  assert.match(worker, /`git worktree list --porcelain`の最初の`worktree`の行のパス/u);
});

test("日時から作るチームIDは、ハイフンの無い YYYYMMDDHHMM にする", () => {
  assert.match(section(skill, "チームのファイル"), /日時（`YYYYMMDDHHMM`）/u);
  assert.doesNotMatch(skill, /YYYYMMDD-HHMM/u);
});

test("リーダーとワーカーのセッションのIDを team.json に書き、mod がそれでこのタブのチームを選ぶ", () => {
  const files = section(skill, "チームのファイル");
  assert.match(files, /`leaderSessionId`：リーダーのセッションのID（環境変数`CLAUDE_CODE_SESSION_ID`の値/u);
  assert.match(files, /`sessionId`（セッションのID。`join`のメッセージの2行目から取る/u);
  assert.match(section(skill, "参加の受け付け"), /セッションのIDを、そのワーカーの`sessionId`に書く/u);
  assert.match(section(worker, "参加する"), /`printenv CLAUDE_CODE_SESSION_ID`/u);
  const mod = read(ROOT, "mods", "plan-dispatch-view", "hooks", "register.tsx");
  assert.match(mod, /record\.leaderSessionId === sessionId/u);
  assert.match(mod, /\.sessionId === sessionId/u);
});

test("/rename で名前が変わっても、参照から新しい名前を探して送り直す", () => {
  const renamed = section(skill, "名前が変わったとき");
  assert.match(renamed, /`ListAgents`のセッション名（メッセージの宛先）も変わり、古い名前では届かなくなる/u);
  assert.match(renamed, /記録した参照と同じ参照のセッションを探して、その名前に送り直す/u);
  assert.match(section(skill, "チームのファイル"), /`ref`（セッションの参照）/u);
  const join = section(worker, "参加する");
  assert.match(join, /`\/rename <ワーカーID>`（例：`\/rename WA01`）/u);
  assert.match(section(worker, "守ること"), /`leaderRef`と同じ参照/u);
});

test("タスクの題名を18文字以内にする決まりが、リーダーの手順と雛形の task.md にある", () => {
  assert.match(section(skill, "リーダーの手順"), /タスクの題名（`team\.json`の`title`と、タスクのファイルの見出し）は、18文字以内にする/u);
  assert.match(task, /題名は18文字以内/u);
});

test("ワーカーが done と blocked の2行目に一言を書き、リーダーがタスクの note に書き、mod が表示する", () => {
  const table = section(skill, "メッセージの形式");
  assert.match(table, /\| `done` \|.*2行目に結果を一言（20文字以内）で書く/u);
  assert.match(table, /\| `blocked` \|.*2行目に理由を一言（20文字以内）で書く/u);
  assert.match(section(skill, "チームのファイル"), /`note`（担当のワーカーの最後の報告/u);
  const steps = section(skill, "リーダーの手順");
  assert.match(steps, /`done`にし、メッセージの2行目の一言をタスクの`note`に書く/u);
  assert.match(steps, /`blocked`にし、メッセージの2行目の一言をタスクの`note`に書き/u);
  assert.match(section(worker, "割り当てられたタスクを実行する"), /2行目には、結果を一言（20文字以内/u);
  const mod = read(ROOT, "mods", "plan-dispatch-view", "hooks", "register.tsx");
  assert.match(mod, /note: text\(t\.note\)/u);
});

test("結果の要約を3行以内にする決まりが、worker.md と雛形の task.md にある", () => {
  // 進捗のペイン（mod）が、タスクの題名の下に要約の先頭の3行を表示するため。
  assert.match(section(worker, "割り当てられたタスクを実行する"), /要約は3行以内にする/u);
  assert.match(task, /要約は3行以内にする/u);
  const mod = read(ROOT, "mods", "plan-dispatch-view", "hooks", "register.tsx");
  assert.match(mod, /const SUMMARY_LINES = 3/u);
});

test("雛形のファイルがあり、SKILL.md がその名前で指す", () => {
  for (const name of ["team.json", "task.md", "worker.md", "todo.json"]) {
    assert.ok(existsSync(join(SKILL_DIR, "assets", name)), `assets/${name} が無い`);
    assert.match(skill, new RegExp(`assets/${name.replace(".", "\\.")}`, "u"), `SKILL.md が assets/${name} を指していない`);
  }
});

test("雛形の team.json が JSON として読め、mod と SKILL.md が使うキーを持つ", () => {
  const team = JSON.parse(read(SKILL_DIR, "assets", "team.json"));
  for (const key of ["version", "teamId", "teamLetter", "status", "plan", "leader", "leaderRef", "leaderSessionId", "invokedAs", "maxAgents", "sessionsAtStart", "baselineStatus", "workers", "tasks", "updatedAt"]) {
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

test("ToDoを plan/.dispatch/todo.json に1つにまとめ、雛形のキーを SKILL.md が説明し、mod が同じファイルと版を読む", () => {
  const todo = section(skill, "ToDoの管理");
  assert.match(todo, /ルートの`plan\/\.dispatch\/todo\.json`に1つにまとめて置く/u);
  for (const key of ["id", "title", "summary", "plan", "related", "createdAt"]) {
    assert.match(todo, new RegExp(`- \`${key}\`：`, "u"), `SKILL.md に todos[].${key} の説明が無い`);
  }
  const template = JSON.parse(read(SKILL_DIR, "assets", "todo.json"));
  for (const key of ["version", "todos", "updatedAt"]) assert.ok(key in template, `todo.json に ${key} が無い`);
  assert.ok(Array.isArray(template.todos));
  const mod = read(ROOT, "mods", "plan-dispatch-view", "hooks", "register.tsx");
  assert.match(mod, /const TODO_FILE = 'todo\.json'/u);
  assert.equal(Number(mod.match(/const TODO_KNOWN_VERSION = (\d+)/u)?.[1]), template.version, "雛形の todo.json の version と、mod の TODO_KNOWN_VERSION が違う");
});

test("todo の引数でToDoを足し、タスクにしない作業と残った作業をToDoに入れ、実行するときはタスクに移して外す", () => {
  assert.match(section(skill, "引数"), /最初の語が`todo`：ToDoを扱う/u);
  const todo = section(skill, "ToDoの管理");
  assert.match(todo, /環境や優先度の都合で今は割り当てない作業があるとき：捨てずにToDoに足す/u);
  assert.match(todo, /今のチームのタスクとして足し（「進行中のチームへのタスクの追加」）、`todo\.json`から外す/u);
  assert.match(todo, /ToDoを、ほかの理由で黙って外さない/u);
  const steps = section(skill, "リーダーの手順");
  assert.match(steps, /今は割り当てない作業は、タスクにせず、捨てずにToDoに足す/u);
  assert.match(steps, /`todo\.json`に残っているToDoがあれば、その一覧もあわせて示す/u);
  assert.match(section(worker, "守ること"), /`team\.json`と`todo\.json`は書かない/u);
});