import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { Agent, Entry } from '../types'

import {
  PANE,
  TITLE,
  COLORS,
  LABELS,
  MUTED,
  ROOT,
  TEXT,
  TICK_MS,
  critter,
  statusText,
  withLog,
  withText,
  woken,
  short,
  wrap,
} from './shared'

// The session's values, shared with the board by their plugin and key.
const agents = atom({ plugin: 'agent-tree', key: 'agents' } as const, [] as Agent[])
const now = atom({ plugin: 'agent-tree', key: 'now' } as const, 0)
const logs = atom({ plugin: 'agent-tree', key: 'logs' } as const, {} as Record<string, Entry[]>)
const chatWith = atom({ plugin: 'agent-tree', key: 'chatWith' } as const, null as string | null)
const draft = atom({ plugin: 'agent-tree', key: 'draft' } as const, '')

// Streamed words reach the chat at most this often.
const FLUSH_MS = 250
// Below this many rows the chat drops the critter and the dividers to keep the field in view.
const ROOMY_ROWS = 16
// Rows around the transcript: header, dividers, the field (up to 3 rows with its frame) and the buttons.
const CHROME_ROWS = { roomy: 3 + 1 + 1 + 3 + 1, tight: 1 + 3 + 1 }

const MARKS: Record<Entry['kind'], { mark: string; color: string; bold?: boolean }> = {
  you: { mark: 'you ›', color: ROOT, bold: true },
  text: { mark: '', color: TEXT },
  tool: { mark: '⏺', color: ROOT },
  result: { mark: '  ⎿', color: MUTED },
  error: { mark: '  ✗', color: COLORS.failed },
  end: { mark: '■', color: COLORS.done },
  note: { mark: '·', color: MUTED },
}

// The transcript as display lines, wrapped to the pane, newest last.
const transcript = (entries: Entry[], width: number) =>
  entries.flatMap(entry => {
    const { mark, color, bold } = MARKS[entry.kind]
    const lead = mark === '' ? '' : `${mark} `
    const body = entry.kind === 'text' ? entry.text.trim() : entry.text
    const paragraphs = body.split('\n').filter(line => line.trim() !== '')
    const rows = paragraphs.flatMap(line => wrap(line.trim(), Math.max(10, width - lead.length), 1000))

    return rows.map((row, i) => ({ text: `${i === 0 ? lead : ' '.repeat(lead.length)}${row}`, color, bold: bold === true }))
  })

// $ stays in this file: helpers that use it live beside the hooks that call them.
const wake = async ($: EngineInterface, id: string, doing: string) => {
  await update($, agents, list => woken(list, id, doing))
  await update($, now, () => Date.now())
  $.ui.status(statusText(await read($, agents)))
}

const addLog = ($: EngineInterface, id: string, kind: Entry['kind'], text: string) =>
  update($, logs, all => withLog(all, id, kind, text))

