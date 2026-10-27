# bb-plugin-plannotator-inbox

A BB plugin that adds a [Plannotator](https://plannotator.ai) Inbox page to the navigation rail.

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
