// plan-dispatch の team.json のうち、このmodが読む部分。
export type Worker = {
  id: string
  session: string
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
  workers: Worker[]
  tasks: Task[]
  updatedAt: string
}

// ペインに描くもの。チームが無い、知らない版、読めたチーム。
export type View =
  | { kind: 'none' }
  | { kind: 'unknown-version'; version: string }
  | { kind: 'team'; team: Team }

declare module 'claude-code' {
  interface PluginState {
    'plan-dispatch-view': {
      view: Shaped<View>
      // join で参加したタブで表示するチームID。空なら最も新しいチーム。
      teamId: Shaped<string>
    }
  }
}
