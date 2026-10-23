Open web apps running on your BB server in BB's in-app browser on another
machine, over Tailscale.

## What you get

- `bb preview open <port>` publishes a dev server with `tailscale serve` and
  opens it in the in-app Browser of the thread that asked for it. If that
  thread is not on screen, the tab opens the next time you open the thread
  in BB Desktop. The iOS and web clients have no in-app browser, so they leave
  the tab queued for Desktop.
- A Browser toolbar button on `localhost` pages that reopens the same port
  from the BB server.
- An agent skill so agents preview their dev servers instead of printing
  `localhost` links.

## How it works

The BB server runs `tailscale serve --bg --https=<port>` for the chosen port,
so the app is reachable only inside your tailnet at
`https://<server>.<tailnet>.ts.net:<port>`. The plugin removes only the serve
entries it created.

Requires the Tailscale CLI on the BB server machine, MagicDNS, and HTTPS
certificates enabled for the tailnet.
