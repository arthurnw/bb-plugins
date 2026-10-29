# bb Inbox

A [bb](https://getbb.app) plugin that adds an **Inbox** page to bb's navigation rail: every agent thread in one list, with live status, filter tabs, and rows that unfold to the latest steps with the action each thread needs. Modeled on affectUI's Agent Inbox.

## Install

```sh
bb plugin install /path/to/bb-inbox
```

Then open **Inbox** in bb's navigation rail. Its entry shows how many threads need you.

## What it shows

- **Board and List.** Threads sit in three groups: **Needs you** (waiting on an approval or answer, or failed), **Running**, and **Done** (finished and idle). Board shows them as columns; List stacks them as sections. The choice is remembered. Done shows the 12 most recent, with a button for the rest.
- **Cards.** Each card shows the title, one line on what's happening (the request waiting on you, the latest step of a running agent, the error, or the agent's last message), a status line (waiting, failed, a live clock, or how long ago it finished), and counts of files read and searches run, and of tool calls. Counts roll when they change, and a card glides to its new place when its thread changes state.
- **Unfolded cards.** Click a card (or press Enter) to see the provider, project, and branch, the request waiting on you, the latest steps with their times, and the actions.
- **Actions.** Needs you: **Approve** and **Reject** for approvals, the options themselves for a single one-choice question, or **Answer** to open the thread. Failed: **Retry**. Running: **Stop**. Unread: **Mark read**. Every card: **Open** (Shift-click opens it in a split). After an answer, the selection moves to the next card that needs you.

## Keyboard

| Key | Action |
| --- | --- |
| `j` / `k` | Move the selection |
| `h` / `l` | Move to the previous or next column (section in List), keeping the position |
| `Enter` | Unfold or fold the selected card |
| `o` | Open the thread (`⇧O` in a split) |
| `a` / `x` | Approve / reject |
| `1`–`9` | Pick an answer to a question |
| `r` | Retry |
| `s` | Stop |
| `e` | Mark read |
| `v` | Switch between Board and List |
| `?` | Show the shortcuts |

Keys work while the inbox was the last thing you clicked, including after a button takes focus away.

## How it works

The list comes from bb's live thread list (`experimental_useSidebarThreads`), so it updates as threads change. Steps and timing come from each thread's timeline, loaded when a row unfolds, and once per run for a running thread's clock. Actions call bb's SDK directly (`threads.interactions.resolve`, `threads.retry`, `threads.stop`, `threads.markRead`). The plugin stores nothing.

## Develop

```sh
npm install
npm test          # status, step, and interaction logic
npm run typecheck
bb plugin build && bb plugin reload inbox
```
