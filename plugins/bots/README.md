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

A thread belongs to a bot when its first message carries a bot pill (the
composers insert it), or when it inherits one from its parent, fork source, or
handoff source. Pills from before this plugin existed carry the `launcher`
plugin id and still bind. Bots do not appear in the `@` menu.

Other plugins read bots over RPC (`listBots`, `threadBots`, `getBot`) and
listen for the `bb-bots:changed` window event.

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
