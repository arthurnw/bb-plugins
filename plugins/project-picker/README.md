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
| Project Picker: fork this thread into a named worktree | none | Open a composer that forks the current thread into a Named worktree based on the source's branch. Also in every thread actions menu as **Fork into named worktree**. |

`Mod` means Cmd on macOS and Ctrl elsewhere, matching Quick Compose's source
bindings. Projects follow bb's order; "No project" is last.

## Overlay

Open from any page or from the command palette. Use the project shortcuts
inside the overlay. Submit starts the thread in the background;
the success notification has an **Open** action. Failed submissions retain the
draft. Close with Escape or a click on the backdrop. Escape first closes an open
@-mention menu or project list; with Composer Vim, the first Escape returns to
Normal mode and the next one closes.

Dismissed sessions stay mounted to preserve drafts and selections. On reopen, a
new-thread session with a draft (text, mentions, or attachments) is resumed;
one without a draft is replaced, so it re-seeds from the project in view and
that project's remembered defaults, like `Mod+N`. A new-thread session with a
draft lasts until submission or reload. The SDK exposes no draft state, so the
overlay checks its editor text and bb's persisted draft entry.

bb remembers a project's provider, model, and other execution defaults only for
threads started from the app itself. Threads started from this overlay are
plugin-created, so their choices do not become the project's defaults.
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
uses no event simulation against bb's internal DOM; it reads a few `data-promptbox-*`
attributes for Escape handling, branch-name focus, and draft detection.

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

Leave the name empty (or only the prefix) to name the branch from the thread
title, as bb's built-in Worktree does, but without the thread ID:
`<prefix><title-slug>`. When that branch exists, the plugin adds `-2`, `-3`, and
so on. A thread with no usable title gets `<prefix>thread-<UTC timestamp>`.

After creating or restoring the worktree, the plugin runs `wt setup <worktree>`
when [`wt`](https://github.com/arthurnw/wt) is on the host's `PATH` or in
`~/.local/bin`; otherwise it skips this step. Its output appears in the
provisioning log. A failed `wt setup` is reported and the worktree is kept;
run `wt setup` in the worktree to retry. It runs before `.bb-env-setup.sh`.

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

Pass `"name":""` to name the branch from the thread title.

### Forks

**Fork into named worktree** (thread actions menu, or the command above) opens
the overlay seeded with Named worktree, an empty name, and the source thread's
branch as the base on the source's machine. Submitting calls `threads.fork`, so
the new thread inherits the source conversation, provider, and model; the
composer's model picker is ignored and the project cannot change. The worktree
starts from the base branch's commits, not the source's uncommitted changes.
Equivalent API request:

```sh
curl -X POST http://127.0.0.1:38886/api/v1/threads/fork -H 'content-type: application/json' -d '{
  "sourceThreadId": "<thread-id>",
  "input": [{"type": "text", "text": "Continue"}],
  "environment": {"type": "provider", "environmentProviderId": "named-worktree",
    "machine": {"type": "existing", "hostId": "<host-id>"},
    "inputs": {"name": "", "baseBranch": "main"}}
}'
```

bb's own Fork and `bb thread fork --new-environment worktree` still use the
built-in Worktree provider.

Worktrees live on the selected machine under this plugin's host-data directory:
`worktrees/<path-key>/<repository-name>`. This matches the built-in layout, but
uses `project-picker/host-data` rather than `environment-git-worktree/host-data`
to keep ownership separate.

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
