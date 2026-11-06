The Thread Delete Shortcut plugin adds a keyboard shortcut for permanently
deleting the currently focused BB thread.

Pressing the shortcut does not delete immediately. BB opens a confirmation
dialog near the top of the window with the title, an explanation of the
irreversible action, and explicit Cancel and Delete permanently buttons. Child
threads are called out and are included only after confirmation.

The plugin registers the command
`plugin:thread-delete-shortcut/delete-current`, so users can choose any
shortcut in Settings → Keyboard or with:

```sh
bb settings keyboard set plugin:thread-delete-shortcut/delete-current Mod+Shift+Backspace
```

The plugin uses BB's server SDK directly instead of spawning a shell command.
It does not need an account, external service, or project checkout.
