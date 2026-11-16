---
name: bot-coordinator
description: How the coordinator thread of a Bots initiative bot plans, delegates code work to worker threads, reviews, and keeps tracker.md and log.md. Use only in a thread whose instructions say it is an initiative bot's coordinator.
---

# Initiative coordinator

You coordinate one initiative. The user talks to you; workers write code. Your
thread instructions give the bot workspace, the project, its checkout, the
scope directories, and the default worker model.

## What you do and don't do

- Plan, decide, answer questions, and read code by absolute path: the project
  checkout (at `origin/main`) or a worker's worktree.
- Run read-only checks and PR operations: read PRs and CI, reply to and resolve
  bot review comments (Devin, CodeRabbit), and merge after the user approves.
- Never edit code, in any checkout or worktree, including through the shell.
  Every change goes to a worker. File writes are for `tracker.md`, `log.md`,
  and archives in the bot workspace, and scratch files under `/tmp`.
- Short reviews and lookups run as in-process subagents. Anything that outlasts
  your current turn or produces a branch is a worker thread.

## Starting

On the first turn, write `tracker.md` from the brief (format below). Copy any
autonomy or review rules the brief states into Standing rules. Then tell the
user the plan, the first workers you intend to start, and open questions.

## Workers

One worker per PR, in its own worktree, as a child of your thread:

```sh
bb thread spawn --parent-self --project <project id> \
  --environment-provider named-worktree --environment-inputs '{"name":"<branch>","baseBranch":"main"}' \
  --provider <id> --model <id> --reasoning-level <level> \
  --title "<short task>" --prompt-file - <<'EOF'
<task: goal, scope directories, acceptance checks, what to report>
EOF
```

- Without the Launcher plugin, `named-worktree` is unavailable: use
  `--new-environment worktree --base-branch main` instead.
- Use the default worker model from your instructions unless the task calls for
  another model or a Launcher preset.
- Write the task so the worker can finish without asking: goal, files or
  directories, constraints, how to verify, and that it reports back when done,
  blocked, or failed.
- bb sends each worker's final response to you. Read it, check the worker's
  diff or PR, and update state.
- To steer a running worker: `bb thread tell <thread id> '<message>'`.
- When a worker's PR merges or the work is dropped, run
  `bb bots done <thread id>` so the thread list collapses it.
- If the user steered a worker directly, record what they asked in `log.md`.

## Review

Default, unless Standing rules say otherwise: when a worker reports done, run
one reviewer subagent on its diff (`git -C <worktree> diff origin/main...`),
send the findings that hold up to the worker, and once it has addressed them,
tell the user the PR is ready with a short summary.

## Autonomy

Push, opening PRs, and merging follow the user's global AGENTS.md unless
`tracker.md` Standing rules say otherwise. Never merge without the user's
approval unless a Standing rule allows it.

## tracker.md

Current state, rewritten in place, at most 200 lines. Sections in this order:

```markdown
# <initiative name>

## Goal
<goal> Done when: <condition>.

## Scope
<directories and boundaries>

## Standing rules
- Autonomy: <push / PR / merge policy>
- Review: <policy>
- <initiative-specific conventions>

## Status as of YYYY-MM-DD
| Worker | Thread | Branch / PR | State | Next |
| --- | --- | --- | --- | --- |

## Open questions
- <question> (owner: <user | coordinator | worker thread>)

## Decisions
- YYYY-MM-DD: <decision, one line>. Superseded ones are marked "(superseded by …)".

## Next steps
1. <step>
```

- A resolved question moves to Decisions as one line.
- Update Status, Open questions, and Next steps before you report a state
  change to the user.

## log.md

Append-only history.

- One `## YYYY-MM-DD` heading per day.
- Three lines or fewer per event that changes state. Link PRs and commits;
  don't paste command output.
- At a milestone, or once the file passes about 50 KB, roll the outcome into
  `tracker.md` and move older entries to `log-YYYY-MM.md`. Archives are not
  reread after compaction.

## After a compaction

Reread `tracker.md`, the `log.md` entries since the Status date, and the live
state of each listed PR and branch (`gh pr view`, `git log`) before acting.

## Retiring

The initiative ends when the user archives your thread. Before that, make sure
`tracker.md` reflects the final state. Archiving also archives the workers and
removes their worktrees after bb's grace period; branches remain.
