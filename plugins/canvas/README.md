# bb Canvas

A [bb](https://getbb.app) plugin that adds a **Canvas** page to bb's navigation rail: a zoomable map of your threads, framed by project, section, or machine, with live status, chats you can pin to the canvas, a triage queue for threads that need you, and keyboard navigation throughout.

## Install

```sh
bb plugin install https://github.com/arthurnw/bb-canvas
```

Then open **Canvas** in bb's navigation rail. bb builds the plugin when it installs it. `bb plugin update canvas` pulls new commits.

## What it shows

- **Frames.** Threads sit inside frames, grouped by **project**, by bb **section**, or by **machine** (the Group by switch, or `1` `2` `3`). Each frame shows its name, thread count, and how many need you. Drag a frame's header to move it with its threads. The palette button tints it, and `+` starts a new thread in that project, section, or machine.
- **Sections** are bb's own thread sections, the same ones the sidebar shows, so one section can hold threads from several repos. In the section grouping you can create a section from the toolbar, rename one (pencil, or double-click its name), delete one (trash, click twice; its threads move to No section), and file a thread by dragging its card onto another section or pressing `m`.
- **Thread cards.** Each card shows bb's status glyph, the title, time since the last update, the agent provider, the branch or folder, a worktree tag, the PR with its check state, and background activity (subagents, commands, workflows, goals, plan mode, queued messages). The whole card is tinted by status, as in herdr-map: amber needs you (and pulses), blue working, red error, green finished and unread, gray idle.
- **Links.** Child threads are joined to their parent with an arrow, animated while the child works. Forks and handoffs get a dashed line from their source thread.
- **Chat panel.** Click a card (or press Space) to open the thread's live chat beside the canvas. Opening it leaves the keyboard on the canvas; press `r` to reply, and Shift+Esc to come back to the canvas.
- **Pinned chats.** Press `p`, Option-click a card, or use the pin button on a card (shown on hover, and always on pinned cards) or in the chat panel to pin a thread's chat to the canvas beside its card. Option-click and the card button don't open the chat panel. It lives in canvas coordinates: it stays where you leave it, pans and zooms with the cards, and sits above them. A dashed line joins it to its card, from the middle of the side facing the chat to the middle of the chat's side facing the card. Drag it by its header (it moves on its own; the link button in its header makes it move with its card, keeping their offset), resize it from its edges (only an outline follows the pointer; the chat takes the new size on release), minimize it to its header, and `Tab` between pinned chats. Its text stays a normal size at any zoom, and far out it shows only its title. Pinned chats are saved per grouping on the bb server, like notes, and undo covers them. The most you can pin per grouping is set by **Pinned chat windows** in the plugin's settings (default 4, up to 12; `bb plugin config canvas set maxPinnedWindows 6`).
- **Triage.** Press `t` (or the checklist button, or Triage in the Needs you list) to go through the threads that need you one at a time, in a window over the dimmed canvas. The canvas behind pans to each one. When the current thread is answered, triage moves to the next; when none are left, it closes. The queue is fixed when triage starts, and its dots show which are done.
- **Sticky notes.** Double-click empty canvas or use the note button. Type in the note, drag its top bar, resize it when selected, pick a color, or delete it.
- **Archiving.** bb's own **Archive thread** shortcut works on the canvas and archives the selected thread, including from inside its chat. Cards (on hover), the chat panel, and pinned chats also have an archive button. All of them use bb's archive action, so threads with children ask first and you get bb's Undo.
- **Thread sidebar.** bb's thread sidebar collapses while the canvas is open and expands again when you leave, unless you reopened it yourself in the meantime. Turn this off with **Collapse the thread sidebar on the canvas** in the plugin's settings (`bb plugin config canvas set collapseSidebar false`).
- **Zoomed out**, cards show only large titles over their status color, and frames show large names.

## On a phone

On screens narrower than 768px the toolbar and the Needs you list give way to a **Go to** button and, when threads need you, a triage button. Pinned chats, the minimap, and pin buttons are hidden (pins stay saved for larger screens). Tapping a card opens its chat in a drawer from the right; swipe it right, or tap the strip of canvas beside it, to close it.

## Keyboard

| Keys | Action |
| --- | --- |
| `⌘K` or `g` | Go to a thread: pick it and the canvas jumps to its card |
| `h` `j` `k` `l` (or arrows) | Move to the nearest thread in that direction within the frame |
| `H` `J` `K` `L` (Shift) | Move to the nearest frame in that direction |
| Space | Show or hide the chat panel for the selected thread (goes to its chat if pinned) |
| `p` / Option-click | Pin or unpin the selected (or clicked) thread's chat to the canvas |
| `Tab` / Shift+Tab | Go to the next / previous pinned chat |
| `-` | Minimize or restore the selected thread's pinned chat |
| `t` | Triage: in it, `n` / `N` next / previous, `r` reply, `o` open, Esc leave |
| `r` | Reply: focus the reply box in the chat panel, pinned chat, or triage |
| Shift+Esc | Leave a reply box for the canvas |
| Enter / Shift+Enter | Open the thread / open it in a split |
| `n` / `N` | Next / previous thread that needs you |
| `m` | Move the selected thread to a section (or a new one) |
| `a` | Rearrange the selected thread's frame |
| `1` `2` `3` | Group by project, section, machine |
| `c` / `f` | Center the selection / fit everything |
| `/` | Filter (dims threads that don't match) |
| `⌘Z` / `⇧⌘Z` | Undo / redo a layout change (`Ctrl+Z` / `Ctrl+Y` elsewhere) |
| Esc | Close the chat panel, then clear the selection |
| bb's **Archive thread** shortcut | Archive the selected thread (also from its chat panel, pinned chat, or triage) |
| `?` | Show or hide the shortcuts (Esc also closes them) |

`⌘K` opens the canvas picker instead of bb's while you're on the canvas, except inside the chat panel. With the mouse: double-click a card to open the thread (Cmd/Ctrl for a split), right-click for bb's thread menu, and Option-click a status chip to show only that status.

## Layout

**Rearranging.** The grid button in the toolbar rearranges every frame; the grid button in a frame's header, or `a`, rearranges just that frame, starting from its current top-left corner so it stays in place while its gaps close. A frame that grows can end up overlapping a neighbor; move it, or rearrange everything. Both use the layout set in the plugin's settings:

| `arrangeStyle` | Layout |
| --- | --- |
| `tree` (default) | A thread's first child to its right, later children stacked below |
| `column` | One column |
| `row` | One row |
| `gridColumns` | A grid filling left to right, wrapping after `arrangeGridSize` columns |
| `gridRows` | A grid filling top to bottom, wrapping after `arrangeGridSize` rows |

`arrangeGridSize` defaults to 3. The flat layouts keep the tree's order, so child threads follow their parents. Change them in bb's plugin settings or with `bb plugin config canvas set arrangeStyle gridColumns` and `bb plugin config canvas set arrangeGridSize 4`.


Each grouping keeps its own arrangement of cards and notes, so switching groupings never moves anything in another. The first time a grouping opens, the canvas arranges it as a tree per frame: a thread's first child sits to its right, and later children stack below. New threads are placed next to their parent or fork source when it's in the same frame, or under the rest of their frame. Positions, notes, and frame colors are saved by the plugin on the bb server and shared by every window. The zoom and pan position and the grouping are saved per browser.

Undo covers moves of cards, frames, notes, and pinned chats; pinning and unpinning; rearranging; adding, editing, recoloring, and deleting notes; and frame colors. Section changes (create, rename, delete, filing a thread) go to bb and aren't undone by it. The last 50 steps are kept for each open window until it reloads.

## Development

```sh
npm install --include=dev
npm test            # layout, navigation, and status unit tests
npm run typecheck
bb plugin install . # first time
bb plugin dev       # rebuild and reload on save
```

`server.ts` stores the arrangement in the plugin's key-value storage and exposes it over RPC. The page itself (`canvas/`) reads threads from bb's live thread list, so it updates as threads change without polling.

## License

MIT
