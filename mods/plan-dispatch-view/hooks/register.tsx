import { atom, read, update } from 'claude-code'
import type { Color, EngineInterface, Register, RenderChildren } from 'claude-code'

import type { Task, Team, View, Worker } from '../types'

const PANE = 'plan-dispatch-view'
const TITLE = 'plan-dispatch'
const DIR = 'plan/.dispatch'
// team.json を読み直す間隔。ファイルの変更を知らせる仕組みが無いので、数秒ごとに読む。
const INTERVAL_MS = 3000
// team.json の版。知らない版は表示せず、modの更新を促す。
const KNOWN_VERSION = 1
// Skill の呼び出し名（スラッシュを除く）。入れ方で変わる。
// ペインの行の列の幅（桁）。最後の列（セッション名、タスクの題名）をなるべく長くするため、各列は最も長い値に1〜2桁の余白を足しただけにする。
// 1列目は項目名かID（最も長い「Progress:」。タスクIDが3桁でも「☑ T001」で収まる）、2列目は状態（最も長い「Invited」「Working」など7桁）、
// 3列目は担当のタスクかワーカー（「T01」「W01」。3桁の「T001」でも収まる）。
const COLUMNS = [10, 8, 5]
const SKILL_NAMES =new Set(['plan-dispatch', 'plan-dispatch:plan-dispatch', 'anthropic-skills:plan-dispatch'])

const view = atom({ plugin: 'plan-dispatch-view', key: 'view' } as const, { kind: 'none' } as View, {
  shape: 'view-1',
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

// 表示する team.json を選ぶ。join で参加したタブはそのチーム、それ以外は更新時刻が最も新しいチーム。
async function teamFile($: EngineInterface): Promise<string | null> {
  const id = await read($, pinned)
  if (id !== '') {
    const file = `${DIR}/${id}/team.json`
    if (await $.fs.exists(file)) return file
  }
  const entries = await $.fs.list(DIR).catch(() => [])
  let best: { file: string; mtimeMs: number } | null = null
  for (const entry of entries) {
    if (entry.kind !== 'dir') continue
    const file = `${DIR}/${entry.name}/team.json`
    const stat = await $.fs.stat(file).catch(() => undefined)
    if (stat && stat.kind === 'file' && (best === null || stat.mtimeMs > best.mtimeMs)) best = { file, mtimeMs: stat.mtimeMs }
  }
  return best?.file ?? null
}

// team.json を読み直す。書き込みの途中で読めないか、JSONとして壊れていれば、前の表示を残す。
async function refresh($: EngineInterface): Promise<void> {
  const file = await teamFile($)
  if (file === null) {
    await update($, view, () => ({ kind: 'none' }) as View)
    return
  }
  let data: unknown
  try {
    data = JSON.parse(await $.fs.read(file))
  } catch {
    return
  }
  if (typeof data !== 'object' || data === null) return
  const record = data as Record<string, unknown>
  const next: View =
    record.version === KNOWN_VERSION
      ? { kind: 'team', team: toTeam(record) }
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
      return <Text dimColor>チームがありません（plan/.dispatch/にteam.jsonが無い）。</Text>
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
          <Line bold>{team.teamId}</Line>
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
