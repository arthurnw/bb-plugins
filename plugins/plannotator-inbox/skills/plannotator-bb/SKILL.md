---
name: plannotator-bb
description: Review a plan, spec, document, or code diff with Plannotator inside BB's in-app browser. Use in BB threads whenever the user wants to review, annotate, or approve a plan or document you wrote, or review code changes or a pull request in a GUI, instead of plannotator-tui or launching `plannotator annotate` or `plannotator review` directly.
---

# Plannotator in BB

Write the plan or document as a Markdown file (thread storage, `$BB_THREAD_STORAGE`, is fine for plans that should not be committed), then run this skill's `scripts/plannotator-bb`, resolved against this skill's directory (BB copies plugin skills to a runtime path, so don't hard-code `~/.bb/skills`):

```sh
<skill-dir>/scripts/plannotator-bb <file> [more files...]
```

For a code review of local changes or a pull request, run:

```sh
<skill-dir>/scripts/plannotator-bb review [DIRECTORY | PR_URL] [review flags]
```

With no target it reviews the repository in the current directory. Useful flags: `--diff-type uncommitted|staged|last-commit|branch|...` and `--base <ref>`. See `plannotator review --help`.

The script:

- starts `plannotator annotate --gate --json` (or `plannotator review --gate --json`) in the background on a free port in 19432-19441, so several reviews can run at once;
- labels the session with this thread's provider (pi, codex, or claude-code);
- opens the session in BB's browser pane instead of the system browser;
- sends the reviewer's decision back to this thread as a new message when they finish.

After it prints the session URL, end your turn. Do not poll, wait, or reopen the session. When the `[plannotator-bb]` message arrives:

- `approved`: proceed. Treat any notes in `feedback` as guidance.
- `annotated`: revise the document, or for a code review fix the code, using the feedback, then run the script again for another round if the user wants one.
- `dismissed`: ask the user how to continue.

The session opens in this thread's browser pane without switching the user's view. If they are looking at another thread, it opens the next time they open this one.
