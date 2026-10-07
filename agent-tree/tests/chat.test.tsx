import { expect, test } from 'claude-code/testing'

const PROPS = {
  title: 'Chat',
  isFocused: true,
  bodyColumns: 70,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
}
const BOARD = { component: 'Pane' as const, requestId: 'agent-tree', props: { ...PROPS, title: 'Agents' } }
const CHAT = { component: 'Pane' as const, requestId: 'agent-chat', props: PROPS }

const SPAWN = { prompt: 'Do it', parentModel: 'opus', provider: 'claude' as never, background: false, fork: false }

const opens: { id: string; title?: string }[] = []

test("clicking an agent's card opens its chat, with its steps and results", async ($, on) => {
  on('ui.open', (_$, e) => {
    opens.push(e as never)

    return { value: { isPlaced: true } } as never
  })
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'a1' }))
  on('tool.call', { tool: 'Grep' as never }, () => ({ result: {} as never, text: 'src/auth.ts\nsrc/login.ts\nsrc/session.ts' }) as never)

  await $.agent.spawn({ ...SPAWN, tool_use_id: 't1', description: 'Find auth code', subagentType: 'Explore' })
  await $.tool.call({ tool: 'Grep', pattern: 'login', agentId: 'a1' } as never)

  const board = await $.ui.mount({ plugin: 'agent-tree', surface: 'terminal', ...BOARD })
  await board.post({ open: 'a1' }, { in: 'card-a1' })
  expect(opens.at(-1)).toMatchObject({ id: 'agent-chat', title: 'Chat · Explore' })
  await board.unmount()

  const chat = await $.ui.mount({ plugin: 'agent-tree', surface: 'terminal', ...CHAT })
  expect(await chat.find({ type: 'Text', text: /^Explore$/ })).toBeDefined()
  expect(await chat.find({ type: 'Text', text: /⏺ Searching the code for "login"/ })).toBeDefined()
  expect(await chat.find({ type: 'Text', text: /⎿ src\/auth\.ts · src\/login\.ts \(\+1 lines\)/ })).toBeDefined()
  await chat.unmount()
})

test('its words show up in the chat as they stream', async ($, on) => {
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'a1' }))
  on('turn.step', async function* () {
    yield { kind: 'text', index: 0, text: 'I found the auth ' } as never
    yield { kind: 'text', index: 0, text: 'code in src/auth.' } as never
    yield { kind: 'text', index: 1, text: 'Next I will read it.' } as never

    return { turnId: 'x', index: 0, answer: 'I found the auth code in src/auth.\n\nNext I will read it.', toolUses: [] } as never
  } as never)

  await $.agent.spawn({ ...SPAWN, tool_use_id: 't1', description: 'Find auth code', subagentType: 'Explore' })
  const stream = $.turn.step({ turnId: 'x', index: 0, model: 'sonnet', messageCount: 1, agentId: 'a1' } as never) as unknown as AsyncIterable<unknown>
  for await (const _chunk of stream) {
    // Drain it, as the engine would.
  }

  const board = await $.ui.mount({ plugin: 'agent-tree', surface: 'terminal', ...BOARD })
  await board.post({ open: 'a1' }, { in: 'card-a1' })
  await board.unmount()

  const chat = await $.ui.mount({ plugin: 'agent-tree', surface: 'terminal', ...CHAT })
  expect(await chat.find({ type: 'Text', text: /^I found the auth code in src\/auth\.$/ })).toBeDefined()
  expect(await chat.find({ type: 'Text', text: /^Next I will read it\.$/ })).toBeDefined()
  await chat.unmount()
})

test('typing in the field sends the agent a message', async ($, on) => {
  const sent: { to: unknown; text: string }[] = []
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'a1' }))
  on('turn.complete', () => ({ text: '' }))
  on('session.send', (_$, e) => {
    sent.push(e as never)

    return { isDelivered: true }
  })

  await $.agent.spawn({ ...SPAWN, tool_use_id: 't1', description: 'Audit', subagentType: 'Explore' })
  await $.turn.complete({ agentId: 'a1', answer: 'All good.', durationMs: 1, isAborted: false, turnId: 'x', reason: 'answer' })

  const board = await $.ui.mount({ plugin: 'agent-tree', surface: 'terminal', ...BOARD })
  await board.post({ open: 'a1' }, { in: 'card-a1' })
  await board.unmount()

  const chat = await $.ui.mount({ plugin: 'agent-tree', surface: 'terminal', ...CHAT })
  expect(await chat.find({ type: 'Text', text: /^done$/ })).toBeDefined()
  await chat.input({ key: 'say', text: 'Now check the tests too' })

  expect(sent).toHaveLength(1)
  expect(sent[0]?.text).toBe('Now check the tests too')
  expect(JSON.stringify(sent[0]?.to)).toContain('a1')
  expect(await chat.find({ type: 'Text', text: /you › Now check the tests too/ })).toBeDefined()
  expect(await chat.find({ type: 'Text', text: /^working$/ })).toBeDefined()
  expect(await chat.find({ type: 'Text', text: /Reading your message/ })).toBeDefined()
  await chat.unmount()
})

test('a message that cannot be delivered says why', async ($, on) => {
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'a1' }))
  on('session.send', () => ({ isDelivered: false, reason: 'that agent is gone' }))

  await $.agent.spawn({ ...SPAWN, tool_use_id: 't1', description: 'Audit', subagentType: 'Explore' })
  const board = await $.ui.mount({ plugin: 'agent-tree', surface: 'terminal', ...BOARD })
  await board.post({ open: 'a1' }, { in: 'card-a1' })
  await board.unmount()

  const chat = await $.ui.mount({ plugin: 'agent-tree', surface: 'terminal', ...CHAT })
  await chat.input({ key: 'say', text: 'hello?' })
  expect(await chat.find({ type: 'Text', text: /Not delivered: that agent is gone/ })).toBeDefined()
  await chat.unmount()
})

test('with no agent picked the chat says how to pick one', async $ => {
  const chat = await $.ui.mount({ plugin: 'agent-tree', surface: 'terminal', ...CHAT })
  expect(await chat.find({ type: 'Text', text: /Pick an agent on the board/ })).toBeDefined()
  await chat.unmount()
})
