import type { On } from 'claude-code'
import { expect, mock, test, type Engine } from 'claude-code/testing'

// 利用者がプロンプトでEnterを押したときの送信元。
const TYPED = { wait: false, origin: { kind: 'composer' } } as const

const PANE = {
  plugin: 'plan-dispatch-view',
  component: 'Pane',
  requestId: 'plan-dispatch-view',
  props: {
    title: 'plan-dispatch',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const TEAM = {
  version: 1,
  teamId: '20261115_sample',
  status: 'active',
  plan: 'plan/20261115_sample.md',
  leader: 'skills-e1',
  // 既定のテストでは、このタブがリーダーとする。
  leaderSessionId: 'session-me',
  invokedAs: '/anthropic-skills:plan-dispatch',
  maxAgents: 10,
  sessionsAtStart: ['skills-e1'],
  baselineStatus: [],
  workers: [
    { id: 'WA01', session: 'tab-d3', status: 'working', task: 'T02', lastRequest: { kind: 'assign', task: 'T02', answered: false } },
    { id: 'WA02', session: 'tab-00', status: 'idle', task: null, lastRequest: { kind: 'assign', task: 'T01', answered: true } },
  ],
  tasks: [
    { id: 'T01', title: '雛形を書く', status: 'done', worker: 'WA02', dependsOn: [] },
    { id: 'T02', title: 'テストを書く', status: 'assigned', worker: 'WA01', dependsOn: ['T01'] },
    { id: 'T03', title: 'READMEを書く', status: 'pending', worker: null, dependsOn: [] },
  ],
  updatedAt: '2026-11-17T04:00:00Z',
}

// メインの作業ツリーのルートと、セッションのID。セッションは、worktreeの中で動いているものとする。
// ドライブ名の無い絶対パスにする。Linuxでは「C:/…」が相対パスとして扱われるため。
const REPO = '/work/repo'
const WORKTREE = '/work/repo/.claude/worktrees/fix'
const ME = 'session-me'
const BASE = `${REPO}/plan/.dispatch`
// ●の色。VS Code拡張のタブの点（未読はオレンジ、応答待ちは青）にそろえた値。
const GREEN = '#2f8f5b'
const ORANGE = '#D97757'
const BLUE = '#3B82F6'
const GRAY = '#8a8f98'

// チームのディレクトリを置き換える。teams は、チームのディレクトリ名から、fs.read が返す本文の列への対応。
// 本文の列は、使い切ったら最後の値を返し続ける。mtimes は、team.json の更新時刻（無ければ1）。
function engine(
  on: On,
  teams: Record<string, string[]> | null,
  options: {
    mtimes?: Record<string, number>
    sessionId?: string
    repo?: boolean
    root?: string
    // チームのディレクトリからの相対パス（「<チームのディレクトリ>/tasks/T01.md」）から、本文への対応。無いパスは読めない。
    files?: Record<string, string>
    // process.run の終了コード。'throw' なら起動できなかったことにする。
    exitCode?: number | 'throw'
  } = {},
) {
  const opened: string[] = []
  const paths: string[] = []
  const runs: string[][] = []
  const toasts: string[] = []
  const counts: Record<string, number> = {}
  // エンジンは、Windowsではパスの区切りを「\」にし、ドライブ名（「C:」）を付けて渡すので、「/」にそろえ、「/work/repo」より前を除いて比べる。
  // ルートを「C:/work/repo」にしたテストでも、Linuxではエンジンが作業ディレクトリを前に付けることがあるため、「/work/repo」から比べる。
  const norm = (path: string) => {
    const p = path.replace(/\\/gu, '/')
    const i = p.indexOf(REPO)
    return i === -1 ? p : p.slice(i)
  }
  const nameOf = (path: string) => norm(path).slice(BASE.length + 1).split('/')[0] ?? ''
  on('command.register', () => ({ value: { command: 'plan-dispatch-view' } }))
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  // 読み直しのタイマーは、テストが時計を進めない限り動かない。
  mock.clock(on)
  on('session.repo', () => ({
    value: options.repo === false ? null : { root: options.root ?? REPO, remote: null, internal: false, name: null },
  }))
  on('process.run', (_, e) => {
    runs.push([...e.argv])
    if (options.exitCode === 'throw') throw new Error('spawn code ENOENT')
    const exitCode = options.exitCode ?? 0
    return {
      value: { exitCode, stdout: '', stderr: exitCode === 0 ? '' : 'not found', isStdoutTruncated: false, isStderrTruncated: false },
    }
  })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('session.root', () => ({ value: WORKTREE }))
  on('session.id', () => ({ value: options.sessionId ?? ME }))
  on('fs.exists', (_, e) => {
    paths.push(norm(e.path))
    return { value: teams !== null && norm(e.path) === BASE }
  })
  on('fs.list', (_, e) => {
    paths.push(norm(e.path ?? ''))
    return {
      value: Object.keys(teams ?? {}).map(name => ({ name, kind: 'dir', size: 0, mtimeMs: 0, isLink: false })),
    }
  })
  on('fs.stat', (_, e) => ({
    value: { kind: 'file', size: 100, mtimeMs: options.mtimes?.[nameOf(e.path)] ?? 1, isLink: false },
  }))
  on('fs.read', (_, e) => {
    paths.push(norm(e.path))
    const rel = norm(e.path).slice(BASE.length + 1)
    if (rel.includes('/tasks/')) {
      const body = options.files?.[rel]
      if (body === undefined) throw new Error(`ENOENT: ${rel}`)
      return { value: body }
    }
    const name = nameOf(e.path)
    const reads = teams?.[name] ?? ['']
    const n = counts[name] ?? 0
    counts[name] = n + 1
    return { value: reads[Math.min(n, reads.length - 1)] ?? '' }
  })
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('command.run', () => ({ text: '' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  return { opened, paths, runs, toasts }
}

// 1つのチーム（20261115_sample）だけがあるときの teams。
const one = (...reads: string[]) => ({ '20261115_sample': reads })

async function submit($: Engine, name: string, args: string) {
  await $.prompt.submit({ ...TYPED, text: `/${name} ${args}`, command: { name, args } })
}

test('ワーカーとタスクの表と進み具合を、vscodeとterminalの画面に描く', async ($, on) => {
  engine(on, one(JSON.stringify(TEAM)))
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await submit($, 'plan-dispatch', 'plan/20261115_sample.md')

  for (const surface of ['vscode', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /20261115_sample/ }))?.text).toBe('20261115_sample')
    for (const name of ['ID:', 'Status:', 'Leader:', 'Progress:']) {
      expect(await ui.find({ type: 'Text', text: name }), `${surface}の画面に項目名${name}が無い`).toBeTruthy()
    }
    expect(await ui.find({ type: 'Text', text: /^Active$/ }), `${surface}の画面にチームの状態が無い`).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /^skills-e1$/ }), `${surface}の画面にリーダーが無い`).toBeTruthy()
    expect(await ui.find({ text: /1 \/ 3/ }), `${surface}の画面に進み具合が無い`).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /^Worker$/ }), `${surface}の画面にWorkerの見出しが無い`).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /^Task$/ }), `${surface}の画面にTaskの見出しが無い`).toBeTruthy()
    // 行（キーはワーカーIDかタスクID）のセルが、この順に並ぶ。
    const rows: [string, RegExp][] = [
      // Taskの行は、状態の色の●、IDと題名、担当のワーカーの順。
      ['T01', /^(?:🟢|🟠|🔵|⚪|🔴) T01: 雛形を書く\s*tab-00$/],
      ['T02', /^(?:🟢|🟠|🔵|⚪|🔴) T02: テストを書く\s*tab-d3$/],
      ['T03', /^(?:🟢|🟠|🔵|⚪|🔴) T03: READMEを書く\s*-$/],
    ]
    for (const [key, cells] of rows) {
      expect((await ui.find({ key }))?.text, `${surface}の画面の${key}の行`).toMatch(cells)
    }
    // ワーカーは、Markdownの表の列として横に並べる。見出しの行に状態の絵文字とセッション名（ワーカーIDではない）、次の行に担当中のタスク。
    expect(await workersTable(ui)).toBe('| 🟢 tab\\-d3 | 🟠 tab\\-00 |\n| :---: | :---: |\n| T02 | \\- |')
    await ui.unmount()
  }
})

