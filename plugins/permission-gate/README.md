# bb-plugin-permission-gate

BB plugin that shows and switches the permission-gate mode of Pi threads. See
[PLUGIN_OVERVIEW.md](PLUGIN_OVERVIEW.md).

Needs `~/.pi/agent/extensions/bb-bridge` to report the mode with
`bb permission-gate report <mode>`.

```
npm install
bb plugin install .
bb plugin dev   # rebuild and reload on save
```
