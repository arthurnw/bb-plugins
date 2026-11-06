# BB Thread Delete Shortcut

Adds a keyboard-bindable command for permanently deleting the focused BB
thread. Pressing the shortcut opens a confirmation dialog near the top of the
BB window; only the **Delete permanently** button calls BB's delete API.

The plugin command is:

```sh
bb thread-delete-shortcut delete-current
```

Bind it with:

```sh
bb settings keyboard set \
  plugin:thread-delete-shortcut/delete-current Mod+Shift+Backspace
```

That means Command+Shift+Backspace on macOS and Control+Shift+Backspace on
Windows/Linux. Reset the binding with:

```sh
bb settings keyboard reset plugin:thread-delete-shortcut/delete-current
```

The command requires an open focused thread. Child threads are included in the
confirmation and are deleted only after explicit confirmation. The CLI command
uses BB's standard pending-interaction card when run from a terminal.
