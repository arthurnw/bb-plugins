# Bots

A bot is one initiative: you talk to its coordinator thread, and the
coordinator plans, decides, and starts one visible worker thread per piece of
code work. Bots works alone and also with the [Launcher](../launcher) plugin.
Saved ways to start a single thread (the persona bots Bots used to have) are
the Launcher's [Starters](../launcher/README.md#starters).

Manage bots in Settings → Bots.

## Initiative bots

- **New bot**: the command palette entry **Bots: new bot**, or **+** beside the
  thread list's view toggle. The composer text is the brief, and its project
  and model pickers set the bot's project and coordinator model (Mod+Shift+M).
  Beside the project picker, **Workers** sets the worker model (Alt+M;
  **Same as coordinator** by default, resolved when the bot is created), then
  the avatar: click it to pick one, or the circular arrow for a random one no active bot
  uses. The coordinator
  always runs in the bot workspace, so the environment and branch pickers are
  hidden. Enter creates the bot, starts the coordinator with the brief, and
  opens it. **Name** is optional: left empty, the bot starts with a
  placeholder from the brief's first words, and the coordinator renames it on
  its first turn (`bb bots rename`). Rename it any time in Settings → Bots.
- **Promote to bot** (thread menu): the same dialog with a mention of the
  thread in the brief. The thread moves under the coordinator as its first
  worker and keeps its branch and worktree.
- **Coordinator**: the bot's root thread. It runs in the bot workspace
  (`<bb data>/plugins/bots/workspaces/<name>-<id prefix>/`, outside git, kept when the
  thread is archived) and gets the `bot-coordinator` skill, which covers
  delegation, review, and the `tracker.md` and `log.md` state files. It never
  edits code. Right-click the bot's header in the Threads view for the
  coordinator thread's menu. Deleting the coordinator thread deletes the bot;
  its workspace files stay. The coordinator's title is the bot's name:
  renaming either renames the other.
- **Workers**: every other thread of the bot, normally children of the
  coordinator (`bb thread spawn --parent-self`). They get short worker
  instructions: one worktree, one PR, report to the parent.
- **Thread list** (Threads view): a bot's header opens its coordinator, and
  its chevron collapses the workers. Workers marked done collapse into a
  "done" row. Archiving the coordinator retires the bot: bb archives its
  workers too, and the bot leaves the list. Initiative bots are not offered in
  new-thread bot pickers.

### `bb bots`

- `bb bots role [threadId]`: JSON with the thread's role (`coordinator`,
  `worker`, or `none`), its bot, and the bot workspace.
- `bb bots done <threadId> [--undo]`: mark a worker finished.
- `bb bots rename "<name>" [--thread <id>]`: rename the bot a coordinator
  thread runs (defaults to the calling thread).
- `bb bots list`: initiative bots with their coordinator and workspace.
- `bb bots hook`: the `~/.claude/settings.json` entry for the Claude Code guard.

### Claude Code guard

The plugin writes `<bb data>/plugins/bots/hooks/coordinator-guard.mjs` when it
loads. Add the entry `bb bots hook` prints to the `hooks` of
`~/.claude/settings.json`: a `PreToolUse` hook for Edit, Write, and
NotebookEdit that runs only in bb threads (`BB_THREAD_ID`). In a coordinator it
denies writes outside the bot workspace and the temp directories; in any other
thread, or when `bb bots role` fails, it allows them. `onFailure: "block"`
blocks the edit when the hook itself cannot run. Writes through the shell are
covered by the coordinator's instructions only.

### Pi and Codex

- **Pi**: the `bb-bridge` extension in `~/.pi/agent/extensions` makes the same
  check in its `tool_call` handler for `write` and `edit`, using `bb bots role`.
