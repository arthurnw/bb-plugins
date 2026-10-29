---
name: plannotator-inbox-replies
description: How the Plannotator Inbox plugin delivers Inbox replies to Claude Code and Codex threads. Use when a plannotator_inbox call or a reply delivery misbehaves in BB.
---

# Plannotator Inbox replies in BB

- Claude Code and Codex threads in BB get a native `plannotator_inbox` tool from this plugin. Pi threads do not: Pi's Plannotator extension provides its own.
- The session id the Inbox sees is the BB thread id. Replies to messages sent with this tool start a turn in the thread once it is idle (Send now steers a running turn). Replies to messages sent through a `plannotator-inbox` MCP server do not.
- The plugin keeps watching a thread after its first call, until the thread is archived or deleted.
- Logs: `bb plugin logs plannotator-inbox -f`. After a Plannotator update, reload: `bb plugin reload plannotator-inbox`.
