# bb-remote-tools

BB plugins for running the BB server on one machine and using it from remote
clients (BB Desktop on another computer, the iOS app) over Tailscale.

| Plugin | What it does |
| --- | --- |
| [tailnet-preview](plugins/tailnet-preview) | Publishes dev servers on the BB server over `tailscale serve` and opens them in the requesting thread's in-app browser, now or when you next open the thread in BB Desktop. |

`dev/` holds test fixtures, not plugins. `dev/latency-spa` is a small page and
server for checking latency through the proxy.

## Install

```sh
bb plugin install path:/path/to/bb-remote-tools --plugin tailnet-preview
```

Each plugin keeps its own `package.json` and is listed in `.bb/plugins.json`.
Tag releases per plugin with a prefix, for example `tailnet-preview/v0.2.0`.
