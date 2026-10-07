import { expect, test } from 'claude-code/testing'

const PANE = {
  component: 'Pane' as const,
  requestId: 'agent-tree',
  props: {
    title: 'Agents',
    isFocused: false,
    bodyColumns: 50,
    placement: 'dock' as const,
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
}

const SPAWN = { prompt: 'Do it', parentModel: 'opus', provider: 'claude' as never, background: false, fork: false }
const GREP = { result: { mode: 'files_with_matches', filenames: [], numFiles: 0 } as never }

test('a new agent gets a critter card and one sentence on what it is doing', async ($, on) => {
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'a1' }))
  on('tool.call', { tool: 'Grep' as never }, () => GREP)

  await $.agent.spawn({ ...SPAWN, tool_use_id: 't1', description: 'Find auth code', subagentType: 'Explore' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'agent-tree', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /Getting started: Find auth code/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /▝▜█████▛▘/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /working/ })).toBeDefined()
    await ui.unmount()
  }

  await $.tool.call({ tool: 'Grep', pattern: 'login', agentId: 'a1' } as never)
  const ui = await $.ui.mount({ plugin: 'agent-tree', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /Searching the code for "login"/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Getting started/ })).toBeUndefined()
  await ui.unmount()
})

test('tool calls read as plain sentences', async ($, on) => {
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'a1' }))
  on('tool.call', () => GREP)
  await $.agent.spawn({ ...SPAWN, tool_use_id: 't1', description: 'x', subagentType: 'Explore' })

  const cases: [Record<string, unknown>, RegExp][] = [
    [{ tool: 'Read', file_path: '/home/me/src/auth.ts' }, /Reading auth\.ts/],
    [{ tool: 'WebSearch', query: 'jev api' }, /Searching the web for "jev api"/],
    [{ tool: 'WebFetch', url: 'https://docs.typesafe.ai/start', prompt: 'p' }, /Reading a page on docs\.typesafe\.ai/],
    [{ tool: 'Bash', command: 'ls -la', description: 'List the files' }, /List the files/],
  ]
  for (const [input, expected] of cases) {
    await $.tool.call({ ...input, agentId: 'a1' } as never)
    const ui = await $.ui.mount({ plugin: 'agent-tree', surface: 'terminal', ...PANE })
    expect(await ui.find({ type: 'Text', text: expected })).toBeDefined()
    await ui.unmount()
  }
})

test('a finished agent sums up its answer in one sentence', async ($, on) => {
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'a1' }))
  on('turn.complete', () => ({ text: '' }))

  await $.agent.spawn({ ...SPAWN, tool_use_id: 't1', description: 'Summarise docs', subagentType: 'Explore' })
  await $.turn.complete({
    agentId: 'a1',
    answer: '**The auth code** lives in src/auth. It uses JWT.',
    durationMs: 1,
    isAborted: false,
    turnId: 'x',
    reason: 'answer',
  })

  const ui = await $.ui.mount({ plugin: 'agent-tree', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /Done: The auth code lives in src\/auth\./ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /It uses JWT/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /1 finished/ })).toBeDefined()

  await ui.press({ key: 'clear' })
  expect(await ui.find({ type: 'Text', text: /No agents yet/ })).toBeDefined()
  await ui.unmount()
})

test('stopped and failed agents say so', async ($, on) => {
  let n = 0
  on('agent.spawn', () => ({ model: 'sonnet', agentId: `a${++n}` }))
  on('turn.complete', () => ({ text: '' }))

  await $.agent.spawn({ ...SPAWN, tool_use_id: 't1', description: 'Crawl', subagentType: 'Explore' })
  await $.agent.spawn({ ...SPAWN, tool_use_id: 't2', description: 'Build', subagentType: 'general-purpose' })
  await $.turn.complete({ agentId: 'a1', answer: '', durationMs: 1, isAborted: true, turnId: 'x', reason: 'aborted' })
  await $.turn.complete({ agentId: 'a2', answer: '', durationMs: 1, isAborted: false, turnId: 'y', reason: 'error' })

  const ui = await $.ui.mount({ plugin: 'agent-tree', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /Was stopped before it finished/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Hit an error and stopped/ })).toBeDefined()
  await ui.unmount()
})

test('a resumed agent works again, and an unseen one joins on its first step', async ($, on) => {
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'a1' }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', { tool: 'Grep' as never }, () => GREP)

  await $.agent.spawn({ ...SPAWN, tool_use_id: 't1', description: 'Audit', subagentType: 'Explore' })
  await $.turn.complete({ agentId: 'a1', answer: 'First.', durationMs: 1, isAborted: false, turnId: 'x', reason: 'answer' })
  await $.tool.call({ tool: 'Grep', pattern: 'again', agentId: 'a1' } as never)
  await $.tool.call({ tool: 'Grep', pattern: 'ghost', agentId: 'ghost' } as never)

  const ui = await $.ui.mount({ plugin: 'agent-tree', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /2 working/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Done: First/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /"ghost"/ })).toBeDefined()
  await ui.unmount()
})

test('with no agents the board says so', async $ => {
  const ui = await $.ui.mount({ plugin: 'agent-tree', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /No agents yet/ })).toBeDefined()
  await ui.unmount()
})

test('three cards share a row, and a long sentence wraps onto a second line', async ($, on) => {
  let n = 0
  on('agent.spawn', () => ({ model: 'sonnet', agentId: `a${++n}` }))
  for (const name of ['One', 'Two', 'Three']) {
    await $.agent.spawn({ ...SPAWN, tool_use_id: name, description: `Look into the ${name} module`, subagentType: 'Explore' })
  }

  const ui = await $.ui.mount({ plugin: 'agent-tree', surface: 'terminal', ...PANE, props: { ...PANE.props, bodyColumns: 90 } })
  expect(await ui.find({ type: 'Text', text: /^Getting started: Look$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^into the Three module$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /3 working/ })).toBeDefined()
  await ui.unmount()
})

test('Wider and Narrower ask for a docked pane a card wider or narrower', async ($, on) => {
  const asked: number[] = []
  on('ui.open', (_$, e) => {
    asked.push((e as { columns?: number }).columns ?? 0)

    return { value: { isOpen: true } } as never
  })

  const ui = await $.ui.mount({ plugin: 'agent-tree', surface: 'terminal', ...PANE, props: { ...PANE.props, bodyColumns: 60 } })
  await ui.press({ key: 'bigger' })
  await ui.press({ key: 'bigger' })
  await ui.press({ key: 'smaller' })
  expect(asked).toEqual([89, 118, 89])
  await ui.unmount()
})

test('inline, the buttons ask for a taller or shorter pane', async ($, on) => {
  const asked: number[] = []
  on('ui.open', (_$, e) => {
    asked.push((e as { rows?: number }).rows ?? 0)

    return { value: { isOpen: true } } as never
  })

  const inline = { ...PANE.props, placement: 'inline' as const, scroll: { offset: 0, bodyRows: 12 } }
  const ui = await $.ui.mount({ plugin: 'agent-tree', surface: 'terminal', ...PANE, props: inline })
  expect(await ui.find({ type: 'Button', text: /Taller/ })).toBeDefined()
  await ui.press({ key: 'bigger' })
  await ui.press({ key: 'smaller' })
  await ui.press({ key: 'smaller' })
  expect(asked).toEqual([19, 12, 9])
  await ui.unmount()
})
