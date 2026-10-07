import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Agent, AgentStatus, PaneSize } from '../types'

const agents = atom({ plugin: 'agent-tree', key: 'agents' } as const, [] as Agent[])
const now = atom({ plugin: 'agent-tree', key: 'now' } as const, 0)
const opened = atom({ plugin: 'agent-tree', key: 'opened' } as const, false)
const size = atom({ plugin: 'agent-tree', key: 'size' } as const, { columns: 0, rows: 0 } as PaneSize)

const PANE = 'agent-tree'
const TITLE = 'Agents'
const TICK_MS = 300
// Past this long with no news, a working agent stops moving the clock.
const QUIET_MS = 10 * 60 * 1000
// Cards are at least this wide, borders included; the pane fits as many as it can.
const MIN_CARD = 28
// One press of − or + : a card's width when docked, a card's height inline.
const STEP_COLUMNS = MIN_CARD + 1
const STEP_ROWS = 7
const LIMITS = { columns: [MIN_CARD + 2, 240], rows: [9, 80] } as const

const clamp = (n: number, [low, high]: readonly [number, number]) => Math.min(high, Math.max(low, n))

// Opens the pane at the size last asked for; a size the person dragged still wins.
const openPane = async ($: EngineInterface) => {
  const { columns, rows } = await read($, size)
  await $.ui.open({ id: PANE, title: TITLE, ...(columns > 0 ? { columns } : {}), ...(rows > 0 ? { rows } : {}) })
}

const COLORS: Record<AgentStatus, string> = {
  running: '#d97757',
  done: '#22c55e',
  failed: '#f7768e',
  stopped: '#e0af68',
}
const LABELS: Record<AgentStatus, string> = { running: 'working', done: 'done', failed: 'failed', stopped: 'stopped' }
const ROOT = '#d97757'
const TEXT = '#c0caf5'
const MUTED = '#565f89'

// The little Claude critter, three rows tall. A working one walks and blinks.
const HEAD = ' ▐▛███▜▌ '
const BLINK = ' ▐█████▌ '
const BODY = '▝▜█████▛▘'
const LEGS = ['  ▘▘ ▝▝  ', '  ▝▘ ▘▝  ']
const STILL = '  ▘▘ ▝▝  '

const critter = (status: AgentStatus, tick: number) =>
  status === 'running'
    ? [tick % 12 === 0 ? BLINK : HEAD, BODY, LEGS[tick % LEGS.length] ?? STILL]
    : [HEAD, BODY, STILL]

const short = (text: string, max: number) =>
  max <= 1 ? '' : text.length > max ? `${text.slice(0, max - 1)}…` : text

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()

const base = (path: string) => path.split('/').filter(Boolean).at(-1) ?? path

const host = (url: string) => /^[a-z]+:\/\/([^/]+)/i.exec(url)?.[1] ?? url

// One plain sentence for what a tool call is doing.
const sentence = (e: { tool: string }) => {
  const input = e as Record<string, unknown>
  const text = (key: string) => (typeof input[key] === 'string' ? oneLine(input[key] as string) : '')
  const tool = e.tool.startsWith('mcp__') ? (e.tool.split('__').at(-1) ?? e.tool) : e.tool

  switch (tool) {
    case 'Read':
      return `Reading ${base(text('file_path'))}`
    case 'Grep':
      return `Searching the code for "${text('pattern')}"`
    case 'Glob':
      return `Looking for files like ${text('pattern')}`
    case 'Edit':
      return `Editing ${base(text('file_path'))}`
    case 'Write':
      return `Writing ${base(text('file_path'))}`
    case 'WebSearch':
      return `Searching the web for "${text('query')}"`
    case 'WebFetch':
      return `Reading a page on ${host(text('url'))}`
    case 'Bash':
      return text('description') || `Running ${text('command').split(' ')[0] || 'a command'}`
    case 'Agent':
      return `Handing off: ${text('description')}`
    default:
      return text('description') || `Using ${tool}`
  }
}

