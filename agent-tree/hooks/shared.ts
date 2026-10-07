
import type { Agent, AgentStatus, Entry, PaneSize } from '../types'


export const PANE = 'agent-tree'
export const TITLE = 'Agents'
export const CHAT = 'agent-chat'
// The most transcript entries kept per agent.
export const LOG_LIMIT = 300
export const TICK_MS = 300
// Past this long with no news, a working agent stops moving the clock.
export const QUIET_MS = 10 * 60 * 1000
// Cards are at least this wide, borders included; the pane fits as many as it can.
export const MIN_CARD = 28
// One press of − or + : a card's width when docked, a card's height inline.
export const STEP_COLUMNS = MIN_CARD + 1
export const STEP_ROWS = 7
export const LIMITS = { columns: [MIN_CARD + 2, 240], rows: [9, 80] } as const

export const clamp = (n: number, [low, high]: readonly [number, number]) => Math.min(high, Math.max(low, n))


export const COLORS: Record<AgentStatus, string> = {
  running: '#d97757',
  done: '#22c55e',
  failed: '#f7768e',
  stopped: '#e0af68',
}
export const LABELS: Record<AgentStatus, string> = { running: 'working', done: 'done', failed: 'failed', stopped: 'stopped' }
export const ROOT = '#d97757'
export const TEXT = '#c0caf5'
export const MUTED = '#565f89'

// The little Claude critter, three rows tall. A working one walks and blinks.
export const HEAD = ' ▐▛███▜▌ '
export const BLINK = ' ▐█████▌ '
export const BODY = '▝▜█████▛▘'
export const LEGS = ['  ▘▘ ▝▝  ', '  ▝▘ ▘▝  ']
export const STILL = '  ▘▘ ▝▝  '

export const critter = (status: AgentStatus, tick: number) =>
  status === 'running'
    ? [tick % 12 === 0 ? BLINK : HEAD, BODY, LEGS[tick % LEGS.length] ?? STILL]
    : [HEAD, BODY, STILL]

export const short = (text: string, max: number) =>
  max <= 1 ? '' : text.length > max ? `${text.slice(0, max - 1)}…` : text

export const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()

export const base = (path: string) => path.split('/').filter(Boolean).at(-1) ?? path

export const host = (url: string) => /^[a-z]+:\/\/([^/]+)/i.exec(url)?.[1] ?? url

// One plain sentence for what a tool call is doing.
export const sentence = (e: { tool: string }) => {
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

export const firstSentence = (text: string) => {
  const flat = oneLine(text.replace(/[#*`>_]/g, ''))

  return (/^.+?[.!?](\s|$)/.exec(flat)?.[0] ?? flat).trim()
}

// Words into at most `lines` lines of `width`, the last one cut with an ellipsis.
export const wrap = (text: string, width: number, lines: number) => {
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

export const patch = (list: Agent[], id: string, change: (agent: Agent) => Agent) =>
  list.map(agent => (agent.id === id ? change(agent) : agent))

// Parents before their children, so a team reads left to right.
export const ordered = (list: Agent[]) => {
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




// The first lines of a tool's result, enough to see what came back.
export const preview = (text: string) => {
  const lines = text.split('\n').map(line => line.trimEnd()).filter(line => line.trim() !== '')
  const shown = lines.slice(0, 2).join(' · ')

  return lines.length > 2 ? `${short(shown, 200)} (+${lines.length - 2} lines)` : short(shown, 200)
}



// What to ask the engine for when opening the board: the size last chosen, if any.
export const paneArgs = ({ columns, rows }: PaneSize) => ({
  id: PANE,
  title: TITLE,
  ...(columns > 0 ? { columns } : {}),
  ...(rows > 0 ? { rows } : {}),
})

// The status line: how many agents work, or nothing when none do.
export const statusText = (list: Agent[]) => {
  const running = list.filter(agent => agent.status === 'running').length

  return running === 0 ? undefined : `▐▛▜▌ ${running} agent${running === 1 ? '' : 's'} working`
}

// One more entry in an agent's transcript, the oldest dropped past the limit.
export const withLog = (all: Record<string, Entry[]>, id: string, kind: Entry['kind'], text: string) => ({
  ...all,
  [id]: [...(all[id] ?? []), { kind, text, at: Date.now() }].slice(-LOG_LIMIT),
})

// Streamed words join the agent's last paragraph unless a new one starts.
export const withText = (all: Record<string, Entry[]>, id: string, text: string, isNew: boolean) => {
  const list = all[id] ?? []
  const last = list.at(-1)
  const next =
    !isNew && last?.kind === 'text'
      ? [...list.slice(0, -1), { ...last, text: last.text + text }]
      : [...list, { kind: 'text' as const, text, at: Date.now() }]

  return { ...all, [id]: next.slice(-LOG_LIMIT) }
}

// Marks an agent working again, for one that reads a message after it had finished.
export const woken = (list: Agent[], id: string, doing: string) =>
  patch(list, id, agent => ({ ...agent, status: 'running' as const, lastAt: Date.now(), doing }))

export const chatTitle = (agent: Agent) => `Chat · ${agent.type}`
