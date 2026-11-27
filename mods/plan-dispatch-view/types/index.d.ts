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

// 結果の節を開いているタスク。teamId のチームのものだけが有効で、表示するチームが変わったら空にする。
// results は、タスクIDから「結果」の節の本文への対応。キーがあるタスクが開いている。null は、タスクのファイルを読めなかったこと。
export type Opened = { teamId: string; results: Record<string, string | null> }

declare module 'claude-code' {
  interface PluginState {
    'plan-dispatch-view': {
      view: Shaped<View>
      // join で参加したタブで表示するチームID。空なら、このタブのセッションのIDで選ぶ。
      teamId: Shaped<string>
      opened: Shaped<Opened>
    }
  }
}
