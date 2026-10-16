# Project Picker

Project switching shortcuts and named Git worktrees in bb's New thread composer.

| Command | Default | What it does |
| --- | --- | --- |
| Project Picker: switch project | `Mod+Shift+J` | Opens a searchable project list. Type to filter, arrows or Ctrl+N/P (Ctrl+J/K) to move, Enter to pick, Esc to close. |
| Project Picker: next project | `Alt+J` | Selects the next project. |
| Project Picker: previous project | `Alt+Shift+J` | Selects the previous project. |

Rebind in Settings → Keyboard or with
`bb settings keyboard set plugin:project-picker/<open|next|previous> <shortcut>`.

Projects follow bb's project order; "No project" (the personal project) is last.

## Limits

- Works in composers bb hosts as a New thread composer: the root New thread
  page and anything that navigates there (for example Canvas).
- Does not reach composers embedded with `experimental_NewThreadComposer`
  (quick-compose, quick-chat). The SDK gives plugins no handle to those.
- Uses experimental SDK APIs (`experimental_registerCommand`,
  `experimental_popups`), so bb updates may require changes.

## Develop

```sh
npm install
npm test && npx tsc
bb plugin build
bb plugin install --yes path:$PWD
```

## Named worktree

In the New thread composer, select a project and machine, choose **Named
worktree** in the environment picker, enter a new branch name, and select its
base with **Branch from**. The name starts empty; `arthur/` is only a placeholder,
not a required or automatically inserted prefix. Local and remote-tracking
branches are available through bb's branch picker.

Git validates names with `git check-ref-format --branch`. Existing branches are
rejected with a clear error; creation uses `git worktree add -b` and never resets
an existing branch. To reuse an existing worktree, use bb's built-in Worktree
option instead.

CLI equivalent (substitute your project ID):

```sh
bb thread spawn --project <project-id> \
  --environment-provider named-worktree \
  --environment-inputs '{"name":"arthur/foo","baseBranch":"main"}' \
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
