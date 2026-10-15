# bb Canvas

A bb plugin that adds a **Canvas** page to bb's navigation rail: a zoomable map of your threads, grouped by project, with live status and a chat panel.

## What it shows

- **Frames.** Threads sit inside frames, grouped by **project**, by bb **section**, or by **machine** (the Group by switch, or `1` `2` `3`). Each frame shows its name, thread count, and how many need you. Drag a frame's header to move it with its threads. The palette button tints it, and `+` starts a new thread in that project, section, or machine.
- **Sections** are bb's own thread sections, the same ones the sidebar shows, so one section can hold threads from several repos. In the section grouping you can create a section from the toolbar, rename one (pencil, or double-click its name), delete one (trash, click twice; its threads move to No section), and file a thread by dragging its card onto another section or pressing `m`.
- **Thread cards.** Each card shows bb's status glyph, the title, time since the last update, the agent provider, the branch or folder, a worktree tag, the PR with its check state, and background activity (subagents, commands, workflows, goals, plan mode, queued messages). The whole card is tinted by status, as in herdr-map: amber needs you (and pulses), blue working, red error, green finished and unread, gray idle.
- **Links.** Child threads are joined to their parent with an arrow, animated while the child works. Forks and handoffs get a dashed line from their source thread.
- **Chat panel.** Click a card (or press Space) to open the thread's live chat beside the canvas. Opening it leaves the keyboard on the canvas; press `r` to reply, and Shift+Esc to come back to the canvas.
- **Pinned windows.** Press `p` (or the pin button in the chat panel) to pin a thread's chat as a floating window. It stays open as you move around, with a dashed line back to its card. Drag a window by its header, resize it from the corner, minimize it to a pill along the bottom edge, and `Tab` through open windows. The most you can pin is set by **Pinned chat windows** in the plugin's settings (default 4, up to 12; `bb plugin config canvas maxPinnedWindows 6`). Windows are remembered per browser.
- **Triage.** Press `t` (or the checklist button, or Triage in the Needs you list) to go through the threads that need you one at a time, in a window over the dimmed canvas. The canvas behind pans to each one. When the current thread is answered, triage moves to the next; when none are left, it closes. The queue is fixed when triage starts, and its dots show which are done.
- **Sticky notes.** Double-click empty canvas or use the note button. Type in the note, drag its top bar, resize it when selected, pick a color, or delete it.
- **Zoomed out**, cards show only large titles over their status color, and frames show large names.

## Keyboard

| Keys | Action |
| --- | --- |
| `⌘K` or `g` | Go to a thread: pick it and the canvas jumps to its card |
| `h` `j` `k` `l` (or arrows) | Move to the nearest thread in that direction within the frame |
| `H` `J` `K` `L` (Shift) | Move to the nearest frame in that direction |
| Space | Show or hide the chat panel for the selected thread (raises its window if pinned) |
| `p` | Pin or unpin the selected thread's chat as a floating window |
| `Tab` / Shift+Tab | Cycle through pinned windows |
| `-` | Minimize or restore the selected thread's window |
| `t` | Triage: in it, `n` / `N` next / previous, `r` reply, `o` open, Esc leave |
| `r` | Reply: focus the reply box in the chat panel, pinned window, or triage |
| Shift+Esc | Leave a reply box for the canvas |
| Enter / Shift+Enter | Open the thread / open it in a split |
| `n` / `N` | Next / previous thread that needs you |
| `m` | Move the selected thread to a section (or a new one) |
| `1` `2` `3` | Group by project, section, machine |
| `c` / `f` | Center the selection / fit everything |
| `/` | Filter (dims threads that don't match) |
| `⌘Z` / `⇧⌘Z` | Undo / redo a layout change (`Ctrl+Z` / `Ctrl+Y` elsewhere) |
| Esc | Close the chat panel, then clear the selection |
| `?` | Show the shortcuts |

`⌘K` opens the canvas picker instead of bb's while you're on the canvas, except inside the chat panel. With the mouse: double-click a card to open the thread (Cmd/Ctrl for a split), right-click for bb's thread menu, and Option-click a status chip to show only that status.

## Layout

Each grouping keeps its own arrangement of cards and notes, so switching groupings never moves anything in another. The first time a grouping opens, the canvas arranges it as a tree per frame: a thread's first child sits to its right, and later children stack below. New threads are placed next to their parent or fork source when it's in the same frame, or under the rest of their frame. Positions, notes, and frame colors are saved by the plugin on the bb server and shared by every window. The zoom and pan position and the grouping are saved per browser.

Undo covers moves of cards, frames, and notes; rearranging; adding, editing, recoloring, and deleting notes; and frame colors. Section changes (create, rename, delete, filing a thread) go to bb and aren't undone by it. The last 50 steps are kept for each open window until it reloads.

## Development

```sh
npm install --include=dev
npm test            # layout, navigation, and status unit tests
npm run typecheck
bb plugin install . # first time
bb plugin dev       # rebuild and reload on save
```

`server.ts` stores the arrangement in the plugin's key-value storage and exposes it over RPC. The page itself (`canvas/`) reads threads from bb's live thread list, so it updates as threads change without polling.