test('依存関係があれば、vscodeでは図を描き、terminalでは描かない', async ($, on) => {
  const tasks = [
    ...TEAM.tasks,
    // 循環と、存在しないタスクへの依存があっても描ける。
    { id: 'T04', title: '<仕上げ>', status: 'blocked', worker: null, dependsOn: ['T02', 'T03', 'T05', 'T99'] },
    { id: 'T05', title: '循環', status: 'pending', worker: null, dependsOn: ['T04'] },
  ]
  engine(on, one(JSON.stringify({ ...TEAM, tasks })))
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await submit($, 'plan-dispatch', 'x')

  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await ui.find({ type: 'Text', text: /^Dependency$/ })).toBeTruthy()
  const svg = await ui.find({ type: 'Svg' })
  const source = String(svg?.props.source)
  expect(source).toMatch(/^<svg [^>]*>.*<\/svg>$/)
  // ノードには、1行目に「タスクID:」、2行目に題名を書く。題名のXMLの記号はエスケープする。
  for (const id of ['T01', 'T02', 'T03', 'T04', 'T05']) expect(source).toContain(`>${id}:</text>`)
  for (const title of ['雛形を書く', 'テストを書く', '&lt;仕上げ&gt;', '循環']) expect(source).toContain(`>${title}</text>`)
  // ノードの幅は、最も長い題名（READMEを書く）が収まる幅にそろえる。
  const widths = [...source.matchAll(/<rect [^>]*width="([\d.]+)"/gu)].map(m => Number(m[1]))
  expect(Math.max(...widths)).toBeGreaterThan(56)
  expect(source).not.toContain('T99')
  // 依存先が完了していれば実線、未完了なら破線。T02→T04、T03→T04、T05→T04、T04→T05 は破線、T01→T02 は実線。
  expect(source.match(/<path d="M[^"]*" fill="none"[^>]*>/gu)?.length).toBe(5)
  expect(source.match(/stroke-dasharray/gu)?.length).toBe(4)
  expect(String(svg?.props.alt)).toContain('T02はT01に依存')
  await ui.unmount()

  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await term.find({ type: 'Text', text: /^Dependency$/ })).toBeFalsy()
  await term.unmount()
})

