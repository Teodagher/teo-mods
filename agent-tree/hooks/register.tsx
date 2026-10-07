import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Agent, AgentStatus, Entry, PaneSize } from '../types'

import { registerChat } from './chat'

import {
  BLINK,
  BODY,
  CHAT,
  COLORS,
  HEAD,
  LABELS,
  LEGS,
  LIMITS,
  LOG_LIMIT,
  MIN_CARD,
  MUTED,
  PANE,
  QUIET_MS,
  ROOT,
  STEP_COLUMNS,
  STEP_ROWS,
  STILL,
  TEXT,
  TICK_MS,
  TITLE,
  base,
  clamp,
  critter,
  firstSentence,
  host,
  oneLine,
  ordered,
  patch,
  preview,
  sentence,
  short,
  wrap,
  chatTitle,
  paneArgs,
  statusText,
  withLog,
} from './shared'

// The session's values, shared with the chat by their plugin and key.
const agents = atom({ plugin: 'agent-tree', key: 'agents' } as const, [] as Agent[])
const now = atom({ plugin: 'agent-tree', key: 'now' } as const, 0)
const opened = atom({ plugin: 'agent-tree', key: 'opened' } as const, false)
const size = atom({ plugin: 'agent-tree', key: 'size' } as const, { columns: 0, rows: 0 } as PaneSize)
const logs = atom({ plugin: 'agent-tree', key: 'logs' } as const, {} as Record<string, Entry[]>)
const chatWith = atom({ plugin: 'agent-tree', key: 'chatWith' } as const, null as string | null)

// $ stays in this file: helpers that use it live beside the hooks that call them.
const openPane = async ($: EngineInterface) => {
  await $.ui.open(paneArgs(await read($, size)))
}

const showStatus = async ($: EngineInterface) => {
  $.ui.status(statusText(await read($, agents)))
}

const addLog = ($: EngineInterface, id: string, kind: Entry['kind'], text: string) =>
  update($, logs, all => withLog(all, id, kind, text))

const openChat = async ($: EngineInterface, agent: Agent) => {
  await update($, chatWith, () => agent.id)
  await $.ui.open({ id: CHAT, title: chatTitle(agent), focus: true })
}

export const register: Register = on => {
  registerChat(on)

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
      await addLog($, agentId, 'tool', doing)
      await showStatus($)
    }

    const ran = await next(e)

    // What came back, for the agent's chat.
    if (agentId !== undefined) {
      if (ran.deny !== undefined) {
        await addLog($, agentId, 'error', `Refused: ${preview(ran.deny)}`)
      } else if (ran.isError === true) {
        await addLog($, agentId, 'error', preview(ran.text ?? 'Failed.'))
      } else if (ran.text) {
        await addLog($, agentId, 'result', preview(ran.text))
      }
    }

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
      await addLog($, agentId, 'end', status === 'done' ? 'Finished.' : doing)
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
        {list.length > 0 && <Text color={MUTED}>Click an agent's name to chat with it.</Text>}
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
                  <Text> </Text>
                  <Button key={`chat-${agent.id}`} plain onPress={() => void openChat($, agent)}>
                    {short(agent.type, side - 1)}
                  </Button>
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
