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
    expect(await ui.find({ type: 'Text', text: /Getting started: Find auth code/, in: 'card-a1' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /▝▜█████▛▘/, in: 'card-a1' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /working/ })).toBeDefined()
    await ui.unmount()
  }

  await $.tool.call({ tool: 'Grep', pattern: 'login', agentId: 'a1' } as never)
  const ui = await $.ui.mount({ plugin: 'agent-tree', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /Searching the code for "login"/, in: 'card-a1' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Getting started/, in: 'card-a1' })).toBeUndefined()
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
    expect(await ui.find({ type: 'Text', text: expected, in: 'card-a1' })).toBeDefined()
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
  expect(await ui.find({ type: 'Text', text: /Done: The auth code lives in src\/auth\./, in: 'card-a1' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /It uses JWT/, in: 'card-a1' })).toBeUndefined()
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
  expect(await ui.find({ type: 'Text', text: /Was stopped before it finished/, in: 'card-a1' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Hit an error and stopped/, in: 'card-a2' })).toBeDefined()
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
  expect(await ui.find({ type: 'Text', text: /Done: First/, in: 'card-a1' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /"ghost"/, in: 'card-ghost' })).toBeDefined()
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
  expect(await ui.find({ type: 'Text', text: /^Getting started: Look$/, in: 'card-a1' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^into the Three module$/, in: 'card-a3' })).toBeDefined()
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

test('a click anywhere on a card opens its chat, and hovering shows it can', async ($, on) => {
  const opened: { id: string; title?: string }[] = []
  on('ui.open', (_$, e) => {
    opened.push(e as never)

    return { value: { isPlaced: true } } as never
  })
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'a1' }))
  await $.agent.spawn({ ...SPAWN, tool_use_id: 't1', description: 'Find auth code', subagentType: 'Explore' })

  const ui = await $.ui.mount({ plugin: 'agent-tree', surface: 'terminal', ...PANE })
  await ui.pointer({ type: 'enter', x: 20, y: 5, in: 'card-a1' })
  expect(await ui.find({ type: 'Text', text: /chat ›/, in: 'card-a1' })).toBeDefined()

  await ui.pointer({ type: 'down', x: 20, y: 5, button: 'left', in: 'card-a1' })
  await ui.pointer({ type: 'up', x: 20, y: 5, button: 'left', in: 'card-a1' })
  expect(opened.at(-1)).toMatchObject({ id: 'agent-chat', title: 'Chat · Explore' })

  await ui.pointer({ type: 'leave', x: 20, y: 5, in: 'card-a1' })
  expect(await ui.find({ type: 'Text', text: /chat ›/, in: 'card-a1' })).toBeUndefined()
  await ui.unmount()
})

test('where cards cannot take clicks, the name is the button', async ($, on) => {
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'a1' }))
  await $.agent.spawn({ ...SPAWN, tool_use_id: 't1', description: 'Find auth code', subagentType: 'Explore' })

  const ui = await $.ui.mount({ plugin: 'agent-tree', surface: 'vscode', ...PANE })
  expect(await ui.find({ type: 'Button', text: /^Explore$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Click an agent's name/ })).toBeDefined()
  await ui.unmount()
})
