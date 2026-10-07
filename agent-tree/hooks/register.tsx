import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Agent, AgentStatus } from '../types'

const agents = atom({ plugin: 'agent-tree', key: 'agents' } as const, [] as Agent[])
const expanded = atom({ plugin: 'agent-tree', key: 'expanded' } as const, [] as string[])
const now = atom({ plugin: 'agent-tree', key: 'now' } as const, 0)
const opened = atom({ plugin: 'agent-tree', key: 'opened' } as const, false)

const PANE = 'agent-tree'
const TITLE = 'Agents'
const STEPS = 8
// Past this long with no news, a running agent stops moving the clock.
const QUIET_MS = 10 * 60 * 1000
const FRAMES = ['◐', '◓', '◑', '◒']

const COLORS: Record<AgentStatus, string> = {
  running: '#7dcfff',
  done: '#22c55e',
  failed: '#f7768e',
  stopped: '#e0af68',
}
const ICONS: Record<Exclude<AgentStatus, 'running'>, string> = { done: '✓', failed: '✗', stopped: '■' }
const ROOT = '#bb9af7'
const TEXT = '#c0caf5'
const MUTED = '#565f89'

const short = (text: string, max: number) =>
  max <= 1 ? '' : text.length > max ? `${text.slice(0, max - 1)}…` : text

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()

