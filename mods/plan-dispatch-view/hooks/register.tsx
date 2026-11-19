import { atom, read, update } from 'claude-code'
import type { Color, EngineInterface, Register, RenderChildren } from 'claude-code'

import type { Task, Team, View, Worker } from '../types'

const PANE = 'plan-dispatch-view'
const TITLE = 'plan-dispatch'
// チームのディレクトリ。gitのメインの作業ツリーのルート（gitでなければセッションのプロジェクトのルート）からの位置。
// 相対パスは作業ディレクトリが基準になり、worktreeに移ると見失うので、使わない。
const DIR = 'plan/.dispatch'
// team.json を読み直す間隔。ファイルの変更を知らせる仕組みが無いので、数秒ごとに読む。
const INTERVAL_MS = 3000
// team.json の版。知らない版は表示せず、modの更新を促す。
const KNOWN_VERSION = 1
// ペインの行の列の幅（桁）。最後の列（セッション名、タスクの題名）をなるべく長くするため、各列は最も長い値に1〜2桁の余白を足しただけにする。
// 1列目は項目名かID（最も長い「Progress:」。タスクIDが3桁でも「☑ T001」で収まる）、2列目は状態（最も長い「Invited」「Working」など7桁）、
// 3列目は担当のタスクかワーカー（「T01」「WA01」。3桁の「T001」「WA001」でも収まる）。
const COLUMNS = [10, 8, 5]
// Skill の呼び出し名（スラッシュを除く）。入れ方で変わる。
const SKILL_NAMES = new Set(['plan-dispatch', 'plan-dispatch:plan-dispatch', 'anthropic-skills:plan-dispatch'])

const view = atom({ plugin: 'plan-dispatch-view', key: 'view' } as const, { kind: 'none', dir: DIR } as View, {
  shape: 'view-2',
})
const pinned = atom({ plugin: 'plan-dispatch-view', key: 'teamId' } as const, '', { shape: 'team-id-1' })

// 状態の表示の語と色。色はテーマの色の名前で指定し、利用者のテーマ（ライトとダーク）に合わせる。
type Status = { label: string; color?: Color }
const TEAM_STATUS: Record<string, Status> = {
  active: { label: 'Active', color: 'suggestion' },
  done: { label: 'Done', color: 'success' },
  stopped: { label: 'Stopped', color: 'warning' },
}
const WORKER_STATUS: Record<string, Status> = {
  invited: { label: 'Invited', color: 'suggestion' },
  working: { label: 'Working', color: 'claude' },
  idle: { label: 'Idle' },
  gone: { label: 'Gone', color: 'error' },
}
const TASK_STATUS: Record<string, Status> = {
  pending: { label: 'Pending', color: 'inactive' },
  assigned: { label: 'Working', color: 'claude' },
  done: { label: 'Done', color: 'success' },
  blocked: { label: 'Blocked', color: 'error' },
}
// 知らない状態は、そのままの語を色なしで表示する。
const statusOf = (table: Record<string, Status>, key: string): Status => table[key] ?? { label: key }

const text = (v: unknown): string => (typeof v === 'string' ? v : '')

// team.json の値から、表示に使う部分だけを取り出す。欠けた値は空にする。
function toTeam(data: Record<string, unknown>): Team {
  const list = (v: unknown): Record<string, unknown>[] =>
    Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null) : []
  const workers: Worker[] = list(data.workers).map(w => ({
    id: text(w.id),
    session: text(w.session),
    status: text(w.status),
    task: typeof w.task === 'string' && w.task !== '' ? w.task : null,
  }))
  const tasks: Task[] = list(data.tasks).map(t => ({
    id: text(t.id),
    title: text(t.title),
    status: text(t.status),
    worker: typeof t.worker === 'string' && t.worker !== '' ? t.worker : null,
    dependsOn: Array.isArray(t.dependsOn) ? t.dependsOn.filter((d): d is string => typeof d === 'string') : [],
  }))
  return {
    teamId: text(data.teamId),
    status: text(data.status),
    leader: text(data.leader),
    workers,
    tasks,
    updatedAt: text(data.updatedAt),
  }
}

// 読み直しのタイマー。ペインを開いたときに始め、閉じたときに止める。modを読み直すと、作り直される。
let timer: { cancel: () => void } | undefined

// チームのディレクトリの絶対パス。worktreeの中のセッションでも、メインの作業ツリーのものを使う（リーダーもそこに書く）。
async function dispatchDir($: EngineInterface): Promise<string> {
  const repo = await $.session.repo().catch(() => null)
  const root = repo?.root ?? (await $.session.root())
  return `${root.replace(/\\/gu, '/').replace(/\/$/u, '')}/${DIR}`
}

type Candidate = { dir: string; record: Record<string, unknown>; mtimeMs: number }

