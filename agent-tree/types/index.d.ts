export type AgentStatus = 'running' | 'done' | 'failed' | 'stopped'

export type Agent = {
  id: string
  parentId: string | null
  type: string
  description: string
  model: string
  status: AgentStatus
  startedAt: number
  endedAt: number | null
  lastAt: number
  tools: number
  current: string
  steps: string[]
  answer: string
  tokens: number
}

declare module 'claude-code' {
  interface PluginState {
    'agent-tree': { agents: Agent[]; expanded: string[]; now: number; opened: boolean }
  }
}
