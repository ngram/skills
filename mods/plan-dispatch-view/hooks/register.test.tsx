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
  invokedAs: '/anthropic-skills:plan-dispatch',
  maxAgents: 10,
  sessionsAtStart: ['skills-e1'],
  baselineStatus: [],
  workers: [
    { id: 'W01', session: 'skills-d3', status: 'working', task: 'T02', lastRequest: { kind: 'assign', task: 'T02', answered: false } },
    { id: 'W02', session: 'skills-00', status: 'idle', task: null, lastRequest: { kind: 'assign', task: 'T01', answered: true } },
  ],
  tasks: [
    { id: 'T01', title: '雛形を書く', status: 'done', worker: 'W02', dependsOn: [] },
    { id: 'T02', title: 'テストを書く', status: 'assigned', worker: 'W01', dependsOn: ['T01'] },
    { id: 'T03', title: 'READMEを書く', status: 'pending', worker: null, dependsOn: [] },
  ],
  updatedAt: '2026-11-17T04:00:00Z',
}

// チームのディレクトリを置き換える。reads は fs.read が返す本文の列で、使い切ったら最後の値を返し続ける。
function engine(on: On, reads: string[] | null) {
  const opened: string[] = []
  let n = 0
  on('command.register', () => ({ value: { command: 'plan-dispatch-view' } }))
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  // 読み直しのタイマーは、テストが時計を進めない限り動かない。
  mock.clock(on)
  on('fs.exists', () => ({ value: reads !== null }))
  on('fs.list', () => ({
    value: reads === null ? [] : [{ name: '20261115_sample', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }],
  }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 100, mtimeMs: 1, isLink: false } }))
  on('fs.read', () => {
    const text = reads?.[Math.min(n, (reads?.length ?? 1) - 1)] ?? ''
    n++
    return { value: text }
  })
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('command.run', () => ({ text: '' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  return opened
}

async function submit($: Engine, name: string, args: string) {
  await $.prompt.submit({ ...TYPED, text: `/${name} ${args}`, command: { name, args } })
}

test('ワーカーとタスクの表と進み具合を、vscodeとterminalの画面に描く', async ($, on) => {
  engine(on, [JSON.stringify(TEAM)])
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
      ['W01', /^• W01:\s*Working\s*T02\s*skills-d3$/],
      ['W02', /^• W02:\s*Idle\s*-\s*skills-00$/],
      ['T01', /^☑ T01:\s*Done\s*W02\s*雛形を書く$/],
      ['T02', /^☐ T02:\s*Working\s*W01\s*テストを書く$/],
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
  engine(on, [JSON.stringify({ ...TEAM, tasks })])
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
  engine(on, [JSON.stringify(TEAM)])
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
    '• W01:',
    '• W02:',
    '☑ T01:',
    '☐ T02:',
    '☐ T03:',
  ])
  // 2列目：ワーカーとタスクの状態。
  expect(await column(8)).toEqual(['Working', 'Idle', 'Done', 'Working', 'Pending'])
  // 3列目：担当のタスクかワーカー。
  expect(await column(5)).toEqual(['T02', '-', 'W02', 'W01', '-'])
  await ui.unmount()
})

test('状態の語にだけ、テーマの色と太字を付ける', async ($, on) => {
  engine(on, [JSON.stringify(TEAM)])
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
  const id = await ui.find({ type: 'Text', text: /^• W01:$/ })
  expect(id?.props.color).toBeUndefined()
  expect(id?.props.bold).toBeFalsy()
  await ui.unmount()
})

test('3つの呼び出し名のどれでもペインを開き、ほかのプロンプトでは開かない', async ($, on) => {
  const opened = engine(on, [JSON.stringify(TEAM)])
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
  const opened = engine(on, [JSON.stringify(TEAM)])
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
  engine(on, [JSON.stringify(TEAM), '{"version": 1, "teamId": "書きかけ'])
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await submit($, 'plan-dispatch', 'x')
  await submit($, 'plan-dispatch', 'x')
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await ui.find({ type: 'Text', text: /^20261115_sample$/ })).toBeTruthy()
  await ui.unmount()
})

test('知らない版の team.json は表示せず、modの更新を促す', async ($, on) => {
  engine(on, [JSON.stringify({ ...TEAM, version: 2 })])
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await submit($, 'plan-dispatch', 'x')
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect((await ui.find({ type: 'Text', text: /modを更新/ }))?.text).toMatch(/版（2）/)
  expect(await ui.find({ type: 'Text', text: /^W01/ })).toBeFalsy()
  await ui.unmount()
})

test('狭いとき（プロンプトの上）は、要約だけを描く', async ($, on) => {
  engine(on, [JSON.stringify(TEAM)])
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
  engine(on, [JSON.stringify(long)])
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
