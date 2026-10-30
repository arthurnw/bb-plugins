# bb-plugins

[BB](https://getbb.app) plugins, one per directory under `plugins/`.

| Plugin | What it does |
| --- | --- |
| [canvas](plugins/canvas) | Zoomable canvas of your threads: project frames, fork links, live status, pinned chats, and sticky notes. |
| [composer-vim](plugins/composer-vim) | Neovim-style modal editing for the composer, with readline insert-mode keys. |
| [inbox](plugins/inbox) | Inbox page for agent threads: live status, filter tabs, and rows with Approve, Reject, Retry, and Open. |
| [message-timestamps-lite](plugins/message-timestamps-lite) | Shows when you sent each message. |
| [nav](plugins/nav) | Ctrl+H/J/K/L focus movement between panes, like vim-tmux-navigator, and Ctrl+N/P in pickers. |
| [permission-gate](plugins/permission-gate) | Switches a Pi thread's permission-gate mode from the composer footer. |
| [plannotator-inbox](plugins/plannotator-inbox) | Plannotator Inbox page, plus the Inbox tool for Claude Code and Codex threads with replies that start a turn. |
| [launcher](plugins/launcher) | A floating new-thread composer with model presets, project shortcuts, named Git worktrees, and thread handoff. |
| [tailnet-preview](plugins/tailnet-preview) | Publishes dev servers over `tailscale serve` and opens them in the thread's in-app browser. |

`dev/` holds test fixtures, not plugins. `dev/latency-spa` is a small page and
server for checking tailnet-preview latency through the proxy.

## Install

From a local checkout:

```sh
bb plugin install path:/path/to/bb-plugins --plugin canvas
```

From GitHub:

```sh
bb plugin install git:https://github.com/arthurnw/bb-plugins.git --plugin canvas
```

Each plugin keeps its own `package.json` and lockfile and is listed in
`.bb/plugins.json`. Tag releases per plugin with a prefix, for example
`tailnet-preview/v0.2.0`.

## History

Each plugin was a separate repository before it moved here; its history is
kept under its directory (`git log -- plugins/<name>`).
