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

declare module 'claude-code' {
  interface PluginState {
    'agent-tree': { agents: Agent[]; now: number; opened: boolean }
  }
}
