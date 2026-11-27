// plan-dispatch の team.json のうち、このmodが読む部分。
export type Worker = {
  id: string
  session: string
  // セッションのID。タブへのジャンプに使う。古いSkillのチームと、参加を受け付ける前は空。
  sessionId: string
  status: string
  task: string | null
}

export type Task = {
  id: string
  title: string
  status: string
  worker: string | null
  dependsOn: string[]
  // 担当のワーカーの最後の報告（done か blocked）を一言で表した言葉。リーダーが team.json に書く。まだ無ければ空。
  note: string
  // タスクのファイルの「結果」の「要約」の、先頭の3行まで。まだ書かれていなければ空。
  summary: string[]
}

export type Team = {
  teamId: string
  status: string
  leader: string
  leaderSessionId: string
  workers: Worker[]
  tasks: Task[]
  updatedAt: string
}

// ペインに描くもの。チームが1つも無い（探したディレクトリ）、このタブのチームがまだ無い、知らない版、このタブのチーム。
// チームのときは、タスクのファイルの場所（dir：チームのディレクトリの絶対パス）と、このタブのセッションのID（self）も持つ。
export type View =
  | { kind: 'none'; dir: string }
  | { kind: 'not-created'; dir: string }
  | { kind: 'unknown-version'; version: string }
  | { kind: 'team'; team: Team; dir: string; self: string }

// plan-dispatch の todo.json の1件のうち、このmodが読む部分。まだどのチームのタスクにもしていない作業。
export type Todo = {
  id: string
  title: string
  // 概要の、空でない行の先頭の3行まで。
  summary: string[]
  // 対応するPlanのファイルのパス。無ければ空。
  plan: string
  // 関連する、または先に終わる必要があるタスクやToDoの、名前かID。
  related: string[]
}

// ToDoの表示。todo.json が無い、読めたToDoの一覧、知らない版。
export type TodoView = { kind: 'none' } | { kind: 'list'; todos: Todo[] } | { kind: 'unknown-version'; version: string }

declare module 'claude-code' {
  interface PluginState {
    'plan-dispatch-view': {
      todos: Shaped<TodoView>
      view: Shaped<View>
      // join で参加したタブで表示するチームID。空なら、このタブのセッションのIDで選ぶ。
      teamId: Shaped<string>
    }
  }
}