export const registerChat = (on: On) => {
  // A subagent's words as they stream, copied into its chat; the chunks pass on untouched.
  on('turn.step', async function* ($, e, next) {
    const id = e.agentId
    if (id === undefined) {
      return yield* next(e)
    }

    const known = (await read($, agents)).find(agent => agent.id === id)
    if (known && known.status !== 'running') {
      await wake($, id, 'Thinking')
    }

    let pending = ''
    let isNew = true
    let block = -1
    let flushedAt = Date.now()
    const flush = async () => {
      if (pending === '') {
        return
      }
      const text = pending
      pending = ''
      await update($, logs, all => withText(all, id, text, isNew))
      isNew = false
    }

    for await (const chunk of next(e)) {
      if (chunk.kind === 'text') {
        if (chunk.index !== block) {
          await flush()
          block = chunk.index
          isNew = true
        }
        pending += chunk.text
        if (Date.now() - flushedAt > FLUSH_MS) {
          flushedAt = Date.now()
          await flush()
        }
      }
      yield chunk
    }
    await flush()
  })

  // The chat draws the board's pane while one is open; the board draws it otherwise.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const id = await read($, chatWith)
    if (id === null) {
      return next(e)
    }

    const table = $.ui.resolve(e)
    const { Box, Button, Text } = table
    // Every surface but mobile has a text field.
    const Input = 'Input' in table ? table.Input : undefined
    const agent: Agent | undefined = (await read($, agents)).find(one => one.id === id)
    const width = Math.max(12, e.props.bodyColumns)

    const toBoard = async () => {
      await update($, chatWith, () => null)
      await $.ui.open({ id: PANE, title: TITLE })
    }
    const back = (
      <Box>
        <Button key="board" onPress={() => void toBoard()}>
          ← Board
        </Button>
        <Text> </Text>
        <Button key="close-chat" role="dismiss" onPress={() => void $.ui.close({ id: PANE })}>
          Close
        </Button>
      </Box>
    )

    if (agent === undefined) {
      return (
        <Box flexDirection="column">
          <Text color={MUTED}>That agent is no longer on the board.</Text>
          {back}
        </Box>
      )
    }

    const entries = (await read($, logs))[id] ?? []
    const message = await read($, draft)
    const tick = Math.floor((await read($, now)) / TICK_MS)
    const color = COLORS[agent.status]
    const [head, body, legs] = critter(agent.status, tick)
    const rows = e.props.scroll.bodyRows
    const isRoomy = rows >= ROOMY_ROWS
    const room = Math.max(2, rows - (isRoomy ? CHROME_ROWS.roomy : CHROME_ROWS.tight))
    const lines = transcript(entries, width - 1).slice(-room)
    const rule = <Text color={MUTED}>{'─'.repeat(width)}</Text>

    const send = async (value: string) => {
      const text = value.trim()
      if (text === '') {
        return
      }
      await update($, draft, () => '')
      await addLog($, id, 'you', text)
      const sent = await $.session.send({ to: { agentId: id }, text })
      if (sent.isDelivered) {
        await wake($, id, 'Reading your message')
      } else {
        await addLog($, id, 'note', `Not delivered: ${sent.reason}`)
      }
    }

    return (
      <Box flexDirection="column">
        {isRoomy ? (
          <Box>
            <Box flexDirection="column">
              <Text color={color}>{head}</Text>
              <Text color={color}>{body}</Text>
              <Text color={color}>{legs}</Text>
            </Box>
            <Box flexDirection="column" marginLeft={1}>
              <Text color={TEXT} bold>
                {short(agent.type, width - 12)}
              </Text>
              <Text color={color}>{LABELS[agent.status]}</Text>
              <Text color={MUTED}>{short(agent.doing, width - 12)}</Text>
            </Box>
          </Box>
        ) : (
          <Box>
            <Text color={color}>{'▐▛▜▌ '}</Text>
            <Text color={TEXT} bold>
              {short(agent.type, Math.max(4, width - 20))}
            </Text>
            <Text color={color}>{` ${LABELS[agent.status]}`}</Text>
          </Box>
        )}
        {isRoomy && rule}
        {lines.length === 0 && <Text color={MUTED}>Nothing yet. Its words, steps and results show up here as it works.</Text>}
        {lines.map((line, i) => (
          <Text key={`l-${i}`} color={line.color} bold={line.bold}>
            {line.text}
          </Text>
        ))}
        {isRoomy && rule}
        {Input ? (
          <Input
            key="say"
            placeholder={`Message ${agent.type}…`}
            value={message}
            submitLabel="Send"
            autoFocus
            onInput={(value: string) => void update($, draft, () => value)}
            onSubmit={(value: string) => void send(value)}
          />
        ) : (
          <Text color={MUTED}>Open this chat in the terminal or desktop to send a message.</Text>
        )}
        {back}
      </Box>
    )
  })
}
