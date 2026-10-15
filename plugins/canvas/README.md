# bb Canvas

A bb plugin that adds a **Canvas** page to bb's navigation rail: a zoomable map of your threads, grouped by project, with live status and a chat panel.

## What it shows

- **Project frames.** Each project's threads sit inside a frame with the project name, thread count, and how many need you. Drag a frame's header to move the whole project. The palette button tints the frame; `+` starts a new thread in that project.
- **Thread cards.** Each card shows bb's status glyph, the title, time since the last update, the agent provider, the branch or folder, a worktree tag, the PR with its check state, and background activity (subagents, commands, workflows, goals, plan mode, queued messages). The whole card is tinted by status, as in herdr-map: amber needs you (and pulses), blue working, red error, green finished and unread, gray idle.
- **Links.** Child threads are joined to their parent with an arrow, animated while the child works. Forks and handoffs get a dashed line from their source thread.
- **Chat panel.** Click a card to open the thread's live chat beside the canvas. You can read and reply there without leaving the canvas. Buttons in its header open the thread in place or in a split.
- **Sticky notes.** Double-click empty canvas or use the note button. Type in the note, drag its top bar, resize it when selected, pick a color, or delete it.
- **Zoomed out**, cards show only large titles over their status color, and frames show large project names.

## Controls

| Action | How |
| --- | --- |
| Open chat panel | Click a card |
| Open thread | Double-click a card, or Enter with a card selected |
| Open thread in a split | Cmd/Ctrl + double-click a card |
| bb's thread menu (archive, pin, rename, …) | Right-click a card |
| Filter | Type in the filter box (`/` focuses it; Enter jumps to the first match) |
| Dim a status | Click its chip; Option-click to show only that status |
| Next thread that needs you | `n`, or the Needs you list at the top right |
| Fit everything | `f` or the fit button |
| Close the chat panel | `Esc` |
| Show archived threads | Archive button |
| Undo / redo a layout change | Undo and Redo buttons, `⌘Z` / `⇧⌘Z` (`Ctrl+Z` / `Ctrl+Y` elsewhere) |
| Rearrange automatically | Grid button |

## Layout

The first time it opens, the canvas arranges every project as a tree: a thread's first child sits to its right, and later children stack below. New threads are placed next to their parent or fork source, or under the rest of their project. After that, positions are yours: card, frame, and note positions, note text, and frame colors are saved by the plugin on the bb server and shared by every window. The zoom and pan position is saved per browser.

Undo covers moves of cards, frames, and notes; rearranging; adding, editing, recoloring, and deleting notes; and frame colors. The last 50 steps are kept for each open window until it reloads.

## Development

```sh
npm install --include=dev
npm test            # layout and status unit tests
npm run typecheck
bb plugin install . # first time
bb plugin dev       # rebuild and reload on save
```

`server.ts` stores the arrangement in the plugin's key-value storage and exposes it over RPC. The page itself (`canvas/`) reads threads from bb's live thread list, so it updates as threads change without polling.