test('依存関係が無ければ、図を描かない', async ($, on) => {
  const tasks = TEAM.tasks.map(t => ({ ...t, dependsOn: [] }))
  engine(on, one(JSON.stringify({ ...TEAM, tasks })))
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await submit($, 'plan-dispatch', 'x')
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await ui.find({ type: 'Svg' })).toBeFalsy()
  expect(await ui.find({ type: 'Text', text: /^Dependency$/ })).toBeFalsy()
  await ui.unmount()
})

test('タスクが100件で、IDが3桁でも、すべての行を描く', async ($, on) => {
  // 100件のタスク。IDは3桁（T001）になる。
  const tasks = Array.from({ length: 100 }, (_, i) => {
    const id = `T${String(i + 1).padStart(3, '0')}`
    return { id, title: `タスク${i + 1}`, status: 'pending', worker: null, dependsOn: [] }
  })
  engine(on, one(JSON.stringify({ ...TEAM, tasks })))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await submit($, 'plan-dispatch', 'x')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ key: 'T001' }))?.text).toMatch(/^(?:🟢|🟠|🔵|⚪|🔴) T001: タスク1\s*-$/)
  expect((await ui.find({ key: 'T100' }))?.text).toMatch(/^(?:🟢|🟠|🔵|⚪|🔴) T100: タスク100\s*-$/)
  await ui.unmount()
})

test('TeamとWorkerの節で、列の幅をそろえる', async ($, on) => {
  engine(on, one(JSON.stringify(TEAM)))
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await submit($, 'plan-dispatch', 'x')
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const column = async (width: number) =>
    (await ui.findAll({ type: 'Box' })).filter(b => b.props.width === width).map(b => b.text)
  // Teamの項目名。値の先頭がそろう。
  expect(await column(10)).toEqual(['ID:', 'Status:', 'Leader:', 'Progress:'])
  // Workerは、1人分を同じ幅（●と空白の2桁、名前の8桁、余白1桁）で横に並べる。
  // Workerは、列の位置を画面がそろえるMarkdownの表で描く。
  expect((await ui.find({ key: 'workers' }))?.type).toBe('Markdown')
  await ui.unmount()
})

test('チームの状態の語に色を付け、ワーカーとタスクの状態は絵文字で示す', async ($, on) => {
  engine(on, one(JSON.stringify(TEAM)))
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await submit($, 'plan-dispatch', 'x')
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  // 状態の語を描く、最も内側（文書の順で最後）のText。
  const label = async (word: RegExp) => (await ui.findAll({ type: 'Text', text: word })).at(-1)
  const color = async (word: RegExp) => (await label(word))?.props.color
  expect(await color(/^Active$/)).toBe('suggestion')
  expect((await label(/^Active$/))?.props.bold).toBe(true)
  // ワーカーとタスクの状態は、語を書かず、●の色だけで示す。色はVS Code拡張のタブの点にそろえる（作業中は緑、報告済みはオレンジ、未着手は灰色）。
  // WA01は作業中、WA02は完了したT01を報告して待機中。T01は完了、T02は作業中、T03は未着手。
  const dots = (await ui.findAll({ type: 'Text', text: /^(?:🟢|🟠|🔵|⚪|🔴) $/ })).map(t => t.text)
  // タスクは行の先頭の絵文字（T01は完了、T02は作業中、T03は未着手）、ワーカーは表の中の絵文字（WA01は作業中、WA02は報告済み）。
  expect(dots).toEqual(['🟠 ', '🟢 ', '⚪ '])
  expect(await workersTable(ui)).toMatch(/^\| 🟢 .* \| 🟠 /u)
  expect(await ui.find({ type: 'Text', text: /^(Working|Idle|Done|Pending)$/ }), '状態を語で書いている').toBeFalsy()
  // 状態のほかは、色も太字も付けない。
  const id = await ui.find({ type: 'Text', text: /^WA01$/ })
  expect(id?.props.color).toBeUndefined()
  expect(id?.props.bold).toBeFalsy()
  await ui.unmount()
})

test('3つの呼び出し名のどれでもペインを開き、ほかのプロンプトでは開かない', async ($, on) => {
  const { opened } = engine(on, one(JSON.stringify(TEAM)))
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })

  await $.prompt.submit({ ...TYPED, text: 'ふつうのプロンプト' })
  await submit($, 'plan-dispatch-view-other', 'x')
  expect(opened.length).toBe(0)

  for (const name of ['plan-dispatch', 'plan-dispatch:plan-dispatch', 'anthropic-skills:plan-dispatch']) {
    await submit($, name, 'plan/20261115_sample.md')
  }
  expect(opened).toEqual(['plan-dispatch-view', 'plan-dispatch-view', 'plan-dispatch-view'])
})

test('autoOpen が無効なら、Skill を呼んでも開かない', { options: { autoOpen: false } }, async ($, on) => {
  const { opened } = engine(on, one(JSON.stringify(TEAM)))
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await submit($, 'anthropic-skills:plan-dispatch', 'plan/20261115_sample.md')
  expect(opened.length).toBe(0)
})

