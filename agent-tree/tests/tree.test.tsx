import { expect, test } from 'claude-code/testing'

const PANE = {
  component: 'Pane' as const,
  requestId: 'agent-tree',
  props: {
    title: 'Agents',
    isFocused: false,
    bodyColumns: 90,
    placement: 'dock' as const,
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
}

const SPAWN = { prompt: 'Find the auth code', parentModel: 'opus', provider: 'claude' as never, background: false, fork: false }

test('a spawned agent shows in the tree with what it is doing', async ($, on) => {
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'a1' }))
  on('tool.call', { tool: 'Grep' as never }, () => ({ result: { mode: 'files_with_matches', filenames: [], numFiles: 0 } as never }))

  await $.agent.spawn({ ...SPAWN, tool_use_id: 't1', description: 'Find auth code', subagentType: 'Explore' })
  await $.tool.call({ tool: 'Grep', pattern: 'login', agentId: 'a1' } as never)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'agent-tree', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /main session/ })).toBeDefined()
    expect(await ui.find({ type: 'Button', text: /Explore {2}Find auth code/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /1 tool/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /↳ Grep: login/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /1 running/ })).toBeDefined()
    await ui.unmount()
  }
})

test('nested agents sit under their parent', async ($, on) => {
  let n = 0
  on('agent.spawn', () => ({ model: 'sonnet', agentId: `a${++n}` }))

  await $.agent.spawn({ ...SPAWN, tool_use_id: 't1', description: 'Lead research', subagentType: 'general-purpose' })
  await $.agent.spawn({ ...SPAWN, tool_use_id: 't2', description: 'Read sources', subagentType: 'Explore', parentAgentId: 'a1' })
  await $.agent.spawn({ ...SPAWN, tool_use_id: 't3', description: 'Check prices', subagentType: 'Explore' })

  const ui = await $.ui.mount({ plugin: 'agent-tree', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /^├─ $/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^│  └─ $/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^└─ $/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /3 running/ })).toBeDefined()
  await ui.unmount()
})

test('a finished agent shows done, its tokens, and its answer when clicked', async ($, on) => {
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'a1' }))
  on('turn.complete', () => ({ text: 'ok' }))

  await $.agent.spawn({ ...SPAWN, tool_use_id: 't1', description: 'Summarise docs', subagentType: 'Explore' })
  await $.turn.complete({
    agentId: 'a1',
    answer: 'The auth code lives in src/auth.\nIt uses JWT.',
    durationMs: 4000,
    isAborted: false,
    turnId: 'turn-1',
    reason: 'answer',
    usage: { model: 'sonnet', input_tokens: 12000, output_tokens: 800 } as never,
  })

  const ui = await $.ui.mount({ plugin: 'agent-tree', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /1 done/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /12\.8k tok|13k tok/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /The auth code lives/ })).toBeUndefined()

  await ui.press({ key: 'row-a1' })
  expect(await ui.find({ type: 'Text', text: /» The auth code lives in src\/auth\./ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /model sonnet/ })).toBeDefined()

  await ui.press({ key: 'clear' })
  expect(await ui.find({ type: 'Button', text: /Summarise docs/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /No agents yet/ })).toBeDefined()
  await ui.unmount()
})

test('an aborted agent shows stopped', async ($, on) => {
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'a1' }))
  on('turn.complete', () => ({ text: '' }))

  await $.agent.spawn({ ...SPAWN, tool_use_id: 't1', description: 'Long crawl', subagentType: 'Explore' })
  await $.turn.complete({ agentId: 'a1', answer: '', durationMs: 1, isAborted: true, turnId: 'x', reason: 'aborted' })

  const ui = await $.ui.mount({ plugin: 'agent-tree', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /1 stopped/ })).toBeDefined()
  await ui.unmount()
})

test('with no agents the tree says so', async $ => {
  const ui = await $.ui.mount({ plugin: 'agent-tree', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /No agents yet/ })).toBeDefined()
  await ui.unmount()
})

test('a resumed agent runs again, timed afresh, its old answer gone', async ($, on) => {
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'a1' }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', { tool: 'Grep' as never }, () => ({ result: { mode: 'files_with_matches', filenames: [], numFiles: 0 } as never }))

  await $.agent.spawn({ ...SPAWN, tool_use_id: 't1', description: 'Audit', subagentType: 'Explore' })
  await $.turn.complete({ agentId: 'a1', answer: 'First answer', durationMs: 1, isAborted: false, turnId: 'x', reason: 'answer' })
  await $.tool.call({ tool: 'Grep', pattern: 'again', agentId: 'a1' } as never)

  const ui = await $.ui.mount({ plugin: 'agent-tree', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /1 running/ })).toBeDefined()
  await ui.press({ key: 'row-a1' })
  expect(await ui.find({ type: 'Text', text: /First answer/ })).toBeUndefined()
  await ui.unmount()
})

test('an agent the tree never saw start appears on its first step', async ($, on) => {
  on('tool.call', { tool: 'Grep' as never }, () => ({ result: { mode: 'files_with_matches', filenames: [], numFiles: 0 } as never }))
  await $.tool.call({ tool: 'Grep', pattern: 'x', agentId: 'ghost' } as never)

  const ui = await $.ui.mount({ plugin: 'agent-tree', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /↳ Grep: x/ })).toBeDefined()
  await ui.unmount()
})
