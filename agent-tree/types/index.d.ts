export type AgentStatus = 'running' | 'done' | 'failed' | 'stopped'

export type Agent = {
  id: string
  parentId: string | null
  type: string
  status: AgentStatus
  lastAt: number
  // One plain sentence: what it is doing now, or how it ended.
  doing: string
}

// The pane size asked for with the − / + buttons; 0 leaves it to the engine.
export type PaneSize = { columns: number; rows: number }

// One line of an agent's chat: your message, its words, a step, a result, an error, or how it ended.
export type Entry = { kind: 'you' | 'text' | 'tool' | 'result' | 'error' | 'end' | 'note'; text: string; at: number }

declare module 'claude-code' {
  interface PluginState {
    'agent-tree': {
      agents: Agent[]
      now: number
      opened: boolean
      size: PaneSize
      logs: Record<string, Entry[]>
      chatWith: string | null
      draft: string
    }
  }
}