const clock = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(seconds / 60)

  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m}:${String(seconds % 60).padStart(2, '0')}`
}

const count = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n))

const describe = (e: { tool: string }) => {
  const input = e as { description?: unknown; command?: unknown; pattern?: unknown; file_path?: unknown; query?: unknown; url?: unknown }
  const detail = [input.description, input.query, input.pattern, input.url, input.file_path, input.command].find(
    value => typeof value === 'string' && value !== '',
  ) as string | undefined
  const tool = e.tool.startsWith('mcp__') ? (e.tool.split('__').at(-1) ?? e.tool) : e.tool

  return detail ? `${tool}: ${oneLine(detail)}` : tool
}

const patch = (list: Agent[], id: string, change: (agent: Agent) => Agent) =>
  list.map(agent => (agent.id === id ? change(agent) : agent))

// Depth-first, children under their parent, each row with its tree prefix.
type Row = { agent: Agent; prefix: string; under: string }

const flatten = (list: Agent[]) => {
  const ids = new Set(list.map(agent => agent.id))
  const isRoot = (agent: Agent) => agent.parentId === null || agent.parentId === agent.id || !ids.has(agent.parentId)
  const childrenOf = (parent: string | null) =>
    list.filter(agent => (parent === null ? isRoot(agent) : agent.parentId === parent && !isRoot(agent)))
  const rows: Row[] = []
  const seen = new Set<string>()
  const walk = (parent: string | null, indent: string) => {
    // A parent loop would hide its agents: each agent is drawn once, at most.
    const children = childrenOf(parent).filter(agent => !seen.has(agent.id))
    children.forEach(agent => seen.add(agent.id))
    children.forEach((agent, i) => {
      const isLast = i === children.length - 1
      rows.push({ agent, prefix: `${indent}${isLast ? '└─ ' : '├─ '}`, under: `${indent}${isLast ? '   ' : '│  '}` })
      walk(agent.id, `${indent}${isLast ? '   ' : '│  '}`)
    })
  }
  walk(null, '')
  // Agents caught in a loop of parents, drawn at the root.
  const rest = list.filter(agent => !seen.has(agent.id))
  rest.forEach((agent, i) => {
    const isLast = i === rest.length - 1
    rows.push({ agent, prefix: isLast ? '└─ ' : '├─ ', under: isLast ? '   ' : '│  ' })
  })

  return rows
}

// The status line says how many agents run, and clears when none do.
const showStatus = async ($: EngineInterface) => {
  const list = await read($, agents)
  const running = list.filter(agent => agent.status === 'running').length
  $.ui.status(running === 0 ? undefined : `⑂ ${running} agent${running === 1 ? '' : 's'} running`)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'agent-tree', description: 'Open the live tree of subagents' })
    await update($, now, () => Date.now())

    // Keeps elapsed times and spinners moving while anything runs.
    $.clock.every(500, () => {
      void (async () => {
        const list = await read($, agents)
        const at = Date.now()
        if (list.some(agent => agent.status === 'running' && at - agent.lastAt < QUIET_MS)) {
          await update($, now, () => Date.now())
        }
      })()
    })

    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'agent-tree' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'Agent tree opened.' }
  })

  // A new subagent: add it under its parent, and show the tree the first time.
  on('agent.spawn', async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined) {
      return ran
    }

    const startedAt = Date.now()
    const agent: Agent = {
      id: ran.agentId ?? e.tool_use_id,
      parentId: e.parentAgentId ?? null,
      type: e.subagentType,
      description: oneLine(e.description),
      model: ran.model,
      status: 'running',
      startedAt,
      endedAt: null,
      lastAt: startedAt,
      tools: 0,
      current: 'Starting',
      steps: [],
      answer: '',
      tokens: 0,
    }
    await update($, agents, list => [...list.filter(one => one.id !== agent.id), agent])
    await update($, now, () => startedAt)
    await showStatus($)

    if (!(await read($, opened))) {
      await update($, opened, () => true)
      // Not awaited: an unasked pane waits for a wide enough terminal.
      $.ui.open({ id: PANE, title: TITLE }).catch(() => undefined)
    }

    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const { agentId } = e
    if (agentId !== undefined) {
      // A subagent's own step; a resumed agent is running again.
      const step = describe(e)
      const at = Date.now()
      await update($, agents, list => {
        // An agent the tree never saw start (spawned before this mod loaded).
        const known = list.some(agent => agent.id === agentId)
        const all = known
          ? list
          : [
              ...list,
              {
                id: agentId,
                parentId: null,
                type: (e as { agent_type?: unknown }).agent_type?.toString() ?? 'agent',
                description: '',
                model: 'unknown',
                status: 'running' as const,
                startedAt: at,
                endedAt: null,
                lastAt: at,
                tools: 0,
                current: '',
                steps: [],
                answer: '',
                tokens: 0,
              },
            ]

        return patch(all, agentId, agent => {
          // Resumed after it finished: a fresh run, timed from now.
          const resumed = agent.status !== 'running'

          return {
            ...agent,
            status: 'running',
            startedAt: resumed ? at : agent.startedAt,
            endedAt: null,
            lastAt: at,
            tools: agent.tools + 1,
            current: step,
            steps: [...(resumed ? [] : agent.steps), step].slice(-STEPS),
            answer: resumed ? '' : agent.answer,
          }
        })
      })
      await showStatus($)
    }

    const ran = await next(e)

    // The main session stopping an agent.
    if ((e.tool as string) === 'TaskStop' && ran.deny === undefined && ran.isError !== true) {
      const { task_id: taskId } = e as { task_id?: unknown }
      if (typeof taskId === 'string') {
        const endedAt = Date.now()
        await update($, agents, list =>
          patch(list, taskId, agent => (agent.status === 'running' ? { ...agent, status: 'stopped', endedAt } : agent)),
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
      const endedAt = Date.now()
      const used = e.usage ? e.usage.input_tokens + e.usage.output_tokens : 0
      await update($, agents, list =>
        patch(list, agentId, agent => ({
          ...agent,
          status,
          endedAt,
          current: status === 'done' ? 'Finished' : status === 'failed' ? 'Failed' : 'Stopped',
          answer: e.answer.trim(),
          tokens: agent.tokens + used,
        })),
      )
      await update($, now, () => endedAt)
      await showStatus($)
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const list = await read($, agents)
    const open = await read($, expanded)
    const time = await read($, now)
    const width = Math.max(30, e.props.bodyColumns)
    const frame = FRAMES[Math.floor(time / 500) % FRAMES.length] ?? '◐'

    const tally = (status: AgentStatus) => list.filter(agent => agent.status === status).length
    const summary = [
      [tally('running'), 'running'],
      [tally('done'), 'done'],
      [tally('failed'), 'failed'],
      [tally('stopped'), 'stopped'],
    ]
      .filter(([n]) => n !== 0)
      .map(([n, label]) => `${n} ${label}`)
      .join(' · ')

    const toggle = (id: string) => update($, expanded, ids => (ids.includes(id) ? ids.filter(one => one !== id) : [...ids, id]))
    const clear = async () => {
      const keep = (await read($, agents)).filter(agent => agent.status === 'running')
      await update($, agents, () => keep)
      await update($, expanded, ids => ids.filter(id => keep.some(agent => agent.id === id)))
    }

    return (
      <Box flexDirection="column">
        <Box>
          <Text color={ROOT} bold>
            ◆ main session
          </Text>
          <Text color={MUTED}>{summary === '' ? '' : `  ${summary}`}</Text>
        </Box>
        {list.length === 0 && (
          <Text color={MUTED}>{'   No agents yet. They show up here the moment one is spawned.'}</Text>
        )}
        {flatten(list).map(({ agent, prefix, under }) => {
          const isOpen = open.includes(agent.id)
          const icon = agent.status === 'running' ? frame : ICONS[agent.status]
          const elapsed = clock((agent.endedAt ?? Math.max(time, agent.startedAt)) - agent.startedAt)
          const stats = [elapsed, `${agent.tools} tool${agent.tools === 1 ? '' : 's'}`, agent.tokens > 0 ? `${count(agent.tokens)} tok` : '']
            .filter(Boolean)
            .join(' · ')
          const head = `${prefix}${icon} `
          const label = short(`${agent.type}  ${agent.description}`, width - head.length - stats.length - 2)
          const gap = ' '.repeat(Math.max(1, width - head.length - label.length - stats.length))
          const detail = (text: string, color: string, key: string) => (
            <Text key={key} color={color}>
              {short(`${under}  ${text}`, width)}
            </Text>
          )

          return (
            <Box key={agent.id} flexDirection="column">
              <Box>
                <Text color={MUTED}>{prefix}</Text>
                <Text color={COLORS[agent.status]} bold>
                  {`${icon} `}
                </Text>
                <Button key={`row-${agent.id}`} plain onPress={() => toggle(agent.id)}>
                  {label}
                </Button>
                <Text>{gap}</Text>
                <Text color={MUTED}>{stats}</Text>
              </Box>
              {agent.status === 'running' && detail(`↳ ${agent.current}`, TEXT, 'current')}
              {isOpen && detail(`model ${agent.model}`, MUTED, 'model')}
              {isOpen &&
                agent.steps
                  .slice(agent.status === 'running' ? 0 : undefined, agent.status === 'running' ? -1 : undefined)
                  .map((step, i) => detail(`· ${step}`, MUTED, `step-${i}`))}
              {isOpen &&
                agent.answer !== '' &&
                agent.answer
                  .split('\n')
                  .filter(line => line.trim() !== '')
                  .slice(0, 4)
                  .map((line, i) => detail(`${i === 0 ? '» ' : '  '}${oneLine(line)}`, COLORS[agent.status], `answer-${i}`))}
            </Box>
          )
        })}
        <Text> </Text>
        <Box>
          {list.some(agent => agent.status !== 'running') && (
            <Button key="clear" onPress={() => void clear()}>
              Clear finished
            </Button>
          )}
          <Text> </Text>
          <Button key="close" role="dismiss" onPress={() => void $.ui.close({ id: PANE })}>
            Close
          </Button>
        </Box>
        <Text color={MUTED}>click an agent to see its steps and answer</Text>
      </Box>
    )
  })
}