test('チームが無ければ、その旨を描く', async ($, on) => {
  engine(on, null)
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await submit($, 'plan-dispatch', 'x')
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect((await ui.find({ type: 'Text', text: /チームがありません/ }))?.text).toMatch(/^チームがありません/)
  await ui.unmount()
})

test('JSONが壊れていれば、前の表示を残す', async ($, on) => {
  engine(on, one(JSON.stringify(TEAM), '{"version": 1, "teamId": "書きかけ'))
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await submit($, 'plan-dispatch', 'x')
  await submit($, 'plan-dispatch', 'x')
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await ui.find({ type: 'Text', text: /^20261115_sample$/ })).toBeTruthy()
  await ui.unmount()
})

test('知らない版の team.json は表示せず、modの更新を促す', async ($, on) => {
  engine(on, one(JSON.stringify({ ...TEAM, version: 2 })))
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await submit($, 'plan-dispatch', 'x')
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect((await ui.find({ type: 'Text', text: /modを更新/ }))?.text).toMatch(/版（2）/)
  expect(await ui.find({ type: 'Text', text: /^WA01/ })).toBeFalsy()
  await ui.unmount()
})

test('狭いとき（プロンプトの上）は、要約だけを描く', async ($, on) => {
  engine(on, one(JSON.stringify(TEAM)))
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await submit($, 'plan-dispatch', 'x')
  const ui = await $.ui.mount({
    ...PANE,
    surface: 'vscode',
    props: { ...PANE.props, placement: 'inline', bodyColumns: 60, scroll: { offset: 0, bodyRows: 12 } },
  })
  expect((await ui.find({ type: 'Text', text: /Workers 2/ }))?.text).toBe('Active  Workers 2 (1 working), Tasks 1/3 done, 0 blocked')
  expect(await ui.find({ type: 'Text', text: /T01/ })).toBeFalsy()
  expect(await ui.find({ text: /Progress:/ }),'進み具合の名前が広い表示とそろっていない').toBeTruthy()
  await ui.unmount()
})

test('行の切り詰めを画面に任せ、チームの状態はチームIDとは別の行に描く', async ($, on) => {
  const long = { ...TEAM, teamId: '20261117_a-very-long-plan-name', status: 'done' }
  engine(on, one(JSON.stringify(long)))
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await submit($, 'plan-dispatch', 'x')
  for (const placement of ['dock', 'inline'] as const) {
    const ui = await $.ui.mount({
      ...PANE,
      surface: 'vscode',
      props: { ...PANE.props, placement, bodyColumns: 20, scroll: { offset: 0, bodyRows: 12 } },
    })
    const id = await ui.find({ type: 'Text', text: /^20261117_/ })
    expect(id?.text, `${placement}でチームIDを自前で切り詰めている`).toBe('20261117_a-very-long-plan-name')
    expect(id?.props.wrap, `${placement}で切り詰めを画面に任せていない`).toBe('truncate-end')
    expect(await ui.find({ type: 'Text', text: /^Done(  |$)/ }), `${placement}でチームの状態が見えない`).toBeTruthy()
    await ui.unmount()
  }
})

test('worktreeの中のセッションでも、メインの作業ツリーのルートの plan/.dispatch を読む', async ($, on) => {
  const { paths } = engine(on, one(JSON.stringify(TEAM)))
  await $.session.start({ cwd: WORKTREE, surface: 'vscode', isInteractive: true })
  await submit($, 'plan-dispatch', 'x')
  expect(paths.length).toBeGreaterThan(0)
  expect(paths.filter(p => !p.startsWith(BASE)), '作業ディレクトリ（worktree）を基準に探している').toEqual([])
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await ui.find({ type: 'Text', text: /^20261115_sample$/ })).toBeTruthy()
  await ui.unmount()
})

test('gitのリポジトリでなければ、セッションのプロジェクトのルートを基準にし、探した場所を表示する', async ($, on) => {
  engine(on, null, { repo: false })
  await $.session.start({ cwd: WORKTREE, surface: 'vscode', isInteractive: true })
  await submit($, 'plan-dispatch', 'x')
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect((await ui.find({ type: 'Text', text: /チームがありません/ }))?.text).toContain(`${WORKTREE}/plan/.dispatch`)
  await ui.unmount()
})

test('チームが複数あれば、このタブのセッションが記録されているチームを、より新しいチームより先に表示する', async ($, on) => {
  const mine = { ...TEAM, teamId: '202611181000', leaderSessionId: 'other', workers: [{ ...TEAM.workers[0], sessionId: ME }] }
  const newer = { ...TEAM, teamId: '202611181100', leaderSessionId: 'other' }
  engine(on, { '202611181000': [JSON.stringify(mine)], '202611181100': [JSON.stringify(newer)] }, {
    mtimes: { '202611181000': 1, '202611181100': 2 },
  })
  await $.session.start({ cwd: REPO, surface: 'vscode', isInteractive: true })
  await submit($, 'plan-dispatch', 'x')
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await ui.find({ type: 'Text', text: /^202611181000$/ }), 'ワーカーとして記録されているチームを表示していない').toBeTruthy()
  await ui.unmount()
})

