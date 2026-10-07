import { expect, test } from 'claude-code/testing'

const todos = [
  { content: 'Write the parser', activeForm: 'Writing the parser', status: 'completed' as const },
  { content: 'Run the tests', activeForm: 'Running the tests', status: 'in_progress' as const },
  { content: 'Deploy the app', activeForm: 'Deploying the app', status: 'pending' as const },
]

const BAND = {
  component: 'AbovePrompt' as const,
  props: {
    hasSurvey: false,
    isWorking: true,
    maxRows: 10,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
}

test('band shows current task, progress and next task', async ($, on) => {
  on('tool.call', { tool: 'TodoWrite' }, () => ({ result: { oldTodos: [], newTodos: todos } }))
  await $.tool.call({ tool: 'TodoWrite', todos })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'task-progress', surface, ...BAND })
    expect(await ui.find({ type: 'Button', text: /Running the tests/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /1\/3 tasks/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /33%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /next: Deploy the app/ })).toBeDefined()
    await ui.unmount()
  }
})

test('TaskCreate and TaskUpdate drive the band too', async ($, on) => {
  let n = 0
  on('tool.call', { tool: 'TaskCreate' }, (_$, e) => ({ result: { task: { id: String(++n), subject: e.subject } } }))
  on('tool.call', { tool: 'TaskUpdate' }, (_$, e) => ({ result: { success: true, taskId: e.taskId, updatedFields: ['status'] } }))
  await $.tool.call({ tool: 'TaskCreate', subject: 'Fix login', description: 'x', activeForm: 'Fixing login' })
  await $.tool.call({ tool: 'TaskCreate', subject: 'Add tests', description: 'y' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'in_progress' })

  const ui = await $.ui.mount({ plugin: 'task-progress', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Button', text: /Fixing login/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /next: Add tests/ })).toBeDefined()
  await ui.unmount()
})

test('without a task list the band follows the turn', async ($, on) => {
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false } }))
  await $.tool.call({ tool: 'Bash', command: 'ls', description: 'List files' })
  await $.tool.call({ tool: 'Bash', command: 'pwd', description: 'Show directory' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'task-progress', surface, ...BAND })
    expect(await ui.find({ type: 'Button', text: /Bash: Show directory/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /2 steps/ })).toBeDefined()
    await ui.unmount()
  }
})

test('the turn band hides when the agent is idle', async ($, on) => {
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false } }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine band</Text>
  })
  await $.tool.call({ tool: 'Bash', command: 'ls', description: 'List files' })

  const ui = await $.ui.mount({ plugin: 'task-progress', surface: 'terminal', ...BAND, props: { ...BAND.props, isWorking: false } })
  expect(await ui.find({ type: 'Text', text: /List files/ })).toBeUndefined()
  await ui.unmount()
})

const plan = [
  { title: 'Search Reddit', active: 'Searching Reddit', status: 'completed' },
  { title: 'Read the threads', active: 'Reading the threads', status: 'in_progress' },
  { title: 'Keep the money posts', status: 'pending' },
  { title: 'Propose ideas', status: 'pending' },
]

test('the plan tool fills the band with a real percentage', async $ => {
  const ran = await $.tool.call({ tool: 'mcp__task-progress__plan', tasks: plan } as never)
  expect(JSON.stringify(ran)).toContain('1/4 done')

  const ui = await $.ui.mount({ plugin: 'task-progress', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /25%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /next: Keep the money posts/ })).toBeDefined()
  await ui.unmount()
})

test('a bad plan is refused', async $ => {
  const ran = await $.tool.call({ tool: 'mcp__task-progress__plan', tasks: [{ title: 'x', status: 'done' }] } as never)
  expect(JSON.stringify(ran)).toContain('status must be one of')
})

test('clicking the task line shows every task, clicking again hides them', async $ => {
  await $.tool.call({ tool: 'mcp__task-progress__plan', tasks: plan } as never)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'task-progress', surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: /○ Propose ideas/ })).toBeUndefined()

    await ui.press({ key: 'toggle' })
    expect(await ui.find({ type: 'Text', text: /✓ Search Reddit/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /▶ Reading the threads/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /○ Propose ideas/ })).toBeDefined()

    await ui.press({ key: 'toggle' })
    expect(await ui.find({ type: 'Text', text: /○ Propose ideas/ })).toBeUndefined()
    await ui.unmount()
  }
})
