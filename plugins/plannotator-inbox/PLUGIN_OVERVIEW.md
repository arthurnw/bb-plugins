Adds a Plannotator Inbox page to BB's navigation rail.

## What you get

- A **Plannotator Inbox** icon in the navigation rail.
- A page that starts the Inbox if it is stopped and shows its address and version.
- **Open Inbox**, which opens the Inbox through BB, and **Copy URL**.

## How it works

The plugin runs `plannotator inbox --background` on the BB server machine. That
command starts a stopped Inbox and prints its current URL, which changes when the
Inbox restarts. The Inbox refuses to load inside a frame, so the page opens it with
BB's link handling instead of embedding it.

## Requirements

- Plannotator installed on the BB server machine (`plannotator` on PATH or in
  `~/.local/bin`). Set **plannotator binary** in the plugin settings for another path.