const firstSentence = (text: string) => {
  const flat = oneLine(text.replace(/[#*`>_]/g, ''))

  return (/^.+?[.!?](\s|$)/.exec(flat)?.[0] ?? flat).trim()
}

// Words into at most `lines` lines of `width`, the last one cut with an ellipsis.
const wrap = (text: string, width: number, lines: number) => {
  const out: string[] = []
  let rest = text
  while (rest !== '' && out.length < lines) {
    if (out.length === lines - 1 || rest.length <= width) {
      out.push(short(rest, width))
      break
    }
    const cut = rest.lastIndexOf(' ', width)
    const at = cut > 0 ? cut : width
    out.push(rest.slice(0, at))
    rest = rest.slice(at).trimStart()
  }

  return out
}

const patch = (list: Agent[], id: string, change: (agent: Agent) => Agent) =>
  list.map(agent => (agent.id === id ? change(agent) : agent))

// Parents before their children, so a team reads left to right.
const ordered = (list: Agent[]) => {
  const ids = new Set(list.map(agent => agent.id))
  const isRoot = (agent: Agent) => agent.parentId === null || agent.parentId === agent.id || !ids.has(agent.parentId)
  const out: Agent[] = []
  const seen = new Set<string>()
  const walk = (agent: Agent) => {
    if (seen.has(agent.id)) {
      return
    }
    seen.add(agent.id)
    out.push(agent)
    list.filter(one => one.parentId === agent.id && !isRoot(one)).forEach(walk)
  }
  list.filter(isRoot).forEach(walk)
  // Agents caught in a loop of parents.
  list.filter(agent => !seen.has(agent.id)).forEach(agent => out.push(agent))

  return out
}

// The status line says how many agents work, and clears when none do.
const showStatus = async ($: EngineInterface) => {
  const list = await read($, agents)
  const running = list.filter(agent => agent.status === 'running').length
  $.ui.status(running === 0 ? undefined : `▐▛▜▌ ${running} agent${running === 1 ? '' : 's'} working`)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'agent-tree', description: 'Open the live board of subagents' })
    await update($, now, () => Date.now())

    // Walks the critters while anything works.
    $.clock.every(TICK_MS, () => {
      void (async () => {
        const list = await read($, agents)
        const at = Date.now()
        if (list.some(agent => agent.status === 'running' && at - agent.lastAt < QUIET_MS)) {
          await update($, now, () => at)
        }
      })()
    })

    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'agent-tree' }, async $ => {
    await openPane($)

    return { text: 'Agent board opened.' }
  })

  // A new subagent joins the board, which opens the first time.
  on('agent.spawn', async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined) {
      return ran
    }

    const at = Date.now()
    const agent: Agent = {
      id: ran.agentId ?? e.tool_use_id,
      parentId: e.parentAgentId ?? null,
      type: e.subagentType,
      status: 'running',
      lastAt: at,
      doing: `Getting started: ${oneLine(e.description)}`,
    }
    await update($, agents, list => [...list.filter(one => one.id !== agent.id), agent])
    await update($, now, () => at)
    await showStatus($)

    if (!(await read($, opened))) {
      await update($, opened, () => true)
      // Not awaited: an unasked pane waits for a wide enough terminal.
      openPane($).catch(() => undefined)
    }

    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const { agentId } = e
    if (agentId !== undefined) {
      // A subagent's own step; a resumed agent works again.
      const doing = sentence(e)
      const at = Date.now()
      await update($, agents, list => {
        // An agent the board never saw start (spawned before this mod loaded).
        const all = list.some(agent => agent.id === agentId)
          ? list
          : [
              ...list,
              {
                id: agentId,
                parentId: null,
                type: (e as { agent_type?: unknown }).agent_type?.toString() ?? 'agent',
                status: 'running' as const,
                lastAt: at,
                doing,
              },
            ]

        return patch(all, agentId, agent => ({ ...agent, status: 'running', lastAt: at, doing }))
      })
      await showStatus($)
    }

    const ran = await next(e)

    // The main session stopping an agent.
    if ((e.tool as string) === 'TaskStop' && ran.deny === undefined && ran.isError !== true) {
      const { task_id: taskId } = e as { task_id?: unknown }
      if (typeof taskId === 'string') {
        await update($, agents, list =>
          patch(list, taskId, agent =>
            agent.status === 'running' ? { ...agent, status: 'stopped', doing: 'Was stopped before it finished.' } : agent,
          ),
        )
        await showStatus($)
      }
    }

    return ran
  }).catch(($, e, next) => next(e))

  // A subagent's turn ended: done, failed or stopped.
  on('turn.complete', async ($, e, next) => {
    const { agentId } = e
    if (agentId !== undefined) {
      const status: AgentStatus = e.isAborted ? 'stopped' : e.reason === 'answer' ? 'done' : 'failed'
      const answer = firstSentence(e.answer)
      const doing =
        status === 'done'
          ? answer === ''
            ? 'Finished.'
            : `Done: ${answer}`
          : status === 'failed'
            ? 'Hit an error and stopped.'
            : 'Was stopped before it finished.'
      await update($, agents, list => patch(list, agentId, agent => ({ ...agent, status, lastAt: Date.now(), doing })))
      await update($, now, () => Date.now())
      await showStatus($)
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const list = ordered(await read($, agents))
    const time = await read($, now)
    const width = Math.max(MIN_CARD, e.props.bodyColumns)
    const perRow = Math.max(1, Math.floor((width + 1) / (MIN_CARD + 1)))
    const card = Math.floor((width + 1) / perRow) - 1
    const inner = card - 4
    const tick = Math.floor(time / TICK_MS)

    const working = list.filter(agent => agent.status === 'running').length
    const finished = list.length - working
    const summary = [working ? `${working} working` : '', finished ? `${finished} finished` : ''].filter(Boolean).join(' · ')

    const isDocked = e.props.placement === 'dock'
    const visibleRows = e.props.scroll.bodyRows
    const resize = async (direction: 1 | -1) => {
      const now = await read($, size)
      const next = isDocked
        ? { ...now, columns: clamp((now.columns || width) + direction * STEP_COLUMNS, LIMITS.columns) }
        : { ...now, rows: clamp((now.rows || visibleRows) + direction * STEP_ROWS, LIMITS.rows) }
      await update($, size, () => next)
      await openPane($)
    }

    const clear = async () => {
      await update($, agents, all => all.filter(agent => agent.status === 'running'))
    }

    return (
      <Box flexDirection="column">
        <Box>
          <Text color={ROOT} bold>
            Agents
          </Text>
          <Text color={MUTED}>{summary === '' ? '' : `  ${summary}`}</Text>
        </Box>
        {list.length === 0 && <Text color={MUTED}>No agents yet. Each one shows up here the moment it starts.</Text>}
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          {list.map((agent, i) => {
            const color = COLORS[agent.status]
            const [head, body, legs] = critter(agent.status, tick + i * 5)
            const side = inner - HEAD.length - 1
            const lines = wrap(agent.doing, inner, 2)

            return (
              <Box key={agent.id} width={card} height={7} flexDirection="column" borderStyle="round" borderColor={color} paddingX={1}>
                <Box>
                  <Text color={color}>{head}</Text>
                  <Text color={TEXT} bold>
                    {` ${short(agent.type, side)}`}
                  </Text>
                </Box>
                <Box>
                  <Text color={color}>{body}</Text>
                  <Text color={color}>{` ${LABELS[agent.status]}`}</Text>
                </Box>
                <Text color={color}>{legs}</Text>
                {lines.map((line, n) => (
                  <Text key={`line-${n}`} color={agent.status === 'running' ? TEXT : MUTED}>
                    {line}
                  </Text>
                ))}
              </Box>
            )
          })}
        </Box>
        <Box>
          {finished > 0 && (
            <Button key="clear" onPress={() => void clear()}>
              Clear finished
            </Button>
          )}
          <Text> </Text>
          <Button key="smaller" onPress={() => void resize(-1)}>
            {isDocked ? '◂ Narrower' : '▴ Shorter'}
          </Button>
          <Text> </Text>
          <Button key="bigger" onPress={() => void resize(1)}>
            {isDocked ? 'Wider ▸' : 'Taller ▾'}
          </Button>
          <Text> </Text>
          <Button key="close" role="dismiss" onPress={() => void $.ui.close({ id: PANE })}>
            Close
          </Button>
        </Box>
      </Box>
    )
  })
}
