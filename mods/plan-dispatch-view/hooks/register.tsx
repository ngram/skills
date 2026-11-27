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
// Teamの節の行の1列目（項目名。最も長い「Progress:」）の幅（桁）。値の列は、残りの幅を使う。
const COLUMNS = [10]
// ワーカーは、セッション名（タブの見出しの名前）で表示する。ワーカーID（WA01など）はリーダーとワーカーの間の記号で、利用者はタブの名前で見分けるため。
// セッション名は、表示幅（全角2桁、半角1桁）がNAME_MAXを超えたら末尾を「…」にする。リンク（Markdown）は画面の側で切り詰められないので、ここで切る。
const NAME_MAX = 16
// Workerの節は、ワーカーを表の列として横に並べるので、ワーカーの名前はWORKER_NAME_MAX桁で省略する。Taskの行の右端の担当のワーカーも同じ長さにする。
const WORKER_NAME_MAX = 8
const width = (c: string) => ((c.codePointAt(0) ?? 0) > 0xff ? 2 : 1)
function shorten(s: string, max = NAME_MAX): string {
  if ([...s].reduce((n, c) => n + width(c), 0) <= max) return s
  let out = ''
  let used = 0
  for (const c of s) {
    if (used + width(c) > max - 1) break
    out += c
    used += width(c)
  }
  return `${out}…`
}
// Skill の呼び出し名（スラッシュを除く）。入れ方で変わる。
const SKILL_NAMES = new Set(['plan-dispatch', 'plan-dispatch:plan-dispatch', 'anthropic-skills:plan-dispatch'])

const view = atom({ plugin: 'plan-dispatch-view', key: 'view' } as const, { kind: 'none', dir: DIR } as View, {
  shape: 'view-5',
})
const pinned = atom({ plugin: 'plan-dispatch-view', key: 'teamId' } as const, '', { shape: 'team-id-1' })

// ボタンからVS Codeのコマンドに渡す値の形。team.json の値をそのままシェル（Windowsの cmd.exe）に渡さないよう、この形のものだけを使う。
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
const TASK_ID = /^T\d{2,3}$/u

