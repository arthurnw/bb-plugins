---
name: thread-delete-shortcut
description: Use the focused-thread delete shortcut only when the user explicitly asks to permanently delete the open BB thread.
---

# Thread delete shortcut

The plugin contributes `bb thread-delete-shortcut delete-current` and the
keyboard binding `plugin:thread-delete-shortcut/delete-current`.

The command targets the focused thread, opens a confirmation dialog, and
deletes only after the user chooses **Delete permanently**. It also deletes
child threads when BB reports them in the cascade.

Do not invoke the command proactively or to clean up unrelated threads. Use it
only when the user explicitly requests permanent deletion of the focused
thread.
