# Project Picker

Project shortcuts for bb's New thread page, plus a floating composer and thread
handoff adapted from Sawyer Hood's Quick Compose.

| Command | Default | What it does |
| --- | --- | --- |
| Project Picker: switch project | `Mod+Shift+J` | Search projects; arrows or Ctrl+N/P (Ctrl+J/K) to move, Enter to pick, Esc to close. |
| Project Picker: next project | `Alt+J` | Select the next project. |
| Project Picker: previous project | `Alt+Shift+J` | Select the previous project. |
| Project Picker: quick compose | `Mod+Shift+L` | Toggle a floating New thread composer without navigating. |
| Project Picker: hand off this thread | `Mod+Shift+H` | Open a composer mentioning the current thread and initially reusing its environment. |

`Mod` means Cmd on macOS and Ctrl elsewhere, matching Quick Compose's source
bindings. Projects follow bb's order; "No project" is last.

## Overlay

Open from any page or from the command palette. Use **Switch project…** or the
project shortcuts inside the overlay. Submit starts the thread in the background;
the success notification has an **Open** action. Failed submissions retain the
draft. Close with the Close button, Escape when not consumed by an editor/menu,
or a click on the backdrop.

Dismissed sessions stay mounted to preserve drafts and selections, even if the
session was untouched. A new-thread session lasts until submission or reload.
Handoffs have per-source draft keys; opening a handoff on a different thread
replaces the mounted handoff session. Text drafts persist across reloads, but
execution/environment selections do not. Handoff mention pills use the SDK's
supported `initialPrompt` parsing, with no private storage writes.

**Disable Sawyer Hood's `quick-compose` plugin before using these default binds**,
or rebind its two commands to avoid collisions. This plugin does not disable or
uninstall anything. Quick Chat is separate and need not be disabled.

Rebind commands in Settings → Keyboard. Existing New thread commands retain IDs
`plugin:project-picker/open`, `/next`, and `/previous`; overlay commands use
`plugin:project-picker/new-thread` and `/handoff`.

## SDK limits (bb 0.46.1 / SDK 0.6.49)

The embedded `experimental_NewThreadComposer` has neither a plugin composer-host
binding nor a selection-change callback. Its `default*` props are seeds; changing
one resets **all** execution/environment selections. Consequently:

- Overlay project shortcuts use a plugin-owned list and `defaultProjectId`.
  Choose the project **before** customizing model, reasoning, service tier,
  permissions, environment, or branch: changing it resets those choices.
  The prompt and attachments remain in the mounted composer.
- Cycling starts from the last project selected through our control (initially
  the source project). The embedded native project menu cannot report its changes
  back to the plugin. Use our control consistently when using cycle shortcuts.
  Choosing the same seed again cannot reset a native-menu change; choose another
  project through our control first. The list marks the last project chosen here,
  not necessarily the current native-menu selection.
- The embedded native project menu remains available. Its displayed project is
  the actual submitted project. There is no submit-time project override.
- Overlay project shortcuts currently use their fixed defaults. Rebinding the
  hosted composer commands changes the New thread page only.
- The original New thread page keeps its existing host-bound picker behavior.
  This does not add shortcuts to other plugins' embedded composers.

Preserving every selection while changing projects, synchronizing the native
project menu, and sharing rebindings require additional SDK support. This plugin
uses no selectors or event simulation against bb's internal DOM.

## Develop

```sh
npm ci
npm test
npx tsc
bb plugin build
bb plugin install --yes path:$PWD
```

The overlay session logic and shortcut matching have pure Node tests alongside
the project ordering, cycling, and filtering tests. Live testing is also needed
for host composer reconciliation and plugin shortcut conflicts.

Quick Compose's MIT copyright and permission notice are retained in
[THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).
