# bb-plugin-tailnet-preview

Publish dev servers on the BB server machine over `tailscale serve` and open
them in the BB in-app browser of the connected client.

See [PLUGIN_OVERVIEW.md](PLUGIN_OVERVIEW.md) for behavior and
[skills/tailnet-preview/SKILL.md](skills/tailnet-preview/SKILL.md) for the
commands.

## Develop

```sh
npm install --include=dev
bb plugin build
bb plugin install .
bb plugin dev        # rebuild and reload on change
```

Settings: `bb plugin config tailnet-preview set tailscalePath /opt/homebrew/bin/tailscale`
when the server process cannot find `tailscale` on `PATH`.
