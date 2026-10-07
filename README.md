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

A live board of every subagent your session spawns, in a side pane. Each agent is a little Claude critter in its own card, with one plain sentence on what it is doing.

```
Agents  2 working · 1 finished
╭───────────────────────────╮ ╭───────────────────────────╮ ╭───────────────────────────╮
│  ▐▛███▜▌  Explore         │ │  ▐▛███▜▌  general-purpose │ │  ▐▛███▜▌  Explore         │
│ ▝▜█████▛▘ working         │ │ ▝▜█████▛▘ working         │ │ ▝▜█████▛▘ done            │
│   ▘▘ ▝▝                   │ │   ▝▘ ▘▝                   │ │   ▘▘ ▝▝                   │
│ Reading register.tsx      │ │ Searching the web for     │ │ Done: The auth code lives │
│                           │ │ "jev api"                 │ │ in src/auth.              │
╰───────────────────────────╯ ╰───────────────────────────╯ ╰───────────────────────────╯
```

- **Orange and walking** while it works (it blinks too), **green** when done, **red** if it failed, **yellow** if stopped.
- **One sentence** in plain words: *Reading auth.ts*, *Searching the web for "jev api"*, then *Done:* and the first sentence of its answer.
- Opens by itself the first time an agent starts (on a wide terminal), or type `/agent-tree`. Cards fill the pane's width, parents before their children.
- **Chat with any agent**: click its name to open a chat pane with everything it is doing, live: its words as it writes them, each step (`⏺ Reading auth.ts`) and what came back (`⎿ …`). Type in the field at the bottom to send it a message, even after it finished; it picks the work back up.
- **Resize it**: drag the pane's edge, or press **◂ Narrower / Wider ▸** (docked beside the transcript) or **▴ Shorter / Taller ▾** (above the prompt). The cards reflow to fit.
- **Clear finished** tidies the board. The status line counts working agents.

### Install

```
/plugin install agent-tree --marketplace Teodagher/teo-mods
```

## License

MIT