test('このタブが関わるチームが無ければ、ほかのタブのチームを表示せず、まだ作成されていないことを描く', async ($, on) => {
  // 新しいチームを作るリーダーのタブで、team.json を書く前。ほかのタブの進行中のチームと、完了したチームがある。
  const active = { ...TEAM, teamId: '202611181000', leaderSessionId: 'other' }
  const done = { ...TEAM, teamId: '202611181200', leaderSessionId: 'other', status: 'done' }
  engine(on, { '202611181000': [JSON.stringify(active)], '202611181200': [JSON.stringify(done)] }, {
    mtimes: { '202611181000': 1, '202611181200': 2 },
  })
  await $.session.start({ cwd: REPO, surface: 'vscode', isInteractive: true })
  await submit($, 'plan-dispatch', 'x')
  for (const placement of ['dock', 'inline'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface: 'vscode', props: { ...PANE.props, placement } })
    expect(await ui.find({ type: 'Text', text: /このタブのチームは、まだ作成されていません/ }), `${placement}で未作成と描いていない`).toBeTruthy()
    expect(await ui.find({ text: /20261118/ }), `${placement}でほかのタブのチームを描いている`).toBeFalsy()
    expect(await ui.find({ type: 'Text', text: /チームがありません/ })).toBeFalsy()
    await ui.unmount()
  }
})

test('このタブのチームが作られたら、未作成の表示から、そのチームの表示に変わる', async ($, on) => {
  const other = { ...TEAM, teamId: '202611181000', leaderSessionId: 'other' }
  const mine = { ...TEAM, teamId: '202611181100' }
  const teams: Record<string, string[]> = { '202611181000': [JSON.stringify(other)] }
  engine(on, teams, { mtimes: { '202611181000': 2, '202611181100': 1 } })
  await $.session.start({ cwd: REPO, surface: 'vscode', isInteractive: true })
  await submit($, 'plan-dispatch', 'x')
  let ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await ui.find({ type: 'Text', text: /まだ作成されていません/ })).toBeTruthy()
  await ui.unmount()

  // リーダーが team.json を書いたあとの読み直し。ほかのタブのチームのほうが新しくても、このタブのチームを表示する。
  teams['202611181100'] = [JSON.stringify(mine)]
  await submit($, 'plan-dispatch', 'x')
  ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await ui.find({ type: 'Text', text: /^202611181100$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /まだ作成されていません/ })).toBeFalsy()
  await ui.unmount()
})

test('join で参加したタブは、そのチームを表示する', async ($, on) => {
  const target = { ...TEAM, teamId: '202611181000', leaderSessionId: 'other' }
  const newer = { ...TEAM, teamId: '202611181100', leaderSessionId: 'other' }
  engine(on, { '202611181000': [JSON.stringify(target)], '202611181100': [JSON.stringify(newer)] }, {
    mtimes: { '202611181000': 1, '202611181100': 2 },
  })
  await $.session.start({ cwd: REPO, surface: 'vscode', isInteractive: true })
  await submit($, 'plan-dispatch', 'join 202611181000 WA03 skills-e1')
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await ui.find({ type: 'Text', text: /^202611181000$/ })).toBeTruthy()
  await ui.unmount()
})

// 結果の表示とタブへのジャンプ。リーダーとWA01はセッションのIDを持ち、WA02は持たない（参加を受け付ける前）。
const LEADER_ID = '11111111-1111-4111-8111-111111111111'
const WA01_ID = '22222222-2222-4222-8222-222222222222'
const JUMP = {
  ...TEAM,
  leaderSessionId: LEADER_ID,
  workers: [{ ...TEAM.workers[0], sessionId: WA01_ID }, TEAM.workers[1]],
}
const T01_FILE = [
  '# T01：雛形を書く',
  '',
  '## 目的',
  '',
  '雛形を用意する。',
  '',
  '## 結果',
  '',
  '### 要約',
  '',
  '雛形を書いた。',
  '',
  '### 変えたファイル',
  '',
  '- templates/a.md',
  '',
].join('\n')
const T01_PATH = '20261115_sample/tasks/T01.md'
// ジャンプのリンクのURL。modは、このURLからセッションIDを取り出してタブを開く。
// Workerの節の表（Markdown）の本文。
const workersTable = async (ui: { find: (q: { key: string }) => Promise<{ props: Record<string, unknown> } | undefined> }) =>
  String((await ui.find({ key: 'workers' }))?.props.text).replaceAll('\u00a0', '')
const hrefOf = (sessionId: string) => `https://plan-dispatch.invalid/session/${sessionId}`

test('タスクの題名を押すと、担当のワーカーのタブをVS Codeのコマンドで開く', async ($, on) => {
  const { runs } = engine(on, one(JSON.stringify(JUMP)), { sessionId: LEADER_ID, files: { [T01_PATH]: T01_FILE } })
  await $.session.start({ cwd: REPO, surface: 'vscode', isInteractive: true })
  await submit($, 'plan-dispatch', 'x')
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  // T02の担当はWA01（セッションIDあり）。
  await ui.press({ key: 'jump-task-T02', link: { href: hrefOf(WA01_ID) } })
  expect(runs).toEqual([['code', '--open-url', `vscode://anthropic.claude-code/open?session=${WA01_ID}`]])
  // T01の担当のWA02はセッションIDが無く、T03は担当がいないので、ボタンにしない。題名と要約はそのまま描く。
  expect(await ui.find({ key: 'jump-task-T01' })).toBeFalsy()
  expect(await ui.find({ key: 'jump-task-T03' })).toBeFalsy()
  expect((await ui.find({ key: 'T01' }))?.text).toMatch(/^(?:🟢|🟠|🔵|⚪|🔴) T01: 雛形を書く\s*tab-00\s*↳ 雛形を書いた。$/)
  expect(await ui.find({ text: /雛形を用意する/ }), '「結果」の節のほかの節まで描いている').toBeFalsy()
  await ui.unmount()
})

