Adds a Plannotator Inbox page to BB's navigation rail.

## What you get

- A **Plannotator Inbox** icon in the navigation rail.
- A page that starts the Inbox if it is stopped and shows it full size, with no side panel.
- **Reload**, **Open in browser** and **Copy URL** in the page header. When the Inbox is
  published on your tailnet (Inbox Settings, or `"inboxTailscale": true` in
  `~/.plannotator/config.json`), both use the tailnet address, so they work from BB Desktop
  on another computer and from your phone.

## How it works

The plugin runs `plannotator inbox --background` on the BB server machine. That
command starts a stopped Inbox and prints its current URL, which changes when the
Inbox restarts.

The Inbox refuses to load inside a frame. To show it on the page itself, the plugin
runs a loopback proxy (port 19450 by default) that forwards to the Inbox and changes
only its framing headers: it drops `X-Frame-Options` and limits `frame-ancestors` to
loopback and this machine's tailnet name. Write requests must come from the proxy's
own origin. When the Inbox is on your tailnet, the plugin publishes the proxy port with
`tailscale serve` and forwards tailnet requests to the Inbox's tailnet listener, so the
Inbox's Tailscale login check still applies.

## Requirements

- Plannotator installed on the BB server machine (`plannotator` on PATH or in
  `~/.local/bin`). Set **plannotator binary** in the plugin settings for another path.
