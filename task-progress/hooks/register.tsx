import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Task, TaskStatus, Turn } from '../types'

const tasks = atom({ plugin: 'task-progress', key: 'tasks' } as const, [])
const turn = atom({ plugin: 'task-progress', key: 'turn' } as const, null as Turn | null)
const expanded = atom({ plugin: 'task-progress', key: 'expanded' } as const, false)

const HISTORY = 12
const PLAN = 'mcp__task-progress__plan'
const STATUSES: TaskStatus[] = ['pending', 'in_progress', 'completed']

// The plan tool's input, read defensively: the model writes it.
const planFrom = (input: unknown): Task[] | string => {
  const raw = (input as { tasks?: unknown }).tasks
  if (!Array.isArray(raw) || raw.length === 0) {
    return 'tasks must be a non-empty array'
  }

  const list: Task[] = []
  for (const [i, item] of raw.entries()) {
    const { title, active, status } = (item ?? {}) as Record<string, unknown>
    if (typeof title !== 'string' || title === '') {
      return `tasks[${i}].title must be a non-empty string`
    }
    if (!STATUSES.includes(status as TaskStatus)) {
      return `tasks[${i}].status must be one of ${STATUSES.join(', ')}`
    }
    list.push({
      id: String(i),
      title,
      active: typeof active === 'string' && active !== '' ? active : title,
      status: status as TaskStatus,
    })
  }

  return list
}

// Two thin rows on the terminal's own background: a text line, then a full-width rule.
const LINE = '━'
const TRACK = '#3b4261'
const TITLE = '#c0caf5'
const ACCENT = '#7dcfff'
const MUTED = '#565f89'
const TEXT = '#a9b1d6'
const FROM = '#7c3aed'
const TO = '#22d3ee'
const DONE = '#22c55e'

const short = (text: string, max: number) =>
  max <= 1 ? '' : text.length > max ? `${text.slice(0, max - 1)}…` : text

const mix = (a: string, b: string, t: number) => {
  const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16)
  const parts = [0, 1, 2].map(i => Math.round(channel(a, i) + (channel(b, i) - channel(a, i)) * t))

  return `#${parts.map(n => n.toString(16).padStart(2, '0')).join('')}`
}

// One color per cell, then runs of the same color merged into one Text each.
type Run = { color: string; length: number }

const runs = (cells: string[]) =>
  cells.reduce<Run[]>((all, color) => {
    const last = all[all.length - 1]
    if (last && last.color === color) {
      last.length += 1
    } else {
      all.push({ color, length: 1 })
    }

    return all
  }, [])

// Gradient cells are grouped in fours so a wide terminal stays a few dozen Texts.
const gradient = (i: number, length: number) => mix(FROM, TO, length <= 1 ? 1 : Math.floor(i / 4) * 4 / (length - 1))

const filledCells = (width: number, done: number, total: number) => {
  const filled = total === 0 ? 0 : Math.round((done / total) * width)

  return Array.from({ length: width }, (_, i) =>
    i >= filled ? TRACK : done === total ? DONE : gradient(i, filled),
  )
}

// No known total: a comet that moves a stride per step and fades at its tail.
const cometCells = (width: number, steps: number) => {
  const length = Math.max(6, Math.floor(width / 5))
  const stride = Math.max(2, Math.floor(width / 12))
  const head = (steps * stride) % (width + length)

  return Array.from({ length: width }, (_, i) => {
    const behind = head - i
    if (behind <= 0 || behind > length) {
      return TRACK
    }

    return mix(TRACK, gradient(length - behind, length), 1 - (behind - 1) / length)
  })
}

type Line = { mark: string; text: string; color: string; bold?: boolean }
type Card = {
  title: string
  stat: string
  percent: string
  cells: (width: number) => string[]
  footer: string
  lines: Line[]
}

const describe = (e: { tool: string }) => {
  const { description } = e as { description?: unknown }

  return typeof description === 'string' && description !== '' ? `${e.tool}: ${description}` : e.tool
}