test('ワーカーのタブでは、自分の担当のタスクをボタンにしない', async ($, on) => {
  engine(on, one(JSON.stringify(JUMP)), { sessionId: WA01_ID })
  await $.session.start({ cwd: REPO, surface: 'vscode', isInteractive: true })
  await submit($, 'plan-dispatch', 'x')
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await ui.find({ key: 'jump-task-T02' })).toBeFalsy()
  expect((await ui.find({ key: 'T02' }))?.text).toMatch(/^(?:🟢|🟠|🔵|⚪|🔴) T02: テストを書く\s*tab-d3$/)
  await ui.unmount()
})

test('要約は、読み直しで新しくなり、読めないときは前の要約を残す', async ($, on) => {
  const files: Record<string, string> = { [T01_PATH]: T01_FILE }
  engine(on, one(JSON.stringify(JUMP)), { sessionId: LEADER_ID, files })
  await $.session.start({ cwd: REPO, surface: 'vscode', isInteractive: true })
  await submit($, 'plan-dispatch', 'x')

  // ワーカーが結果を書き直した。
  files[T01_PATH] = T01_FILE.replace('雛形を書いた。', '雛形を書き直した。')
  await submit($, 'plan-dispatch', 'x')
  let ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect((await ui.find({ key: 'summary-T01-0' }))?.text).toBe('↳ 雛形を書き直した。')
  await ui.unmount()

  // 書いている途中で読めなかった。
  delete files[T01_PATH]
  await submit($, 'plan-dispatch', 'x')
  ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect((await ui.find({ key: 'summary-T01-0' }))?.text).toBe('↳ 雛形を書き直した。')
  await ui.unmount()
})

test('ワーカーIDを押すと、そのワーカーのセッションのタブをVS Codeのコマンドで開く', async ($, on) => {
  const { runs } = engine(on, one(JSON.stringify(JUMP)), { sessionId: LEADER_ID })
  await $.session.start({ cwd: REPO, surface: 'vscode', isInteractive: true })
  await submit($, 'plan-dispatch', 'x')
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await ui.press({ key: 'workers', link: { href: hrefOf(WA01_ID) } })
  expect(runs).toEqual([['code', '--open-url', `vscode://anthropic.claude-code/open?session=${WA01_ID}`]])
  // 名前は、表の中のMarkdownのリンクとして描く。セッションのIDが無いワーカー（WA02）と、このタブ自身（リーダー）は、リンクにしない。
  expect(await workersTable(ui)).toBe(`| 🟢 [tab\\-d3](${hrefOf(WA01_ID)}) | 🟠 tab\\-00 |\n| :---: | :---: |\n| T02 | \\- |`)
  expect(await ui.find({ key: 'jump-leader' })).toBeFalsy()
  expect(await ui.find({ type: 'Button' }), 'ボタンを描いている').toBeFalsy()
  await ui.unmount()
})

test('ワーカーのタブでは、リーダーの名前を押すとリーダーのタブを開く', async ($, on) => {
  const { runs } = engine(on, one(JSON.stringify(JUMP)), { sessionId: WA01_ID })
  await $.session.start({ cwd: REPO, surface: 'vscode', isInteractive: true })
  await submit($, 'plan-dispatch', 'x')
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await workersTable(ui), 'このタブ自身をリンクにしている').not.toContain(hrefOf(WA01_ID))
  await ui.press({ key: 'jump-leader', link: { href: hrefOf(LEADER_ID) } })
  expect(runs).toEqual([['code', '--open-url', `vscode://anthropic.claude-code/open?session=${LEADER_ID}`]])
  await ui.unmount()
})

test('Windowsでは、code を cmd.exe で実行する', async ($, on) => {
  const { runs } = engine(on, one(JSON.stringify(JUMP)), { sessionId: LEADER_ID, root: 'C:/work/repo' })
  await $.session.start({ cwd: REPO, surface: 'vscode', isInteractive: true })
  await submit($, 'plan-dispatch', 'x')
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await ui.press({ key: 'workers', link: { href: hrefOf(WA01_ID) } })
  expect(runs[0]?.slice(0, 5)).toEqual(['cmd.exe', '/d', '/c', 'code', '--open-url'])
  await ui.unmount()
})

for (const [exitCode, message] of [
  [1, /終了コード1/],
  ['throw', /codeを実行できません/],
] as const) {
  test(`VS Codeのコマンドが失敗しても（${exitCode}）、トーストで知らせ、ペインは描き続ける`, async ($, on) => {
    const { toasts } = engine(on, one(JSON.stringify(JUMP)), { sessionId: LEADER_ID, exitCode })
    await $.session.start({ cwd: REPO, surface: 'vscode', isInteractive: true })
    await submit($, 'plan-dispatch', 'x')
    const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
    await ui.press({ key: 'workers', link: { href: hrefOf(WA01_ID) } })
    expect(toasts.at(-1)).toMatch(message)
    expect(await ui.find({ key: 'workers' })).toBeTruthy()
    await ui.unmount()
  })
}

