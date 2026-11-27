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
    { id: 'WA01', session: 'skills-d3', status: 'working', task: 'T02', lastRequest: { kind: 'assign', task: 'T02', answered: false } },
    { id: 'WA02', session: 'skills-00', status: 'idle', task: null, lastRequest: { kind: 'assign', task: 'T01', answered: true } },
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
      ['WA01', /^• WA01:\s*Working\s*T02\s*skills-d3$/],
      ['WA02', /^• WA02:\s*Idle\s*-\s*skills-00$/],
      ['T01', /^☑ T01:\s*Done\s*WA02\s*雛形を書く$/],
      ['T02', /^☐ T02:\s*Working\s*WA01\s*テストを書く$/],
      ['T03', /^☐ T03:\s*Pending\s*-\s*READMEを書く$/],
    ]
    for (const [key, cells] of rows) {
      expect((await ui.find({ key }))?.text, `${surface}の画面の${key}の行`).toMatch(cells)
    }
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
  for (const id of ['T01', 'T02', 'T03', 'T04', 'T05']) expect(source).toContain(`>${id}</text>`)
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

test('タスクIDが3桁でも、列の幅に収まる', async ($, on) => {
  // 100件のタスク。IDは3桁（T001）になる。
  const tasks = Array.from({ length: 100 }, (_, i) => {
    const id = `T${String(i + 1).padStart(3, '0')}`
    return { id, title: `タスク${i + 1}`, status: 'pending', worker: null, dependsOn: [] }
  })
  engine(on, one(JSON.stringify({ ...TEAM, tasks })))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await submit($, 'plan-dispatch', 'x')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // 端末では1文字が1桁なので、1列目の値が幅より短ければ、2列目と重ならない。
  const first = (await ui.findAll({ type: 'Box' })).filter(b => b.props.width === 10).map(b => b.text)
  expect(first).toContain('☐ T100:')
  expect(Math.max(...first.map(s => [...s].length))).toBeLessThan(10)
  await ui.unmount()
})

test('Team、Worker、Taskの節で、1列目と状態の列の幅をそろえる', async ($, on) => {
  engine(on, one(JSON.stringify(TEAM)))
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await submit($, 'plan-dispatch', 'x')
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const column = async (width: number) =>
    (await ui.findAll({ type: 'Box' })).filter(b => b.props.width === width).map(b => b.text)
  // 1列目：Teamの項目名と、ワーカーIDとタスクID。どれも同じ幅なので、2列目（状態）の先頭がそろう。
  expect(await column(10)).toEqual([
    'ID:',
    'Status:',
    'Leader:',
    'Progress:',
    '• WA01:',
    '• WA02:',
    '☑ T01:',
    '☐ T02:',
    '☐ T03:',
  ])
  // 2列目：ワーカーとタスクの状態。
  expect(await column(8)).toEqual(['Working', 'Idle', 'Done', 'Working', 'Pending'])
  // 3列目：担当のタスクかワーカー。
  expect(await column(5)).toEqual(['T02', '-', 'WA02', 'WA01', '-'])
  await ui.unmount()
})

test('状態の語にだけ、テーマの色と太字を付ける', async ($, on) => {
  engine(on, one(JSON.stringify(TEAM)))
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await submit($, 'plan-dispatch', 'x')
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  // 状態の語を描く、最も内側（文書の順で最後）のText。
  const label = async (word: RegExp) => (await ui.findAll({ type: 'Text', text: word })).at(-1)
  const color = async (word: RegExp) => (await label(word))?.props.color
  expect(await color(/^Active$/)).toBe('suggestion')
  expect(await color(/^Working$/)).toBe('claude')
  expect(await color(/^Idle$/)).toBeUndefined()
  expect(await color(/^Done$/)).toBe('success')
  expect(await color(/^Pending$/)).toBe('inactive')
  expect((await label(/^Active$/))?.props.bold).toBe(true)
  // 状態の語のほかは、色も太字も付けない。
  const id = await ui.find({ type: 'Text', text: /^• WA01:$/ })
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

test('タスクIDを押すと、その下に「結果」の節だけを開き、もう一度押すと閉じる', async ($, on) => {
  engine(on, one(JSON.stringify(JUMP)), { sessionId: LEADER_ID, files: { [T01_PATH]: T01_FILE } })
  await $.session.start({ cwd: REPO, surface: 'vscode', isInteractive: true })
  await submit($, 'plan-dispatch', 'x')
  let ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await ui.find({ type: 'Text', text: /^雛形を書いた。$/ })).toBeFalsy()
  await ui.press({ key: 'toggle-T01' })
  await ui.unmount()

  ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await ui.find({ type: 'Text', text: /^### 要約$/ }), '結果の節を描いていない').toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^雛形を書いた。$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^- templates\/a\.md$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /雛形を用意する/ }), '結果の節のほかの節まで描いている').toBeFalsy()
  // 行の並びは変わらず、T01の行のすぐ後ろに結果が入る。
  expect((await ui.find({ key: 'T01' }))?.text).toMatch(/^☑ T01:\s*Done\s*WA02\s*雛形を書く$/)
  await ui.press({ key: 'toggle-T01' })
  await ui.unmount()

  ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await ui.find({ type: 'Text', text: /^雛形を書いた。$/ }), 'もう一度押しても閉じない').toBeFalsy()
  await ui.unmount()
})

test('開いている結果は、読み直しで新しくなり、読めないときは前の結果を残す', async ($, on) => {
  const files: Record<string, string> = { [T01_PATH]: T01_FILE }
  engine(on, one(JSON.stringify(JUMP)), { sessionId: LEADER_ID, files })
  await $.session.start({ cwd: REPO, surface: 'vscode', isInteractive: true })
  await submit($, 'plan-dispatch', 'x')
  let ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await ui.press({ key: 'toggle-T01' })
  await ui.unmount()

  // ワーカーが結果を書き直した。
  files[T01_PATH] = T01_FILE.replace('雛形を書いた。', '雛形を書き直した。')
  await submit($, 'plan-dispatch', 'x')
  ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await ui.find({ type: 'Text', text: /^雛形を書き直した。$/ })).toBeTruthy()
  await ui.unmount()

  // 書いている途中で読めなかった。
  delete files[T01_PATH]
  await submit($, 'plan-dispatch', 'x')
  ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await ui.find({ type: 'Text', text: /^雛形を書き直した。$/ })).toBeTruthy()
  await ui.unmount()
})