// このタブのセッションが、リーダーかワーカーとして記録されているか。
function involves(record: Record<string, unknown>, sessionId: string): boolean {
  if (sessionId === '') return false
  if (record.leaderSessionId === sessionId) return true
  const workers = Array.isArray(record.workers) ? record.workers : []
  return workers.some(w => typeof w === 'object' && w !== null && (w as Record<string, unknown>).sessionId === sessionId)
}

// 表示するチームを、次の順に選ぶ。
// 1. join で参加したタブで覚えたチーム
// 2. このタブのセッションが記録されているチーム（複数なら更新時刻が最も新しいもの）
// 3. ほかのタブのチーム（進行中のうち最も新しいもの。無ければ最も新しいもの）。isOwn を false にして、そのことを表示する
function choose(candidates: Candidate[], pinnedId: string, sessionId: string): { chosen: Candidate; isOwn: boolean } | null {
  const newest = (list: Candidate[]) => list.reduce<Candidate | null>((a, b) => (a === null || b.mtimeMs > a.mtimeMs ? b : a), null)
  const pinnedTeam = candidates.find(c => c.dir === pinnedId)
  if (pinnedId !== '' && pinnedTeam) return { chosen: pinnedTeam, isOwn: true }
  const own = newest(candidates.filter(c => involves(c.record, sessionId)))
  if (own) return { chosen: own, isOwn: true }
  const other = newest(candidates.filter(c => c.record.status === 'active')) ?? newest(candidates)
  return other ? { chosen: other, isOwn: false } : null
}

// team.json を読み直す。
// 書き込みの途中で今のチームの team.json が読めなかったときと、ディレクトリの一覧を読めなかったときは、前の表示を残す。
async function refresh($: EngineInterface): Promise<void> {
  const base = await dispatchDir($)
  let entries: { name: string; kind: string }[]
  try {
    entries = (await $.fs.exists(base)) ? await $.fs.list(base) : []
  } catch {
    return
  }
  const current = await read($, view)
  const shownId = current.kind === 'team' ? current.team.teamId : ''
  const candidates: Candidate[] = []
  for (const entry of entries) {
    if (entry.kind !== 'dir') continue
    const file = `${base}/${entry.name}/team.json`
    const stat = await $.fs.stat(file).catch(() => undefined)
    if (!stat || stat.kind !== 'file') continue
    let data: unknown
    try {
      data = JSON.parse(await $.fs.read(file))
    } catch {
      if (entry.name === shownId) return
      continue
    }
    if (typeof data === 'object' && data !== null) {
      candidates.push({ dir: entry.name, record: data as Record<string, unknown>, mtimeMs: stat.mtimeMs })
    }
  }
  const picked = choose(candidates, await read($, pinned), await $.session.id().catch(() => ''))
  if (picked === null) {
    await update($, view, () => ({ kind: 'none', dir: base }) as View)
    return
  }
  const { record } = picked.chosen
  const next: View =
    record.version === KNOWN_VERSION
      ? { kind: 'team', team: toTeam(record), isOwn: picked.isOwn }
      : { kind: 'unknown-version', version: String(record.version) }
  await update($, view, () => next)
}

async function openPane($: EngineInterface): Promise<boolean> {
  const placed = await $.ui.open({ id: PANE, title: TITLE })
  await refresh($)
  if (timer === undefined) {
    timer = $.clock.every(INTERVAL_MS, () => {
      void refresh($).catch(() => undefined)
    })
  }
  return placed.isPlaced
}