- **Codex**: bb's `workspace-write` sandbox keeps every write, shell included,
  in the bot workspace and the temp directories, but only in Accept edits mode.
  A Codex coordinator starts in Accept edits, and the plugin refuses a
  coordinator turn sent in Auto (Codex's reviewer can approve escalations) or
  Full (no sandbox). In Accept edits, a user can still approve a write outside
  the workspace when Codex asks.

- **Thread list**: Bots | Threads | All views, Pinned, and Recent, with bots and
  custom sections in one order you arrange. Drag a thread onto a bot to make it
  one of its workers. **All** is bb's regular list with bot avatars: it shares
  the built-in list's settings, and a bot thread's avatar replaces its provider
  icon.
- **Info tab**: a thread of a bot shows the bot and its role (coordinator or
  worker), and a worker the instructions Bots adds.
- **Without the Launcher**: the New bot dialog's model pickers use bb's own
  picker with no presets.
- **Avatar in thread panes**: a thread with a bot shows the bot's avatar at
  96 px in a corner of its pane, with the thread's own state. The corner is set
  in the bot's settings.
- **Bot zoo**: every bot's avatar in a draggable card, or in a strip along the
  bottom of the open right panel. Off by default; turn it on in Settings → Bots.

A thread belongs to a bot when it is the bot's coordinator, or a descendant of
it (a worker), or a thread promoted to the bot. Bots do not appear in the `@`
menu.

Other plugins read bots over RPC (`listBots`, `threadBots`, `getBot`) and
listen for the `bb-bots:changed` window event.

## Details

### Persona bots

Bots used to keep persona bots: saved launch configurations with their own
instructions, picked with a pill in a new thread's first message. They are now
the Launcher's Starters. The Launcher imports each persona bot as a Starter
once (`listPersonaBots` RPC); the rows stay in Bots, unused. Threads that ran
as persona bots keep their history and show as plain threads; they get no
persona instructions when their session next starts.

### Avatars

Pick one of 16 animated avatars (Smooth or Geometric), or upload an image (PNG,
JPEG, WebP, GIF, or SVG), which is cropped to a square and stored as a 128 px
WebP (animations below). A pick is stored as `gallery:<id>` and drawn as inline SVG without a
circle crop. New bots get a random animated avatar no other bot uses, while one
is left. Without an avatar the emoji shows, then the first letter.

Animated avatars show what a bot is doing: idle (breathes and blinks),
working (a steady fast loop), unread (a gesture every 3 seconds), and waiting
for an approval or answer (a slow head tilt and a question bubble). A thread row
shows its own thread's state; bot headers, tiles, and
menu icons show the bot's combined state over all its threads, waiting first,
then unread, then working. Eyes follow the pointer in bot settings and on the
bot headers in the thread list. With reduced motion nothing moves; unread shows
a red badge and waiting a still question bubble.

An animated GIF, WebP, or PNG (APNG) upload of up to 1 MB is kept as uploaded,
and its first frame is stored as the 128 px still; larger animations are
refused with the size in the error. The still shows when the bot is idle; the
animation plays while it is working, unread, or waiting, cropped to a circle at
display time, and a waiting bot also shows the question bubble. With reduced
motion the still stays, with the same badge and bubble as the animated avatars.
The animated bytes live in their own table and are left out of `listBots`; the
Bots app fetches them with `getBotAvatarAnimation` the first time a bot
animates. Other plugins (the Launcher, Canvas) show the still.

#### In thread panes

Each thread pane that shows a thread with a bot (its own or inherited) draws
the bot's avatar at 96 px in the corner set by the bot's **Avatar in thread
panes** field in Settings → Bots: Top right (the default, also for bots saved
before the field existed), Top left, Bottom right, Bottom left, or Off. The
avatar shows the thread's own state, with a running turn ahead of unread
because the pane is showing the thread. Its eyes follow the pointer. Clicks
pass through it to the chat, and it fades while the pointer is over it. The avatar
sits just outside the composer column's left or right edge, so it stays near
the chat and moves less when a sidebar or panel opens (and clear of the thread
context card). When the pane is too narrow for that, it is held to the pane
edge, and a bottom corner there sits above the composer.

Which pane shows which thread comes from bb (`useSidebarSplitLayout`, else the
route's thread), so the avatar stays while a question or approval card replaces
the composer. The avatar is drawn inside the pane's chat column, in a
zero-height element added as its first child, so it moves with the pane when
the right panel opens or closes and the column clips it. This uses bb's DOM, which is not a public API: `[data-split-pane-id]`,
`[data-thread-window]` (the chat column, a flex column), and
`[data-app-composer]`. If those change, avatars stop showing or bottom corners
overlap the composer; nothing else depends on them. The position is measured
when the pane or composer resizes, not while a turn streams.

The 14 still avatars that came before were stored as WebP data URLs. Once per
browser profile, the app rasterizes them again and gives any bot whose stored
image matches exactly the corresponding animated avatar; other uploads stay. App icons can only be registered at setup,
so bots use 30 fixed icon names (`bot-0` to `bot-29`); a deleted bot's
slot goes to the next new bot, which then also shows in old pills.

### Bot zoo

Settings → Bots has three per-device settings: **Show bot zoo** (off by
default), **Dock to the right panel when it's open** (on by default), and
**Floating style**, Card (the default) or Strip. The zoo
shows every bot in Bots order with its combined state; idle bots are dimmed,
and a bot with a thread in a visible pane gets a ring. Hovering a bot shows its
live thread counts by state, such as "Planner · 1 waiting, 2 working". Clicking
it opens a menu of its live threads, most urgent first, and **New thread with**
the bot. The zoo hides when there are no bots or the window is narrower than
46rem.

Floating, the zoo is a card with a header and a grid, or a strip with no
header that wraps past 560 px. Drag either one from anywhere (4 px starts a
drag), or focus it and use the arrow keys (8 px, 32 px with Shift). It is held at an
offset from the nearest window corner, saved per device, snaps to a 16 px
inset when dropped within 24 px of it, and stays on screen when the window
shrinks. The "–" button (in the card's header, or at the end of the strip)
collapses it to the most urgent bot, with a badge
counting bots that are waiting or unread; click that avatar to expand.

Docked, the zoo is a strip with no header that wraps to more rows as the
panel narrows, whatever the floating style. The floating zoo keeps its position meanwhile and returns there
when the panel closes. Docking uses bb's DOM, which is not a public API: the
right panel is `[data-panel-id^="thread-detail-secondary-panel"]` (with
`-pane-N` in split layouts), which is width 0 while closed, and the strip is
added as the last child of its `aside`, a flex column. If those change, the zoo
stays floating.

### Thread list

Choose **Bots** in Settings → Appearance → Sidebar thread list. A
**Bots | Threads | All** toggle at the top switches between three views.

**Bots** shows one tile per bot in your bot order (tiles never move): model,
thread count, running and needs-you counts, and **+** to message the bot
(opens its coordinator). A tile opens the Threads view at that bot. Below the tiles, **Pinned**
lists pinned threads, including ones without a bot (the only non-bot threads in
this view); drag a recent thread onto it to pin it. **Recent across bots** then
lists the other bot threads newest first, 10 at a time, sorted by Last
activity (`updatedAt`), Last response (`latestAttentionAt`, when the thread last
finished a turn or asked for input), or Created. Until you choose, it follows
the built-in list's sort. Drag a recent thread onto a tile to make it one of
that bot's workers (it moves under the coordinator).

**Threads** is the full list. The Bots list replaces bb's whole list (bb
does not let a plugin add a mode to the built-in one): Pinned, then bots and bb's custom sections in one order you set by
dragging group headers, then Threads. A thread with a bot and a section shows
under both; child threads stay under their parent. Rows show the agent icon,
plugin row metadata, and the built-in list's hover actions, following its
`rowActions`, `showProviderIcons`, and `showRowMetadata` preferences (read
through the built-in plugin's RPC, falling back to defaults).

Drag a row onto:

- a bot, to move it under the bot's coordinator as a worker;
- another row, to nest it under that thread;
- a section, to file it there as a top-level thread;
- Threads, to make it top-level with no section;
- Pinned, to pin it.

Dragging toward the main area opens a split, as in bb's list. **+ New section**
and each section's **⋯** (Rename, Delete) use bb's sections. Quick actions with
a submenu are left to the **⋯** menu. Drag needs this list: bb's own rows carry
no drag data.

**All** draws bb's regular list itself, in the built-in list's organization,
order, and sort: By project (one group per project, personal threads under
Threads), Custom (Pinned, bb's custom sections, and Threads), or By machine.
Pinned holds pinned threads and their children. Worktree grouping, By read
status, and every group's collapse state follow the built-in list's settings.
All reads those settings and writes changes back, so collapsing a group here
collapses it in bb's list too. A change made in bb's list, another window, or
`bb thread-list prefs` shows up when this window next regains focus. A bot
thread shows its bot's avatar, in that thread's state, in place of the
provider icon, even when provider icons are off.

The **Organize** button beside the toggle (All only) has bb's options:
organization, Groups (By environment, By read status), Rows (Provider icons,
and Metadata while the `threadRowMetadata` experiment is on), Sort by (pick
the current field again to reverse it), and Filter (Active, Archived, at
least one). Each group's **⋯** menu has **Hide from list**, which moves the
group into a collapsed **More** group at the end; **Show in list** there
brings it back. Custom sections also get Rename and Delete. Pinned cannot be
hidden.

Dragging in All follows bb's list. Drop a row onto:

- the middle of another row, to nest it there (in Custom it also takes that
  group's section);
- a group, to make it top-level there: in Custom it takes the section (none for
  Threads); By project, only the thread's own project accepts it;
- Pinned, to pin it; the top or bottom edge of a pinned row reorders Pinned.

Drag a group header onto another to reorder the top level; this writes the
built-in list's order for the current organization. Pinning, nesting, and
filing a thread unpin or re-file it the way bb's list does.

## Develop

```sh
npm ci
npm test
npx tsc
bb plugin build
bb plugin install --yes path:/path/to/bb-plugins --plugin bots
```

The plugin depends on `@arthurnw/bb-shared` (`file:../../packages/shared`, TypeScript
source with no build step), which `npm ci` links and `bb plugin build` bundles.
Import it by package name, never by relative path. After editing only
`packages/shared`, run `bb plugin reload bots`.
