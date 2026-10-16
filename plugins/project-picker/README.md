# Project Picker

Project shortcuts and named Git worktrees for bb's New thread page, plus a
floating composer and thread handoff adapted from Sawyer Hood's Quick Compose.

| Command | Default | What it does |
| --- | --- | --- |
| Project Picker: switch project | `Mod+Shift+J` | Search projects; arrows or Ctrl+N/P (Ctrl+J/K) to move, Enter to pick, Esc to close. |
| Project Picker: next project | `Alt+J` | Select the next project. |
| Project Picker: previous project | `Alt+Shift+J` | Select the previous project. |
| Project Picker: named worktree branch name | `Mod+Shift+B` | Switch the environment to Named worktree and focus its branch name field. In the overlay this re-seeds selections (like the project shortcuts) unless the field is already shown. |
| Project Picker: quick compose | `Mod+Shift+L` | Toggle a floating New thread composer without navigating. |
| Project Picker: hand off this thread | `Mod+Shift+H` | Open a composer mentioning the current thread and initially reusing its environment. |

`Mod` means Cmd on macOS and Ctrl elsewhere, matching Quick Compose's source
bindings. Projects follow bb's order; "No project" is last.

## Overlay

Open from any page or from the command palette. Use the project shortcuts
inside the overlay. Submit starts the thread in the background;
the success notification has an **Open** action. Failed submissions retain the
draft. Close with Escape or a click on the backdrop. Escape first closes an open
@-mention menu or project list; with Composer Vim, the first Escape returns to
Normal mode and the next one closes.

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
`plugin:project-picker/open`, `/next`, `/previous`, and `/branch-name`; overlay commands use
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

## Named worktree

In the New thread composer, select a project and machine, choose **Named
worktree** in the environment picker, enter a new branch name, and select its
base with **Branch from**. The name starts with bb's branch prefix
(`managedBranchPrefix` in Settings → General, `bb/` by default; empty when the
setting is empty), which you can edit or delete. Local and remote-tracking
branches are available through bb's branch picker.

Git validates names with `git check-ref-format --branch`. Existing branches are
rejected with a clear error; creation uses `git worktree add -b` and never resets
an existing branch. To reuse an existing worktree, use bb's built-in Worktree
option instead.

CLI equivalent (substitute your project ID):

```sh
bb thread spawn --project <project-id> \
  --environment-provider named-worktree \
  --environment-inputs '{"name":"feature/foo","baseBranch":"main"}' \
  --prompt 'Work on foo'
```

Worktrees live on the selected machine under this plugin's host-data directory:
`worktrees/<path-key>/<repository-name>`. This matches the built-in layout, but
uses `project-picker/host-data` rather than `environment-git-worktree/host-data`
to keep ownership separate. Repository names unsuitable for directory names
are sanitized and hashed.

The provider returns an owned path, so bb runs `.bb-env-setup.sh` and
`.bb-env-teardown.sh` with its normal timeout and failure handling. Core retires
an environment after its last live thread is archived or deleted (the default
five-minute grace). Cleanup stops processes using the directory, force-removes
the worktree, and keeps the branch. As with built-in worktrees, uncommitted files
are removed during cleanup. Restore via `bb thread restore-environment` reuses
the recorded branch and preserves its commits. The plugin must remain installed
and the source checkout must remain accessible for lifecycle operations.

Differences from built-in Worktree:

- An explicit base is required; there is no automatic default-base selection.
- Remote bases use the locally available remote-tracking ref without fetching.
  Fetch first when you want the latest remote commits. This keeps creation
  deterministic and usable offline.
- `.worktreeinclude` copies matching untracked files without overwriting files
  in the checkout and skips symlinks, as the built-in provider does. Copy errors
  fail provisioning instead of being logged and skipped.
- A missing branch fails restore instead of recreating it from the original
  base. Failed setup can leave the new branch behind; choose another name or
  explicitly remove that branch before retrying. Branches are never deleted
  automatically.
- The composer branch picker requires an existing machine. For a newly created
  machine, use the CLI with explicit inputs or select it after it is available.

Uses experimental environment-provider and host-worker SDK APIs, tested with
bb 0.46.1 and `@get-bb/plugin-sdk` 0.6.49.