export const register: Register = (on, options) => {
  const autoOpen = options.autoOpen !== false

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'plan-dispatch-view',
      description: 'plan-dispatchのチームの進捗をペインに表示する',
    })

    return next(e)
  })

  on('command.run', { command: 'plan-dispatch-view' }, async $ => {
    const isPlaced = await openPane($)

    return { text: isPlaced ? 'plan-dispatchの進捗のペインを開いた。' : 'plan-dispatchの進捗のペインを開いた（この画面では表示されない）。' }
  })

  // Skill を呼んだプロンプトでペインを開く。プロンプトは、そのまま次に渡す。
  on('prompt.submit', async ($, e, next) => {
    const name = e.command?.name
    if (autoOpen && name !== undefined && SKILL_NAMES.has(name)) {
      try {
        const words = (e.command?.args ?? '').trim().split(/\s+/u)
        // join <チームID> … で参加したタブは、そのチームを表示する。
        if (words[0] === 'join' && words[1] !== undefined && words[1] !== '') await update($, pinned, () => words[1])
        await openPane($)
      } catch {
        // ペインを開けなくても、プロンプトは止めない。
      }
    }

    return next(e)
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) {
      timer?.cancel()
      timer = undefined
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Progress } = $.ui.resolve(e)
    const v = await read($, view)
    // 行の切り詰めは、画面の側に任せる。VS Codeでは文字の幅がまちまちで、bodyColumnsから数えると、描ける幅よりかなり手前で切れるため。
    const Line = (p: { bold?: boolean; dimColor?: boolean; children: RenderChildren }) => (
      <Text bold={p.bold} dimColor={p.dimColor} wrap="truncate-end">
        {p.children}
      </Text>
    )
    // 色と太字は状態の語だけに付ける。行の全体に付けると、IDや題名まで色が付いて読みにくいため。
    const Label = (p: { status: Status }) => (
      <Text bold color={p.status.color}>
        {p.status.label}
      </Text>
    )
    // Team、Worker、Taskの3つの節の行を、同じ列の並び（COLUMNS）で描く。最後のセルは、残りの幅を使う。
    // VS Codeは文字の幅がまちまちなので、空白を詰めてそろえる方法は使えない。
    const Row = (p: { id: string; cells: RenderChildren[] }) => (
      <Box key={p.id} flexDirection="row">
        {p.cells.map((cell, i) =>
          i < p.cells.length - 1 ? (
            <Box width={COLUMNS[i]} flexShrink={0}>
              {cell}
            </Box>
          ) : (
            <Box flexGrow={1} flexDirection="column">
              {cell}
            </Box>
          ),
        )}
      </Box>
    )
    const Heading = (p: { children: string }) => (
      <Box marginTop={1}>
        <Text bold>{p.children}</Text>
      </Box>
    )

    if (v.kind === 'none') {
      return <Text dimColor>チームがありません（{v.dir}にteam.jsonが無い）。</Text>
    }
    if (v.kind === 'unknown-version') {
      return (
        <Text>
          team.jsonの版（{v.version}）に、このmodは対応していません。modを更新してください。
        </Text>
      )
    }

    const { team } = v
    const total = team.tasks.length
    const done = team.tasks.filter(t => t.status === 'done').length
    const working = team.workers.filter(w => w.status === 'working').length
    const blocked = team.tasks.filter(t => t.status === 'blocked').length
    // チームIDは長くなりやすく、狭い幅では切り詰められる。チームの状態は、次の行の先頭に置いて必ず見えるようにする。
    const state = statusOf(TEAM_STATUS, team.status)
    const max = total > 0 ? total : 1

    // 狭いとき（プロンプトの上）は、要約だけを描く。
    if (e.props.placement === 'inline') {
      return (
        <Box flexDirection="column">
          <Line bold>{v.isOwn ? team.teamId : `${team.teamId}（このタブが参加していないチーム）`}</Line>
          <Progress label="Progress:" value={done} max={max} valueText={`${done} / ${total}`} />
          <Line>
            <Label status={state} />
            {`  Workers ${team.workers.length} (${working} working), Tasks ${done}/${total} done, ${blocked} blocked`}
          </Line>
        </Box>
      )
    }

    // どの節も、1列目が項目名かID、2列目が状態。セッション名とタスクの題名は最後の列に置き、幅が足りなければそこから切り詰められる。
    return (
      <Box flexDirection="column">
        <Text bold>Team</Text>
        {!v.isOwn && <Line dimColor>このタブが参加していないチーム（最も新しいチーム）</Line>}
        <Row id="team-id" cells={[<Line>ID:</Line>, <Line>{team.teamId}</Line>]} />
        <Row id="team-status" cells={[<Line>Status:</Line>, <Label status={state} />]} />
        <Row id="team-leader" cells={[<Line>Leader:</Line>, <Line>{team.leader}</Line>]} />
        <Row
          id="team-progress"
          cells={[
            <Line>Progress:</Line>,
            // 項目名は1列目に描くので、Progressには値（3 / 3）を名前として渡し、valueTextは空にして百分率を描かせない。
            <Progress label={`${done} / ${total}`} value={done} max={max} valueText="" />,
          ]}
        />
        <Heading>Worker</Heading>
        {team.workers.length === 0 && <Text dimColor>まだいません</Text>}
        {team.workers.map(w => (
          <Row
            id={w.id}
            cells={[
              // Taskの行の☑/☐に合わせて、先頭に箇条書きの記号を付ける。IDの後ろのコロンは、Teamの項目名（Status:など）と形をそろえ、IDと値を見分けやすくするため。
              <Line>{`• ${w.id}:`}</Line>,
              <Label status={statusOf(WORKER_STATUS, w.status)} />,
              <Line>{w.task ?? '-'}</Line>,
              <Line dimColor>{w.session}</Line>,
            ]}
          />
        ))}
        <Heading>Task</Heading>
        {team.tasks.map(t => {
          const isDone = t.status === 'done'
          return (
            <Row
              id={t.id}
              cells={[
                <Line dimColor={isDone}>{`${isDone ? '☑' : '☐'} ${t.id}:`}</Line>,
                <Label status={statusOf(TASK_STATUS, t.status)} />,
                <Line dimColor={isDone}>{t.worker ?? '-'}</Line>,
                <Line dimColor={isDone}>{t.title}</Line>,
              ]}
            />
          )
        })}
      </Box>
    )
  })
}
