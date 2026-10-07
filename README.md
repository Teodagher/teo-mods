# teo-mods

Mods for [Claude Code](https://claude.com/claude-code).

## task-progress

A progress band above the prompt, so you can see what the agent is doing while it works.

```
▸ Reading the threads   next: Keep the money posts                 1/4 tasks
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  25%
```

- **Current task** on the left, the next one beside it, the task count on the right.
- **Full-width bar** in a violet-to-cyan gradient, with the percentage at its end. It turns green when everything is done.
- **Click the task line** to see every task (✓ done, ▶ running, ○ to do). Click again to fold it.
- **A `plan` tool**: the mod gives the agent a tool to send its task list, so the band works even where the agent has no built-in todo tool. It also follows `TodoWrite`, `TaskCreate` and `TaskUpdate`.
- **No task list?** It follows the turn instead: the step running now, a bar that moves along with each tool call, and the step count. Clicking shows the steps so far.

It hides itself when the agent is idle.

### Install

In a Claude Code terminal session:

```
/plugin install task-progress --marketplace Teodagher/teo-mods
```

Answer `y` to add the marketplace, then press Enter for the user scope.

### Develop

```
claude --plugin-dir ./task-progress   # run it from this folder
claude plugin validate ./task-progress
claude plugin test ./task-progress
```

## License

MIT
