---
name: tailnet-preview
description: Show a web app or dev server running on the BB server machine in the user's BB in-app browser with `bb preview`. Use after starting a dev server, when the user asks to see, open, or preview a web UI, or before giving the user a localhost URL.
---

# Tailnet preview

The user runs BB Desktop on a different machine from the BB server. A `localhost` URL resolves on the user's machine, not on the server, so never hand the user a bare `localhost` link for a server-side process.

`bb preview open <port>` publishes the port with `tailscale serve` as `https://<server>.<tailnet>.ts.net:<port>` (tailnet only, HTTPS) and opens it in the in-app Browser of the thread that ran the command. If the user is not looking at that thread in BB Desktop, the tab opens the next time they open it there, so run the command even when the user is away. Also print the URL so the user can open it from a phone.

## Commands

| Command | Effect |
| --- | --- |
| `bb preview open <port> [--path /x] [--no-open] [--json]` | Publish a listening port and open it. Prints the URL. |
| `bb preview url <url>` | Open any tailnet-reachable http(s) URL in this thread's in-app Browser, with the same deferred behavior. |
| `bb preview list [--json]` | Show published ports and every TCP listener on the server. |
| `bb preview stop <port>` / `bb preview stop --all` | Stop publishing ports this plugin published. |

## Workflow

1. Start the dev server in a BB terminal or the background so it keeps running.
2. Wait until the port is listening (`bb preview list` shows it).
3. Run `bb preview open <port>`. Report the printed URL on its own line.
4. When the user is done with the app, or the dev server stops, run `bb preview stop <port>`.

## Troubleshooting

- `port_not_listening`: the dev server is not up yet or uses another port. Check `bb preview list`.
- Vite answers "Blocked request. This host is not allowed": add `server: { allowedHosts: [".ts.net"] }` to the Vite config. Other frameworks with host checks need the same allowance.
- Absolute redirects to `http://localhost:<port>` break through the proxy. Set the app's public or base URL to the printed `https://…ts.net:<port>` URL.
- WebSocket HMR goes through the same HTTPS origin. If HMR fails, set the client port to the published port (Vite: `server.hmr.clientPort`).
- `port_in_use`: another `tailscale serve` entry owns that port. Do not remove it with `--force` unless the user asks.