// タスクのファイルから「結果」の節（見出しの次の行から、次の「## 」の見出しの前まで）を取り出す。節が無ければ空にする。
function resultSection(markdown: string): string {
  const lines = markdown.replace(/\r\n/gu, '\n').split('\n')
  const start = lines.findIndex(l => /^## 結果\s*$/u.test(l))
  if (start === -1) return ''
  const end = lines.findIndex((l, i) => i > start && /^## /u.test(l))
  return lines
    .slice(start + 1, end === -1 ? undefined : end)
    .join('\n')
    .trim()
}

// 「結果」の節の中の「### 要約」から、空でない行を先頭の3行まで取り出す。箇条書きの記号は除く。
// ワーカーは要約を3行以内で書く決まり（worker.md）なので、Taskの節では、タスクの題名の下にこの3行を表示する。
const SUMMARY_LINES = 3
function summaryOf(result: string): string[] {
  const lines = result.split('\n')
  const start = lines.findIndex(l => /^### 要約\s*$/u.test(l))
  if (start === -1) return []
  const end = lines.findIndex((l, i) => i > start && /^#{2,3} /u.test(l))
  return lines
    .slice(start + 1, end === -1 ? undefined : end)
    .map(l => l.replace(/^\s*[-*]\s+/u, '').trim())
    .filter(l => l !== '')
    .slice(0, SUMMARY_LINES)
}

// セッションのタブを開くURI。セッションIDはSESSION_IDの形のものだけを渡すので、シェルで解釈される文字は入らない。
const sessionUri = (sessionId: string) => `vscode://anthropic.claude-code/open?session=${sessionId}`

// ペインのジャンプは、ボタンではなくMarkdownのリンクとして描く（VS Code拡張のボタンは目立ちすぎるため）。
// Markdownのリンクは https: でないと描かれないので、どこにもつながらない .invalid のURLにセッションIDを入れ、押されたらmodが取り出して開く。
const JUMP_PREFIX = 'https://plan-dispatch.invalid/session/'
const jumpHref = (sessionId: string) => `${JUMP_PREFIX}${sessionId}`
const sessionOfHref = (href: string) => (href.startsWith(JUMP_PREFIX) ? href.slice(JUMP_PREFIX.length) : '')
// リンクの文字（タスクの題名など）に含まれるMarkdownの記号を、そのまま描くようにエスケープする。
const escapeMarkdown = (s: string) => s.replace(/[\\`*_[\]()#+\-.!|<>~]/gu, c => `\\${c}`)

// URIを、VS CodeのCLI（code --open-url）で開く。ペインのリンクは https: 以外を開けず、explorer.exe 経由では
// Claude Code の拡張のURIが届かないため。Windows（ルートがドライブ名で始まる）では、code.cmd を cmd.exe で実行する。
async function openUri($: EngineInterface, uri: string, root: string): Promise<void> {
  const argv = /^[A-Za-z]:\//u.test(root) ? ['cmd.exe', '/d', '/c', 'code', '--open-url', uri] : ['code', '--open-url', uri]
  try {
    const r = await $.process.run(argv, { timeoutMs: 20000 })
    if (r.exitCode !== 0) {
      await $.ui.toast(`VS Codeのコマンドcodeが失敗しました（終了コード${r.exitCode}）。${r.stderr.trim()}`)
    }
  } catch (err) {
    await $.ui.toast(`VS Codeのコマンドcodeを実行できません。${String(err)}`)
  }
}

// 状態の表示の語と色。色はテーマの色の名前で指定し、利用者のテーマ（ライトとダーク）に合わせる。
type Status = { label: string; color?: Color }
const TEAM_STATUS: Record<string, Status> = {
  active: { label: 'Active', color: 'suggestion' },
  done: { label: 'Done', color: 'success' },
  stopped: { label: 'Stopped', color: 'warning' },
}
// 知らない状態は、そのままの語を色なしで表示する。
const statusOf = (table: Record<string, Status>, key: string): Status => table[key] ?? { label: key }

// ワーカーとタスクの状態の色。VS Code拡張のタブのアイコンの点の色と意味をそろえる。ペインでは同じ意味の絵文字（DOT_EMOJI）で示し、依存関係の図ではこの色で塗る。
// タブのアイコンは、ターンを終えて未読ならオレンジ（#D97757）、権限の確認など利用者の応答を待っていれば青（#3B82F6）になる。
// そこで、作業を終えて報告済み（結果を見る段階）をオレンジ、blockedで答えを待っているのを青にし、作業中は緑にする。
const DOT = {
  working: '#2f8f5b',
  done: '#D97757',
  waiting: '#3B82F6',
  none: '#8a8f98',
  gone: '#c94040',
} as const
type Dot = keyof typeof DOT
// Workerの節はMarkdownの表で描き、Markdownでは文字に色を付けられないので、状態は同じ意味の色の絵文字で示す。
// Taskの節も、Workerの表とそろえて同じ絵文字にする。
const DOT_EMOJI: Record<Dot, string> = { working: '🟢', done: '🟠', waiting: '🔵', none: '⚪', gone: '🔴' }
// Workerの表のセルの左右の余白。改行なしの空白（U+00A0）2つ。
const CELL_PAD = '  '
const TASK_DOT: Record<string, Dot> = { pending: 'none', assigned: 'working', done: 'done', blocked: 'waiting' }
const taskDot = (t: Task): Dot => TASK_DOT[t.status] ?? 'none'
// ワーカーの状態。担当中のタスクがblockedなら青、作業中なら緑、終えたタスクがあって次を待っていればオレンジ。
function workerDot(w: Worker, tasks: Task[]): Dot {
  if (w.status === 'gone') return 'gone'
  if (w.status === 'working') return tasks.find(t => t.id === w.task)?.status === 'blocked' ? 'waiting' : 'working'
  if (w.status === 'idle' && tasks.some(t => t.worker === w.id && t.status === 'done')) return 'done'
  return 'none'
}

// 依存関係の図のノードの色。DOTの色にする。SVGは画像として描かれ、テーマの色の名前を使えないので、色の値で指定する。
// 進行中、完了、判断待ちは塗りつぶして白い字にする。未着手と知らない状態は枠だけにして、塗りつぶしたものと見分けやすくする。
const GRAPH_FILL: Record<string, string> = { assigned: DOT.working, done: DOT.done, blocked: DOT.waiting }
const GRAPH_GRAY = '#8a8f98'
// ノードの大きさと間隔（ピクセル）。ノードには、1行目に「タスクID:」、2行目に題名を書く。
// ノードの幅は、最も長い題名に合わせてそろえる（題名は18文字以内の決まりなので、最大でおよそ200ピクセル）。
const NODE_MIN_W = 56
const NODE_H = 40
const NODE_PAD_X = 8
// 題名の文字の大きさ（ピクセル）と、幅の見積もり。全角は文字の大きさと同じ幅、半角は等幅のフォントのおよそ0.6倍の幅とする。
const TITLE_SIZE = 11
const textWidth = (s: string, size: number) => [...s].reduce((w, c) => w + ((c.codePointAt(0) ?? 0) > 0xff ? size : size * 0.6), 0)
const GAP_X = 32
const GAP_Y = 10
const PAD = 2

const escapeXml = (s: string) =>
  s.replace(/[&<>"]/gu, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)

// 依存関係の図のSVG。依存の無いタスクを左端の列に置き、各タスクを依存先のうち最も右の列の、1つ右の列に置く。
// 依存先が完了した矢印は実線、未完了の矢印は破線にして、着手できるタスクを見分けられるようにする。
// 依存が1つも無ければ null を返す（図を描かない）。存在しないタスクIDへの依存は無視する。
function dependencyGraph(tasks: Task[]): { source: string; alt: string; width: number; height: number } | null {
  const byId = new Map(tasks.map(t => [t.id, t]))
  const edges = tasks.flatMap(t => t.dependsOn.filter(d => byId.has(d) && d !== t.id).map(d => ({ from: d, to: t.id })))
  if (edges.length === 0) return null

  // 列の番号。循環があれば、たどっている途中のタスクを0列目とみなして打ち切る。
  const layer = new Map<string, number>()
  const visiting = new Set<string>()
  const layerOf = (id: string): number => {
    const known = layer.get(id)
    if (known !== undefined) return known
    if (visiting.has(id)) return 0
    visiting.add(id)
    const deps = byId.get(id)?.dependsOn.filter(d => byId.has(d) && d !== id) ?? []
    const n = deps.length === 0 ? 0 : Math.max(...deps.map(layerOf)) + 1
    visiting.delete(id)
    layer.set(id, n)
    return n
  }
  for (const t of tasks) layerOf(t.id)
  // 依存されるタスクは、依存元のうち最も左の列の、1つ左の列まで右に寄せる。
  // 依存の無いタスクが左端に残ると、遠くの列への長い矢印がほかのノードを横切るため。右の列から順に決める。
  const outgoing = (id: string) => edges.filter(e => e.from === id).map(e => e.to)
  for (const t of [...tasks].sort((a, b) => layer.get(b.id)! - layer.get(a.id)!)) {
    const children = outgoing(t.id)
    if (children.length === 0) continue
    const latest = Math.min(...children.map(c => layer.get(c)!)) - 1
    if (latest > layer.get(t.id)!) layer.set(t.id, latest)
  }

  // 列の中の順。左端の列はタスクの順、ほかの列は依存先の行の平均の順にして、矢印の交差を減らす。依存先の無いタスクは列の最後に置く。
  const columns: string[][] = []
  for (const t of tasks) (columns[layer.get(t.id)!] ??= []).push(t.id)
  const row = new Map<string, number>()
  columns.forEach((ids, c) => {
    if (c > 0) {
      const center = (id: string) => {
        const rows = (byId.get(id)?.dependsOn ?? []).map(d => row.get(d)).filter((r): r is number => r !== undefined)
        return rows.length === 0 ? Infinity : rows.reduce((a, b) => a + b, 0) / rows.length
      }
      ids.sort((a, b) => center(a) - center(b))
    }
    ids.forEach((id, r) => row.set(id, r))
  })

  const NODE_W = Math.ceil(Math.max(NODE_MIN_W, ...tasks.map(t => textWidth(t.title, TITLE_SIZE) + NODE_PAD_X * 2)))
  const pos = new Map<string, { x: number; y: number }>()
  columns.forEach((ids, c) =>
    ids.forEach((id, r) => pos.set(id, { x: PAD + c * (NODE_W + GAP_X), y: PAD + r * (NODE_H + GAP_Y) })),
  )
  const width = PAD * 2 + columns.length * NODE_W + (columns.length - 1) * GAP_X
  // 循環があると空の列ができることがあるので、reduce で空の列を飛ばす。
  const height = PAD * 2 + columns.reduce((m, ids) => Math.max(m, ids.length), 0) * (NODE_H + GAP_Y) - GAP_Y

  // 1つのノードに複数の矢印が出入りするときは、付け根を縦に散らして、重ならないようにする。相手のノードの上下の順に並べる。
  const port = (id: string, others: string[], other: string) => {
    const sorted = [...others].sort((a, b) => pos.get(a)!.y - pos.get(b)!.y)
    const i = sorted.indexOf(other)
    return pos.get(id)!.y + (NODE_H * (i + 1)) / (sorted.length + 1)
  }
  const incoming = (id: string) => edges.filter(e => e.to === id).map(e => e.from)
  const lines = edges.map(({ from, to }) => {
    const x1 = pos.get(from)!.x + NODE_W
    const y1 = port(from, outgoing(from), to)
    const x2 = pos.get(to)!.x - 1
    const y2 = port(to, incoming(to), from)
    const mid = (x1 + x2) / 2
    const dash = byId.get(from)?.status === 'done' ? '' : ' stroke-dasharray="4 3"'
    return `<path d="M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}" fill="none" stroke="${GRAPH_GRAY}" stroke-width="1.5"${dash} marker-end="url(#arrow)"/>`
  })
  const nodes = tasks.map(t => {
    const { x, y } = pos.get(t.id)!
    const fill = GRAPH_FILL[t.status]
    const rect = fill
      ? `<rect x="${x}" y="${y}" width="${NODE_W}" height="${NODE_H}" rx="6" fill="${fill}"/>`
      : `<rect x="${x + 0.75}" y="${y + 0.75}" width="${NODE_W - 1.5}" height="${NODE_H - 1.5}" rx="6" fill="none" stroke="${GRAPH_GRAY}" stroke-width="1.5"/>`
    const color = fill ? '#ffffff' : GRAPH_GRAY
    const label =
      `<text x="${x + NODE_W / 2}" y="${y + 13}" fill="${color}">${escapeXml(t.id)}:</text>` +
      `<text x="${x + NODE_W / 2}" y="${y + 28}" fill="${color}" font-size="${TITLE_SIZE}" font-weight="400">${escapeXml(t.title)}</text>`
    return rect + label
  })
  const source = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<defs><marker id="arrow" viewBox="0 0 8 8" refX="8" refY="4" markerWidth="6" markerHeight="6" markerUnits="userSpaceOnUse" orient="auto"><path d="M0 0 L8 4 L0 8 z" fill="${GRAPH_GRAY}"/></marker></defs>`,
    `<g font-family="ui-monospace, Menlo, Consolas, monospace" font-size="12" font-weight="600" text-anchor="middle" dominant-baseline="central">`,
    ...lines,
    ...nodes,
    '</g></svg>',
  ].join('')
  const alt = `タスクの依存関係：${edges.map(e => `${e.to}は${e.from}に依存`).join('、')}`
  return { source, alt, width, height }
}

const text = (v: unknown): string => (typeof v === 'string' ? v : '')

// team.json の値から、表示に使う部分だけを取り出す。欠けた値は空にする。
function toTeam(data: Record<string, unknown>): Team {
  const list = (v: unknown): Record<string, unknown>[] =>
    Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null) : []
  const workers: Worker[] = list(data.workers).map(w => ({
    id: text(w.id),
    session: text(w.session),
    sessionId: text(w.sessionId),
    status: text(w.status),
    task: typeof w.task === 'string' && w.task !== '' ? w.task : null,
  }))
  const tasks: Task[] = list(data.tasks).map(t => ({
    id: text(t.id),
    title: text(t.title),
    status: text(t.status),
    worker: typeof t.worker === 'string' && t.worker !== '' ? t.worker : null,
    dependsOn: Array.isArray(t.dependsOn) ? t.dependsOn.filter((d): d is string => typeof d === 'string') : [],
    note: text(t.note).trim(),
    summary: [],
  }))
  return {
    teamId: text(data.teamId),
    status: text(data.status),
    leader: text(data.leader),
    leaderSessionId: text(data.leaderSessionId),
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

// 表示するチームを、次の順に選ぶ。どちらにも当たらなければ null を返す。
// 1. join で参加したタブで覚えたチーム
// 2. このタブのセッションが記録されているチーム（複数なら更新時刻が最も新しいもの）
// ほかのタブのチームは選ばない。新しいチームを作るタブで、team.json を書く前に古いチームが表示され、取り違えるため。
function choose(candidates: Candidate[], pinnedId: string, sessionId: string): Candidate | null {
  const newest = (list: Candidate[]) => list.reduce<Candidate | null>((a, b) => (a === null || b.mtimeMs > a.mtimeMs ? b : a), null)
  const pinnedTeam = candidates.find(c => c.dir === pinnedId)
  if (pinnedId !== '' && pinnedTeam) return pinnedTeam
  return newest(candidates.filter(c => involves(c.record, sessionId)))
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
  const self = await $.session.id().catch(() => '')
  const picked = choose(candidates, await read($, pinned), self)
  if (picked === null) {
    // team.json が1つも無いときと、ほかのタブのチームだけがあるときとで、表示を分ける。
    const kind = candidates.length === 0 ? 'none' : 'not-created'
    await update($, view, () => ({ kind, dir: base }) as View)
    return
  }
  const { record } = picked
  if (record.version !== KNOWN_VERSION) {
    await update($, view, () => ({ kind: 'unknown-version', version: String(record.version) }) as View)
    return
  }
  const dir = `${base}/${picked.dir}`
  // 各タスクの要約を、タスクのファイルから読む。読めなかったときは、前に読めた要約を残す（ワーカーが書いている途中のことがあるため）。
  const previous = current.kind === 'team' && current.team.teamId === text(record.teamId) ? current.team.tasks : []
  const parsed = toTeam(record)
  const tasks: Task[] = []
  for (const t of parsed.tasks) {
    const result = TASK_ID.test(t.id) ? await readResult($, dir, t.id) : ''
    const summary = result === null ? (previous.find(p => p.id === t.id)?.summary ?? []) : summaryOf(result)
    tasks.push({ ...t, summary })
  }
  const team: Team = { ...parsed, tasks }
  await update($, view, () => ({ kind: 'team', team, dir, self }) as View)
}

// タスクのファイルを読み、「結果」の節を返す。読めなければ null を返す。
async function readResult($: EngineInterface, dir: string, taskId: string): Promise<string | null> {
  try {
    return resultSection(await $.fs.read(`${dir}/tasks/${taskId}.md`))
  } catch {
    return null
  }
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
    const { Box, Text, Progress, Markdown } = $.ui.resolve(e)
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
    // 節の見出し。左に、テーマの色の縦線を付けて、節の区切りを見分けやすくする。
    // Boxには辺ごとの枠線が無いので、縦線は「▍」の文字で描く（ターミナルでも描ける）。最初の節（Team）だけ、上を空けない。
    const Heading = (p: { children: string; first?: boolean }) => (
      <Box key={`heading-${p.children}`} marginTop={p.first ? 0 : 1}>
        {/* 見出しの文字は、本文（body）より1段大きいheadingにする。ターミナルは文字の大きさが1つなので、変わらない。 */}
        <Text color="claude" size="title">
          ▍
        </Text>
        <Text bold size="title">
          {p.children}
        </Text>
      </Box>
    )

    if (v.kind === 'none') {
      return <Text dimColor>チームがありません（{v.dir}にteam.jsonが無い）。</Text>
    }
    if (v.kind === 'not-created') {
      return (
        <Text dimColor>
          このタブのチームは、まだ作成されていません。リーダーがチームを作るか、このタブがワーカーとして参加すると表示されます。
        </Text>
      )
    }
    if (v.kind === 'unknown-version') {
      return (
        <Text>
          team.jsonの版（{v.version}）に、このmodは対応していません。modを更新してください。
        </Text>
      )
    }

    const { team, dir, self } = v
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

    // 依存関係の図。Svgはターミナルに無いので、ターミナルでは描かない（依存先はTaskの節で分かる範囲にとどめる）。
    const Svg = e.surface === 'terminal' ? undefined : $.ui.resolve(e).Svg
    const graph = dependencyGraph(team.tasks)

    // タブへのジャンプは、VS Code拡張の画面だけで描く（ターミナルには前面に出すタブが無い）。
    // このタブ自身のセッションと、IDの形でない値はボタンにしない。
    const canJump = (sessionId: string) => e.surface === 'vscode' && SESSION_ID.test(sessionId) && sessionId !== self
    // ワーカーIDから、そのワーカーのセッションID。タスクの行から担当のワーカーのタブへジャンプするときに使う。
    const sessionOf = (workerId: string | null) => team.workers.find(w => w.id === workerId)?.sessionId ?? ''
    // Workerの節の表。1列が1人で、見出しの行に状態の絵文字と名前、次の行に担当中のタスクを書く。
    // ジャンプできるワーカーの名前はリンクにし、押されたらJumpLinkと同じく、URLからセッションIDを取り出してタブを開く。
    const WorkerTable = () => {
      const hrefs = team.workers.filter(w => canJump(w.sessionId)).map(w => jumpHref(w.sessionId))
      const head = team.workers.map(w => {
        const name = escapeMarkdown(workerName(w))
        return `${DOT_EMOJI[workerDot(w, team.tasks)]} ${canJump(w.sessionId) ? `[${name}](${jumpHref(w.sessionId)})` : name}`
      })
      const tasks = team.workers.map(w => escapeMarkdown(w.task ?? '-'))
      // どの列も中央そろえにし、セルの中身の前後に改行なしの空白（U+00A0）を置いて、左右に余白を作る。ふつうの空白は、Markdownで消えるため。
      const pad = (cell: string) => `${CELL_PAD}${cell}${CELL_PAD}`
      const row = (cells: string[]) => `| ${cells.map(pad).join(' | ')} |`
      const text = [row(head), `| ${team.workers.map(() => ':---:').join(' | ')} |`, row(tasks)].join('\n')
      return hrefs.length === 0 ? (
        <Markdown key="workers" text={text} />
      ) : (
        <Markdown
          key="workers"
          text={text}
          pressableLinks={hrefs}
          onLinkPress={async pressed => {
            const sessionId = sessionOfHref(pressed.href)
            if (canJump(sessionId)) await openUri($, sessionUri(sessionId), dir)
          }}
        />
      )
    }
    // ワーカーの表示名。セッション名を省略して使い、まだ無ければ（参加を受け付ける前など）ワーカーIDにする。
    const workerName = (w: Worker) => shorten(w.session !== '' ? w.session : w.id, WORKER_NAME_MAX)
    const workerNameOf = (workerId: string | null) => {
      const w = team.workers.find(x => x.id === workerId)
      return w ? workerName(w) : (workerId ?? '-')
    }
    // ジャンプのリンク。押されたリンクのURLからセッションIDを取り出し、形を確かめてからタブを開く。
    // Markdownは段落として描かれ、Textと横に並べると次の行に回り込むので、前後の文字（prefix、suffix）も同じMarkdownに入れる。
    const JumpLink = (p: { id: string; label: string; sessionId: string; bold?: boolean; prefix?: string; suffix?: string }) => {
      const href = jumpHref(p.sessionId)
      const link = `[${escapeMarkdown(p.label)}](${href})`
      return (
        <Markdown
          key={p.id}
          text={`${escapeMarkdown(p.prefix ?? '')}${p.bold ? `**${link}**` : link}${escapeMarkdown(p.suffix ?? '')}`}
          pressableLinks={[href]}
          onLinkPress={async pressed => {
            const sessionId = sessionOfHref(pressed.href)
            if (canJump(sessionId)) await openUri($, sessionUri(sessionId), dir)
          }}
        />
      )
    }

    // どの節も、1列目が項目名かID、2列目が状態。セッション名とタスクの題名は最後の列に置き、幅が足りなければそこから切り詰められる。
    return (
      <Box flexDirection="column">
        <Heading first>Team</Heading>
        <Row id="team-id" cells={[<Line>ID:</Line>, <Line>{team.teamId}</Line>]} />
        <Row id="team-status" cells={[<Line>Status:</Line>, <Label status={state} />]} />
        <Row
          id="team-leader"
          cells={[
            <Line>Leader:</Line>,
            canJump(team.leaderSessionId) ? (
              <JumpLink id="jump-leader" label={shorten(team.leader)} sessionId={team.leaderSessionId} />
            ) : (
              <Line>{team.leader}</Line>
            ),
          ]}
        />
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
        {/* ワーカーは、Markdownの表の列として横に並べる。見出しの行に状態の絵文字と名前、次の行に担当中のタスク。
            表の罫線と列の位置は画面が描くので、VS Codeで文字の幅がそろわなくても、列がずれない。名前を押すと、そのワーカーのタブを前面に出す。 */}
        {team.workers.length > 0 && <WorkerTable />}
        <Heading>Task</Heading>
        {team.tasks.map(t => {
          const heading = `${t.id}: ${t.title}`
          // 題名の後ろに、担当のワーカーの最後の報告の一言（team.json の note）を「 - 」でつなぐ。題名だけを太字にする。
          const note = t.note !== '' ? ` - ${t.note}` : ''
          const workerSession = sessionOf(t.worker)
          // 1行目：状態の絵文字、「タスクID: 題名 - 一言」、右端に担当のワーカー。2行目から：要約（3行まで）。状態は絵文字の色だけで示し、語は書かない。
          return (
            <Box key={t.id} flexDirection="column">
              <Box flexDirection="row">
                <Box flexShrink={0}>
                  <Text>{`${DOT_EMOJI[taskDot(t)]} `}</Text>
                </Box>
                <Box flexGrow={1}>
                  {/* タスクIDと題名を押すと、担当のワーカーのタブを前面に出し、そのタスクの経緯をワーカーのタブで見られるようにする。 */}
                  {canJump(workerSession) ? (
                    <JumpLink id={`jump-task-${t.id}`} label={heading} sessionId={workerSession} bold suffix={note} />
                  ) : (
                    <Line>
                      <Text bold>{heading}</Text>
                      {note}
                    </Line>
                  )}
                </Box>
                <Box flexShrink={0} marginLeft={1}>
                  <Text dimColor>{workerNameOf(t.worker)}</Text>
                </Box>
              </Box>
              {(t.summary ?? []).map((line, i) => (
                <Box key={`summary-${t.id}-${i}`} marginLeft={2}>
                  <Line dimColor>{`${i === 0 ? '↳' : ' '} ${line}`}</Line>
                </Box>
              ))}
            </Box>
          )
        })}
        {graph && Svg && (
          <Box flexDirection="column">
            <Heading>Dependency</Heading>
            {/* 大きさをSVGの本来の大きさに固定する。指定しないと、ペインの幅に合わせて拡大され、文字の大きさが変わるため。 */}
            <Svg source={graph.source} alt={graph.alt} width={graph.width} height={graph.height} />
          </Box>
        )}
      </Box>
    )
  })
}
