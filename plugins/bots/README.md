# Bots

Bots are saved launch configurations: a name, avatar, instructions, memory, a
starter prompt, and optional model, permission mode, environment, and project.
A thread that runs as a bot gets the bot's instructions and a `bot_memory`
tool. Bots works alone and also with the [Launcher](../launcher) plugin.

Manage bots in Settings → Bots.

- **Thread list**: Bots | Threads views, Pinned, and Recent, with bots and
  custom sections in one order you arrange. Drag a thread onto a bot to hand it
  off.
- **Thread menu and Info tab**: assign a bot to a thread that has not started;
  a started thread opens a handoff instead.
- **New thread page**: a Bot chip beside bb's model button. It hides itself when
  the Launcher's own picker (which lists bots first) is on the page.
- **Handoff and "+" on a bot**: opens the Launcher's composer when it is
  installed, and Bots' own dialog otherwise (Mod+Shift+M bot picker,
  Mod+Shift+J project picker, Alt+J next project; Enter opens the thread and
  Cmd/Ctrl+Enter starts it in the background). A "+" with no bot is left to the
  sender, which opens bb's New thread page.
- **Without the Launcher**: a bot's Environment is limited to Project checkout,
  and the model field uses bb's own picker with no presets. Named worktree and
  Existing branch / PR need the Launcher; a bot that already uses one keeps it,
  marked "needs Launcher".
- **`bot_memory` tool**: agents read and append facts shared by every thread
  that uses the bot.
- **Avatar in thread panes**: a thread with a bot shows the bot's avatar at
  96 px in a corner of its pane, with the thread's own state. The corner is set
  in the bot's settings.
- **Bot zoo**: every bot's avatar in a draggable card, or in a strip along the
  bottom of the open right panel. Off by default; turn it on in Settings → Bots.

A thread belongs to a bot when its first message carries a bot pill (the
composers insert it), or when it inherits one from its parent, fork source, or
handoff source. Pills from before this plugin existed carry the `launcher`
plugin id and still bind. Bots do not appear in the `@` menu.

Other plugins read bots over RPC (`listBots`, `threadBots`, `getBot`) and
listen for the `bb-bots:changed` window event.

## Details

A bot is a saved launch configuration with its own instructions and memory:
name, avatar, instructions, starter prompt, and optional model, permission
mode, environment, and project. Fields left unset keep the composer's current
value. Keep method in skills and point a bot at them (for example a starter
prompt of `/skill:research `); bot instructions are limited to 2,000
characters.

### Starting a thread as a bot

A thread belongs to a bot when its first message mentions the bot. Every entry
point produces that mention:

- **Launcher overlay** (when installed): pick the bot in the model picker. Its fields are applied in one
  re-seed and the starter prompt fills an empty draft. Picking a model
  afterwards keeps the bot; **No bot** drops it. The server adds the mention
  when the thread is created.
- **New thread page**: with the Launcher, its picker lists bots; without it, Bots
  adds a Bot chip beside bb's model button. A bot's fields go through bb's own pickers,
  and its pill goes first in the draft; bb saves picker changes as the next
  thread's defaults, so the earlier values come back after the send (or when
  you choose **No bot**). 

The bot's instructions and the `bot_memory` tool are attached when the thread's
session starts, through `bb.agents.configure`, and a running session keeps what
it started with. Forks, side chats, and handoffs (bb's "Continue in new thread"
and the composer's) inherit the bot. Mentions in later messages bind nothing.

**Hand off to bot** in every thread menu, and the Bot row in the thread's Info
tab, reassign a thread that has not started. A started thread opens a
handoff to the chosen bot instead; **Without a bot** hands off with none. The
Info tab also shows the instructions a session starting now would get.

Deleting a bot keeps its threads; they get no bot at their next session start.

### Memory

Each bot keeps up to 1,800 characters of facts, one per line, shown in full in
the thread instructions. Agents read and change it with `bot_memory` (`read`,
`append`, `forget`, or `overwrite` with the sha256 from a read); its
instructions say to store only durable preferences and never credentials. Edit
it in the bot's settings; a save is refused if an agent changed it meanwhile.

### Avatars

Pick one of 16 animated avatars (Smooth or Geometric), or upload an image (PNG,
JPEG, WebP, GIF, or SVG), which is cropped to a square and stored as a 128 px
WebP (animations below). A pick is stored as `gallery:<id>` and drawn as inline SVG without a
circle crop. New bots get a random animated avatar no other bot uses, while one
is left. Without an avatar the emoji shows, then the first letter.

Animated avatars show what a bot is doing: idle (breathes and blinks),
working (a steady fast loop), unread (a gesture every 3 seconds), and waiting
for an approval or answer (a slow head tilt and a question bubble). A thread row
shows its own thread's state; bot headers, pickers, chips, mention pills, and
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
pass through it to the chat, and it fades while the pointer is over it. Bottom
corners sit beside the composer when the pane is wide enough, and above it
otherwise.

Which pane shows which thread comes from bb (`useSidebarSplitLayout`, else the
route's thread), so the avatar stays while a question or approval card replaces
the composer. The avatar is drawn inside the pane's chat column, in a
zero-height element added as its first child, and held to its side by CSS, so
it moves with the pane when the right panel opens or closes and the column
clips it. This uses bb's DOM, which is not a public API: `[data-split-pane-id]`,
`[data-thread-window]` (the chat column, a flex column), and
`[data-app-composer]`. If those change, avatars stop showing or bottom corners
overlap the composer; nothing else depends on them. The vertical offset of
bottom corners is measured when the pane or composer resizes, not while a turn
streams.

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
**Bots | Threads** toggle at the top switches between two views.

**Bots** shows one tile per bot in your bot order (tiles never move): model,
thread count, running and needs-you counts, memory size, and **+** for a new
thread. A tile opens the Threads view at that bot. Below the tiles, **Pinned**
lists pinned threads, including ones without a bot (the only non-bot threads in
this view); drag a recent thread onto it to pin it. **Recent across bots** then
lists the other bot threads newest first, 10 at a time, sorted by Last
activity (`updatedAt`), Last response (`latestAttentionAt`, when the thread last
finished a turn or asked for input), or Created. Until you choose, it follows
the built-in list's sort. Drag a recent thread onto a tile to hand it off to
that bot (or reassign it if it has not started).

**Threads** is the full list. The Bots list replaces bb's whole list (bb
does not let a plugin add a mode to the built-in one): Pinned, then bots and bb's custom sections in one order you set by
dragging group headers, then Threads. A thread with a bot and a section shows
under both; child threads stay under their parent. Rows show the agent icon,
plugin row metadata, and the built-in list's hover actions, following its
`rowActions`, `showProviderIcons`, and `showRowMetadata` preferences (read
through the built-in plugin's RPC, falling back to defaults).

Drag a row onto:

- a bot, to hand it off (or reassign it if it has not started);
- another row, to nest it under that thread;
- a section, to file it there as a top-level thread;
- Threads, to make it top-level with no section;
- Pinned, to pin it.

Dragging toward the main area opens a split, as in bb's list. **+ New section**
and each section's **⋯** (Rename, Delete) use bb's sections. Quick actions with
a submenu are left to the **⋯** menu. Drag needs this list: bb's own rows carry
no drag data.

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