test('ターミナルでは、ジャンプのボタンを描かず、要約は描く', async ($, on) => {
  engine(on, one(JSON.stringify(JUMP)), { sessionId: LEADER_ID, files: { [T01_PATH]: T01_FILE } })
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  await submit($, 'plan-dispatch', 'x')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await workersTable(ui)).not.toContain('plan-dispatch.invalid')
  expect(await ui.find({ key: 'jump-task-T02' })).toBeFalsy()
  expect((await ui.find({ key: 'summary-T01-0' }))?.text).toBe('↳ 雛形を書いた。')
  await ui.unmount()
})

test('要約は、押さなくても題名の下に3行まで描き、まだ書かれていなければ描かない', async ($, on) => {
  const long = T01_FILE.replace('雛形を書いた。', '1行目の要約。\n- 2行目の要約。\n3行目の要約。\n4行目は描かない。')
  const blank = '# T02\n\n## 結果\n\n（ワーカーが、完了か進められないときに書く）\n\n### 要約\n\n### 変えたファイル\n\n- （ワーカーが書く）\n'
  engine(on, one(JSON.stringify(JUMP)), {
    sessionId: LEADER_ID,
    files: { [T01_PATH]: long, '20261115_sample/tasks/T02.md': blank },
  })
  await $.session.start({ cwd: REPO, surface: 'vscode', isInteractive: true })
  await submit($, 'plan-dispatch', 'x')
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect((await ui.find({ key: 'T01' }))?.text).toMatch(/^(?:🟢|🟠|🔵|⚪|🔴) T01: 雛形を書く\s*tab-00\s*↳ 1行目の要約。\s*2行目の要約。\s*3行目の要約。$/)
  expect((await ui.find({ key: 'summary-T01-1' }))?.text, '箇条書きの記号を除いていない').toBe('  2行目の要約。')
  expect(await ui.find({ text: /4行目/ })).toBeFalsy()
  // 要約がまだ無いタスクと、タスクのファイルが無いタスクは、題名の行だけ。T02は担当のWA01（tab-d3）へのリンクになる。
  expect((await ui.find({ key: 'T02' }))?.text).toMatch(/^(?:🟢|🟠|🔵|⚪|🔴) \*\*\[T02: テストを書く\]\(https:\/\/plan-dispatch\.invalid\/session\/[-0-9a-f]+\)\*\*\s*tab-d3$/)
  expect((await ui.find({ key: 'T03' }))?.text).toMatch(/^(?:🟢|🟠|🔵|⚪|🔴) T03: READMEを書く\s*-$/)
  await ui.unmount()
})

test('依存関係の図は、ペインの幅にかかわらず、SVGの本来の大きさで描く', async ($, on) => {
  engine(on, one(JSON.stringify(TEAM)))
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await submit($, 'plan-dispatch', 'x')
  for (const bodyColumns of [60, 200]) {
    const ui = await $.ui.mount({ ...PANE, surface: 'vscode', props: { ...PANE.props, bodyColumns } })
    const svg = await ui.find({ type: 'Svg' })
    const size = String(svg?.props.source).match(/^<svg [^>]*width="(\d+(?:\.\d+)?)" height="(\d+(?:\.\d+)?)"/u)
    expect(svg?.props.width, `幅${bodyColumns}で幅を固定していない`).toBe(Number(size?.[1]))
    expect(svg?.props.height).toBe(Number(size?.[2]))
    await ui.unmount()
  }
})

test('ジャンプのリンクは、題名のMarkdownの記号をエスケープして描き、押すと1回だけ開く', async ($, on) => {
  const team = { ...JUMP, tasks: JUMP.tasks.map(t => (t.id === 'T02' ? { ...t, title: '[a](b) *c*' } : t)) }
  const { runs } = engine(on, one(JSON.stringify(team)), { sessionId: LEADER_ID })
  await $.session.start({ cwd: REPO, surface: 'vscode', isInteractive: true })
  await submit($, 'plan-dispatch', 'x')
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const text = String((await ui.find({ key: 'jump-task-T02' }))?.props.text)
  expect(text).toBe(`**[T02: \\[a\\]\\(b\\) \\*c\\*](${hrefOf(WA01_ID)})**`)
  await ui.press({ key: 'jump-task-T02', link: { href: hrefOf(WA01_ID) } })
  expect(runs.length).toBe(1)
  await ui.unmount()
})

test('節の見出しの左に、テーマの色の縦線を描く', async ($, on) => {
  engine(on, one(JSON.stringify(TEAM)))
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await submit($, 'plan-dispatch', 'x')
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  for (const name of ['Team', 'Worker', 'Task', 'Dependency']) {
    expect((await ui.find({ key: `heading-${name}` }))?.text, `${name}の見出しに縦線が無い`).toBe(`▍${name}`)
  }
  // 見出しの文字は、本文より2段大きいtitleにする。
  for (const name of ['Team', 'Worker', 'Task', 'Dependency']) {
    expect((await ui.findAll({ type: 'Text', text: new RegExp(`^${name}$`) })).at(-1)?.props.size).toBe('title')
  }
  const bars = (await ui.findAll({ type: 'Text', text: /^▍$/ })).map(t => t.props.color)
  expect(bars).toEqual(['claude', 'claude', 'claude', 'claude'])
  await ui.unmount()
})

