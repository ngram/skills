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
  options: { mtimes?: Record<string, number>; sessionId?: string; repo?: boolean } = {},
) {
  const opened: string[] = []
  const paths: string[] = []
  const counts: Record<string, number> = {}
  // エンジンは、Windowsではパスの区切りを「\」にし、ドライブ名（「C:」）を付けて渡すので、「/」にそろえ、ドライブ名を除いて比べる。
  const norm = (path: string) => path.replace(/\\/gu, '/').replace(/^[A-Za-z]:/u, '')
  const nameOf = (path: string) => norm(path).slice(BASE.length + 1).split('/')[0] ?? ''
  on('command.register', () => ({ value: { command: 'plan-dispatch-view' } }))
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  // 読み直しのタイマーは、テストが時計を進めない限り動かない。
  mock.clock(on)
  on('session.repo', () => ({
    value: options.repo === false ? null : { root: REPO, remote: null, internal: false, name: null },
  }))
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
    const name = nameOf(e.path)
    const reads = teams?.[name] ?? ['']
    const n = counts[name] ?? 0
    counts[name] = n + 1
    return { value: reads[Math.min(n, reads.length - 1)] ?? '' }
  })
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('command.run', () => ({ text: '' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  return { opened, paths }
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
  expect(await ui.find({ type: 'Text', text: /参加していないチーム/ })).toBeFalsy()
  await ui.unmount()
})

test('このタブが関わるチームが無ければ、最も新しい進行中のチームを、参加していないことを添えて表示する', async ($, on) => {
  const older = { ...TEAM, teamId: '202611181000', leaderSessionId: 'other' }
  const done = { ...TEAM, teamId: '202611181200', leaderSessionId: 'other', status: 'done' }
  engine(on, { '202611181000': [JSON.stringify(older)], '202611181200': [JSON.stringify(done)] }, {
    mtimes: { '202611181000': 1, '202611181200': 2 },
  })
  await $.session.start({ cwd: REPO, surface: 'vscode', isInteractive: true })
  await submit($, 'plan-dispatch', 'x')
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await ui.find({ type: 'Text', text: /^202611181000$/ }), '完了したチームより、進行中のチームを先に表示していない').toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /このタブが参加していないチーム/ })).toBeTruthy()
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

