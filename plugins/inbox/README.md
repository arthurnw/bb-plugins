# bb Inbox

A [bb](https://getbb.app) plugin that adds an **Inbox** page to bb's navigation rail: every agent thread in one list, with live status, filter tabs, and rows that unfold to the latest steps with the action each thread needs. Modeled on affectUI's Agent Inbox.

## Install

```sh
bb plugin install /path/to/bb-inbox
```

Then open **Inbox** in bb's navigation rail. Its entry shows how many threads need you.

## What it shows

- **Rows.** One row per thread in bb's own list (archived and hidden threads are left out), with a status dot, the title, the agent provider, project, and branch, a status tag, and a time. Running threads show a live clock for the current turn; the rest show how long since they last needed attention. Child threads name their parent.
- **Order.** Threads that need you come first, then failed, running, done, and idle, newest first within each. When a thread changes state, its row glides to its new place.
- **Filter tabs.** All, Needs you, Running, Failed, and Done (finished and idle). The counts roll when they change. The project menu narrows the list to one project.
- **Unfolded rows.** Click a row (or press Enter) to see the agent's last message or the error, the last few steps of the latest turn, its tool call count, and how long it ran.
- **Actions.** Needs you: **Approve** and **Reject** for approvals, the options themselves for a single one-choice question, or **Answer** to open the thread. Failed: **Retry**. Running: **Stop**. Unread: **Mark read**. Every row: **Open** (Shift-click opens it in a split).

## Keyboard

| Key | Action |
| --- | --- |
| `j` / `k` | Move the selection |
| `Enter` | Unfold or fold the selected row |
| `o` | Open the thread (`⇧O` in a split) |
| `a` / `x` | Approve / reject |
| `1`–`9` | Pick an option, when the selected row is unfolded on a question |
| `r` | Retry |
| `s` | Stop |
| `e` | Mark read |
| `1`–`5` | Switch filter tabs |
| `?` | Show the shortcuts |

## How it works

The list comes from bb's live thread list (`experimental_useSidebarThreads`), so it updates as threads change. Steps and timing come from each thread's timeline, loaded when a row unfolds, and once per run for a running thread's clock. Actions call bb's SDK directly (`threads.interactions.resolve`, `threads.retry`, `threads.stop`, `threads.markRead`). The plugin stores nothing.

## Develop

```sh
npm install
npm test          # status, step, and interaction logic
npm run typecheck
bb plugin build && bb plugin reload inbox
```
