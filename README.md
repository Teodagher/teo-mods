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
claude --plugin-dir ./task-progress   # run a mod from its folder
claude plugin validate ./task-progress
claude plugin test ./task-progress
```

## agent-tree

A live tree of every subagent your session spawns, in a side pane.

```
◆ main session  2 running · 1 done
├─ ◐ Explore  Review task-progress mod code          0:18 · 2 tools
│     ↳ Read: /home/me/mods/task-progress/hooks/register.tsx
├─ ✓ general-purpose  Research Jev API usage    0:40 · 8 tools · 36k tok
└─ ◓ Explore  Review agent-tree mod code             0:12 · 1 tool
      ↳ Read: hooks/register.tsx
```

- **Opens by itself** the first time an agent starts (on a wide terminal), or type `/agent-tree`.
- **Nested agents** sit under the agent that spawned them.
- Each agent has a **live spinner**, elapsed time, tool count and tokens, and shows `↳` what it is doing right now.
- **Click an agent** to see its model, recent steps and the start of its answer.
- ✓ done, ✗ failed, ■ stopped. **Clear finished** tidies the list.
- The status line counts running agents: `⑂ 2 agents running`.
- Resumed agents (SendMessage) restart their clock, and agents spawned before the mod loaded appear on their first step.

### Install

```
/plugin install agent-tree --marketplace Teodagher/teo-mods
```

## License

MIT
