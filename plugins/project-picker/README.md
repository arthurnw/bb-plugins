# Project Picker

Project shortcuts and named Git worktrees for bb's New thread page, plus a
floating composer with model presets and thread handoff adapted from Sawyer
Hood's Quick Compose and Dillion Verma's Ultra Launcher.

| Command | Default | What it does |
| --- | --- | --- |
| Project Picker: switch project | `Mod+Shift+J` | Search projects; arrows or Ctrl+N/P (Ctrl+J/K) to move, Enter to pick, Esc to close. |
| Project Picker: next project | `Alt+J` | Select the next project. |
| Project Picker: previous project | `Alt+Shift+J` | Select the previous project. |
| Project Picker: named worktree branch name | `Mod+Shift+B` | Switch the environment to Named worktree and focus its branch name field. In the overlay this re-seeds selections (like the project shortcuts) unless the field is already shown. |
| Project Picker: quick compose | `Mod+N` | Toggle a floating New thread composer without navigating. See [Replacing New thread](#replacing-new-thread). |
| Model picker (overlay only) | `Mod+Shift+M` | Presets first, then **Other model…** for every provider, model, effort, and tier. |
| Project Picker: hand off this thread | `Mod+Shift+H` | Open a composer mentioning the current thread and initially reusing its environment. |
| Project Picker: fork this thread into a named worktree | none | Open a composer that forks the current thread into a Named worktree based on the source's branch. Also in every thread actions menu as **Fork into named worktree**. |

`Mod` means Cmd on macOS and Ctrl elsewhere, matching Quick Compose's source
bindings. Projects follow bb's order; "No project" is last.

## Replacing New thread

`Mod+N` is bb's own New thread shortcut, so move that one away once:

```sh
bb settings keyboard set thread.new mod+shift+o
```

The sidebar's New thread button still opens the full page. To undo, run
`bb settings keyboard reset thread.new`.

## Overlay

Open from any page or from the command palette. It is centered over the whole
window. Use the project shortcuts inside the overlay. **Enter** creates the
thread and opens it; **Cmd+Enter** (Ctrl+Enter elsewhere) creates it in the
background and shows a notification with an **Open** action. Failed
submissions retain the draft. Close with Escape or a click on the backdrop. In the desktop app, a native Browser tab in the side panel draws above page content, so it can cover the overlay's right edge. Escape first closes an open
@-mention menu or project list; with Composer Vim, the first Escape returns to
Normal mode and the next one closes.

### Model presets

The overlay replaces bb's model button with a picker that lists presets first.
A preset is a provider, model, reasoning level, and service tier. **Other
model…** embeds bb's own picker; a model that matches no preset can be saved
with **Save current as preset…**, and each preset has a delete button. The last
choice is remembered and seeds the next overlay. On first use the presets are
the starter set from `default-presets.ts` (from Ultra Launcher) that the
machine's catalog offers. Presets are stored in plugin storage
(`model-state.v1`). Edit the list in Settings → Project Picker → Model presets: rename, change the
model, reorder, add, delete, or restore the defaults. Forks keep their source thread's model and use bb's own
button. The overlay hides the host button by its
`Provider, model and reasoning` label, so a bb release that renames it leaves
the host button visible and the trigger absent; `Mod+Shift+M` still works.

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
- Changing the model re-seeds the environment and branch the same way.
  Choose project and model first.
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

Leave **Branch from** empty to use the project's default branch, chosen as
bb's built-in Worktree does: origin's HEAD (for example `origin/main`), fetched
first, unless the local branch is ahead or has diverged, in which case the
local branch keeps its commits. The fetch is best effort, so offline creation
uses the last fetched copy. Without an `origin` HEAD it uses the source
checkout's current branch.

With both fields empty the option needs no input, so it works as a per-project
default: bb's composer remembers the last environment chosen for each project
in this browser (`bb.promptbox.environment-<project-id>-1` in local storage).

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

Pass `"name":""` to name the branch from the thread title and `"baseBranch":""`
for the default branch.

### Forks

**Fork into named worktree** (thread actions menu, the command above, or the
button under each message, which forks from that message) opens
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

- An explicitly chosen remote base uses the locally available remote-tracking
  ref without fetching. Only the default base is fetched.
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
