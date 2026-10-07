export type TaskStatus = 'pending' | 'in_progress' | 'completed'
export type Task = { id: string; title: string; active: string; status: TaskStatus }
// What the agent is doing this turn, for when it keeps no task list.
export type Turn = { steps: number; current: string; history: string[] }

declare module 'claude-code' {
  interface PluginState {
    'task-progress': { tasks: Task[]; turn: Turn | null; expanded: boolean }
  }
}