test('blockedのタスクと、その担当のワーカーは青、いなくなったワーカーは赤の絵文字にする', async ($, on) => {
  const team = {
    ...TEAM,
    workers: [TEAM.workers[0], { ...TEAM.workers[1], status: 'gone' }],
    tasks: TEAM.tasks.map(t => (t.id === 'T02' ? { ...t, status: 'blocked' } : t)),
  }
  engine(on, one(JSON.stringify(team)))
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await submit($, 'plan-dispatch', 'x')
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const dots = (await ui.findAll({ type: 'Text', text: /^(?:🟢|🟠|🔵|⚪|🔴) $/ })).map(t => t.text)
  // T01（完了）、T02（blocked）、T03（未着手）。ワーカーは、WA01（T02がblocked）が青、WA02（いなくなった）が赤の絵文字。
  expect(dots).toEqual(['🟠 ', '🔵 ', '⚪ '])
  expect(await workersTable(ui)).toMatch(/^\| 🔵 .* \| 🔴 /u)
  // 依存関係の図のノードも、同じ色で塗る。
  const source = String((await ui.find({ type: 'Svg' }))?.props.source)
  expect(source).toContain(`fill="${BLUE}"`)
  expect(source).toContain(`fill="${ORANGE}"`)
  await ui.unmount()
})

test('ワーカーは、IDではなくセッション名で表示し、長い名前は末尾を「…」にして省略する', async ($, on) => {
  const team = {
    ...JUMP,
    workers: [
      { ...JUMP.workers[0], session: 'a-very-long-session-name-for-test' },
      { ...JUMP.workers[1], session: '日本語のとても長いセッション名' },
    ],
  }
  engine(on, one(JSON.stringify(team)), { sessionId: LEADER_ID })
  await $.session.start({ cwd: REPO, surface: 'vscode', isInteractive: true })
  await submit($, 'plan-dispatch', 'x')
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  // 表示幅（全角2桁、半角1桁）で8桁に収め、収まらなければ末尾を「…」にする。リンクの文字も省略する。
  const table = await workersTable(ui)
  expect(table).toContain(`[a\\-very\\-…](${hrefOf(WA01_ID)})`)
  expect(table).toContain('| 🟠 日本語… |')
  // Taskの行の右端（担当のワーカー）も、同じ名前で表示する。
  expect((await ui.find({ key: 'T01' }))?.text).toMatch(/日本語…$/)
  expect(await ui.find({ text: /WA0\d/ }), 'ワーカーIDを表示している').toBeFalsy()
  await ui.unmount()
})

test('Workerの表は、どの列も中央そろえにし、セルの左右に改行なしの空白で余白を置く', async ($, on) => {
  engine(on, one(JSON.stringify(TEAM)))
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await submit($, 'plan-dispatch', 'x')
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const raw = String((await ui.find({ key: 'workers' }))?.props.text)
  const pad = '\u00a0\u00a0'
  expect(raw).toBe(
    `| ${pad}🟢 tab\\-d3${pad} | ${pad}🟠 tab\\-00${pad} |\n| :---: | :---: |\n| ${pad}T02${pad} | ${pad}\\-${pad} |`,
  )
  await ui.unmount()
})

test('タスクの題名の後ろに、担当のワーカーの最後の報告の一言（note）を「 - 」でつないで描く', async ($, on) => {
  const team = {
    ...JUMP,
    tasks: JUMP.tasks.map(t =>
      t.id === 'T01' ? { ...t, note: '雛形を3件作成' } : t.id === 'T03' ? { ...t, note: '仕様の確認待ち' } : t,
    ),
  }
  engine(on, one(JSON.stringify(team)), { sessionId: LEADER_ID })
  await $.session.start({ cwd: REPO, surface: 'vscode', isInteractive: true })
  await submit($, 'plan-dispatch', 'x')
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  // リンクにならないタスク（T01の担当のWA02はセッションIDが無い）は、題名を太字にし、一言は太字にしない。
  expect((await ui.find({ key: 'T01' }))?.text).toMatch(/^🟠 T01: 雛形を書く - 雛形を3件作成\s*tab-00$/u)
  expect(await ui.find({ type: 'Text', text: /^T01: 雛形を書く$/ })).toBeTruthy()
  expect((await ui.findAll({ type: 'Text', text: /^T01: 雛形を書く$/ })).at(-1)?.props.bold).toBe(true)
  // 担当のいないタスクにも、一言があれば描く。
  expect((await ui.find({ key: 'T03' }))?.text).toMatch(/^⚪ T03: READMEを書く - 仕様の確認待ち\s*-$/u)
  // 一言が無ければ、題名だけ。
  expect(String((await ui.find({ key: 'jump-task-T02' }))?.props.text)).toBe(`**[T02: テストを書く](${hrefOf(WA01_ID)})**`)
  await ui.unmount()
})