test('タスクのファイルが無いか、「結果」の節が無ければ、その旨を描く', async ($, on) => {
  engine(on, one(JSON.stringify(JUMP)), { sessionId: LEADER_ID, files: { '20261115_sample/tasks/T03.md': '# T03\n\n## 目的\n\nx\n' } })
  await $.session.start({ cwd: REPO, surface: 'vscode', isInteractive: true })
  await submit($, 'plan-dispatch', 'x')
  let ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await ui.press({ key: 'toggle-T02' })
  await ui.press({ key: 'toggle-T03' })
  await ui.unmount()
  ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await ui.find({ type: 'Text', text: /タスクのファイルを読めません/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /「結果」の節がありません/ })).toBeTruthy()
  await ui.unmount()
})

test('ワーカーIDを押すと、そのワーカーのセッションのタブをVS Codeのコマンドで開く', async ($, on) => {
  const { runs } = engine(on, one(JSON.stringify(JUMP)), { sessionId: LEADER_ID })
  await $.session.start({ cwd: REPO, surface: 'vscode', isInteractive: true })
  await submit($, 'plan-dispatch', 'x')
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await ui.press({ key: 'jump-WA01' })
  expect(runs).toEqual([['code', '--open-url', `vscode://anthropic.claude-code/open?session=${WA01_ID}`]])
  // セッションのIDが無いワーカーと、このタブ自身（リーダー）は、ボタンにしない。
  expect(await ui.find({ key: 'jump-WA02' })).toBeFalsy()
  expect(await ui.find({ key: 'jump-leader' })).toBeFalsy()
  expect((await ui.find({ key: 'WA01' }))?.text).toMatch(/^• WA01:\s*Working\s*T02\s*skills-d3$/)
  await ui.unmount()
})

test('ワーカーのタブでは、リーダーの名前を押すとリーダーのタブを開く', async ($, on) => {
  const { runs } = engine(on, one(JSON.stringify(JUMP)), { sessionId: WA01_ID })
  await $.session.start({ cwd: REPO, surface: 'vscode', isInteractive: true })
  await submit($, 'plan-dispatch', 'x')
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await ui.find({ key: 'jump-WA01' }), 'このタブ自身をボタンにしている').toBeFalsy()
  await ui.press({ key: 'jump-leader' })
  expect(runs).toEqual([['code', '--open-url', `vscode://anthropic.claude-code/open?session=${LEADER_ID}`]])
  await ui.unmount()
})

test('Windowsでは、code を cmd.exe で実行する', async ($, on) => {
  const { runs } = engine(on, one(JSON.stringify(JUMP)), { sessionId: LEADER_ID, root: 'C:/work/repo' })
  await $.session.start({ cwd: REPO, surface: 'vscode', isInteractive: true })
  await submit($, 'plan-dispatch', 'x')
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await ui.press({ key: 'jump-WA01' })
  expect(runs[0]?.slice(0, 5)).toEqual(['cmd.exe', '/d', '/c', 'code', '--open-url'])
  await ui.unmount()
})

test('「ファイルを開く」は、パスの空白と「&」を符号化したURIで、タスクのファイルを開く', async ($, on) => {
  const dir = 'a b&c'
  const { runs } = engine(on, { [dir]: [JSON.stringify(JUMP)] }, {
    sessionId: LEADER_ID,
    files: { [`${dir}/tasks/T01.md`]: T01_FILE },
  })
  await $.session.start({ cwd: REPO, surface: 'vscode', isInteractive: true })
  await submit($, 'plan-dispatch', 'x')
  let ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await ui.press({ key: 'toggle-T01' })
  await ui.unmount()
  ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await ui.press({ key: 'file-T01' })
  expect(runs).toEqual([['code', '--open-url', 'vscode://file/work/repo/plan/.dispatch/a%20b%26c/tasks/T01.md']])
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
    await ui.press({ key: 'jump-WA01' })
    expect(toasts.at(-1)).toMatch(message)
    expect(await ui.find({ key: 'WA01' })).toBeTruthy()
    await ui.unmount()
  })
}

test('ターミナルでは、ジャンプのボタンを描かず、結果の開閉だけを描く', async ($, on) => {
  engine(on, one(JSON.stringify(JUMP)), { sessionId: LEADER_ID, files: { [T01_PATH]: T01_FILE } })
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  await submit($, 'plan-dispatch', 'x')
  let ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ key: 'jump-WA01' })).toBeFalsy()
  await ui.press({ key: 'toggle-T01' })
  await ui.unmount()
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^雛形を書いた。$/ })).toBeTruthy()
  expect(await ui.find({ key: 'file-T01' })).toBeFalsy()
  await ui.unmount()
})

