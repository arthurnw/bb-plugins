# bb-plugin-plannotator-inbox

A BB plugin that adds a [Plannotator](https://plannotator.ai) Inbox page to the navigation rail,
and gives Claude Code and Codex threads a `plannotator_inbox` tool whose replies come back to the thread.

The page runs `plannotator inbox --background` on the BB server machine, which starts the
Inbox if needed and prints its current URL, then opens that URL through BB. The Inbox sends
`X-Frame-Options: DENY`, so it can't be embedded in the page itself.

## Install

```sh
npm install
bb plugin install .
```

## Settings

- `plannotatorPath`: command or absolute path for the Plannotator CLI. Default `plannotator`
  (`~/.local/bin` and Homebrew paths are added to PATH).

## Agent tool and replies

In BB, Claude Code and Codex run through their SDKs, where Plannotator's own Claude Code tool
doesn't load and an MCP connection can't receive replies. This plugin registers a native
`plannotator_inbox` tool for `claude-code` and `codex` threads (not Pi, whose Plannotator
extension already has one). The Inbox sees the BB thread id as the session. After a thread's
first call, the plugin watches for the person's replies and sends each into the thread with
`bb.sdk.threads.send`, which starts a turn when the thread is idle. It stops watching when the
thread is archived or deleted.

`vendor/` is copied unchanged from `@plannotator/pi-extension/generated/inbox` (0.28.31); recopy
it when Plannotator changes its Inbox protocol. The tool's parameters are read from the Inbox at
load, so reload the plugin after a Plannotator update.