export const register: Register = on => {
  // A plan tool the agent can always call, so the band has a real list even
  // in sessions without TodoWrite or TaskCreate.
  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: 'plan',
      description:
        'Shows your plan in the progress band above the prompt. Call it at the start of any task with 3 or more steps, ' +
        'with the full list of tasks, and call it again with the whole updated list each time a task starts or finishes. ' +
        'Exactly one task is in_progress while you work.',
      inputSchema: {
        type: 'object',
        properties: {
          tasks: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              properties: {
                title: { type: 'string', description: 'The task, imperative: "Search Reddit"' },
                active: { type: 'string', description: 'The task while running: "Searching Reddit"' },
                status: { type: 'string', enum: STATUSES },
              },
              required: ['title', 'status'],
            },
          },
        },
        required: ['tasks'],
      },
    })

    return next(e)
  }).catch(($, e, next) => next(e))

  // Each prompt starts a fresh turn.
  on('prompt.submit', async ($, e, next) => {
    await update($, turn, () => ({ steps: 0, current: 'Thinking', history: [] }))

    return next(e)
  }).catch(($, e, next) => next(e))

  // Every tool call is one step of the turn.
  on('tool.call', async ($, e, next) => {
    // The plan tool is answered here: a typed matcher can't name it before it exists.
    if ((e.tool as string) === PLAN) {
      const list = planFrom(e)
      if (typeof list === 'string') {
        return { deny: list }
      }

      await update($, tasks, () => list)
      const done = list.filter(one => one.status === 'completed').length

      return { result: `Plan shown: ${done}/${list.length} done.` }
    }

    await update($, turn, now => ({
      steps: (now?.steps ?? 0) + 1,
      current: describe(e),
      history: now ? [...now.history, now.current].slice(-HISTORY) : [],
    }))

    return next(e)
  }).catch(($, e, next) => next(e))

  // TodoWrite sends the whole list each time: replace ours with it.
  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true) {
      const list: Task[] = e.todos.map((todo, i) => ({
        id: String(i),
        title: todo.content,
        active: todo.activeForm || todo.content,
        status: todo.status,
      }))
      await update($, tasks, () => list)
    }

    return ran
  }).catch(($, e, next) => next(e))

  // TaskCreate adds one task; its id comes back in the result.
  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true) {
      const task: Task = {
        id: ran.result.task.id,
        title: e.subject,
        active: e.activeForm || e.subject,
        status: 'pending',
      }
      await update($, tasks, list => [...list.filter(one => one.id !== task.id), task])
    }

    return ran
  }).catch(($, e, next) => next(e))

  // TaskUpdate changes one task's status or wording.
  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true && ran.result.success) {
      const { status } = e
      await update($, tasks, list =>
        status === 'deleted'
          ? list.filter(one => one.id !== e.taskId)
          : list.map(one =>
              one.id !== e.taskId
                ? one
                : {
                    ...one,
                    title: e.subject ?? one.title,
                    active: e.activeForm ?? e.subject ?? one.active,
                    status: status ?? one.status,
                  },
            ),
      )
    }

    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, tasks)
    const total = list.length
    const done = list.filter(one => one.status === 'completed').length

    if (e.props.hasSurvey) {
      return next(e)
    }

    let card: Card
    if (total === 0) {
      // No task list: follow the turn while the agent works.
      const now = await read($, turn)
      if (now === null || !e.props.isWorking) {
        return next(e)
      }

      card = {
        title: now.current,
        stat: now.steps === 1 ? '1 step' : `${now.steps} steps`,
        percent: '',
        cells: width => cometCells(width, now.steps),
        footer: '',
        lines: [
          ...now.history.map(text => ({ mark: '✓', text, color: MUTED })),
          { mark: '▶', text: now.current, color: ACCENT, bold: true },
        ],
      }
    } else {
      // Everything finished and the agent is idle.
      if (done === total && !e.props.isWorking) {
        return next(e)
      }

      const current = list.find(one => one.status === 'in_progress')
      const upcoming = list.find(one => one.status === 'pending')
      card = {
        title: current ? current.active : done === total ? 'All tasks done' : 'Getting ready',
        stat: `${done}/${total} tasks`,
        percent: `${Math.round((done / total) * 100)}%`,
        cells: width => filledCells(width, done, total),
        footer: upcoming ? `next: ${upcoming.title}` : '',
        lines: list.map(one =>
          one.status === 'completed'
            ? { mark: '✓', text: one.title, color: DONE }
            : one.status === 'in_progress'
              ? { mark: '▶', text: one.active, color: ACCENT, bold: true }
              : { mark: '○', text: one.title, color: TEXT },
        ),
      }
    }

    const { Box, Button, Text } = $.ui.resolve(e)
    const open = await read($, expanded)
    const width = Math.max(20, e.props.bodyColumns)
    const stat = card.stat
    const label = `${open ? '▾' : '▸'} ${card.title}`
    const footer = open ? '' : `  ${card.footer}`
    const room = width - stat.length - 1
    const title = short(label, Math.min(room, Math.max(24, room - footer.length)))
    const hint = short(footer, room - title.length)
    const gap = ' '.repeat(Math.max(1, width - title.length - hint.length - stat.length))
    const percent = card.percent === '' ? '' : ` ${card.percent.padStart(4)}`
    const bar = runs(card.cells(width - percent.length))

    return (
      <Box flexDirection="column">
        <Box>
          <Button key="toggle" plain onPress={() => update($, expanded, now => !now)}>
            {title}
          </Button>
          <Text color={MUTED}>{hint}</Text>
          <Text>{gap}</Text>
          <Text color={ACCENT} bold>
            {stat}
          </Text>
        </Box>
        <Box>
          {bar.map((run, i) => (
            <Text key={String(i)} color={run.color}>
              {LINE.repeat(run.length)}
            </Text>
          ))}
          <Text color={TITLE} bold>
            {percent}
          </Text>
        </Box>
        {open &&
          card.lines.map((line, i) => (
            <Text key={`line-${i}`} color={line.color} bold={line.bold === true}>
              {`  ${line.mark} ${short(line.text, width - 4)}`}
            </Text>
          ))}
      </Box>
    )
  })
}
