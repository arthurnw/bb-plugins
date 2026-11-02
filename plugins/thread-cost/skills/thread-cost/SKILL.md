---
name: thread-cost
description: Look up a bb thread's estimated API cost. Use when asked what a Pi, Claude Code, or Codex thread has cost.
---

# Thread cost

`bb thread-cost show [thread-id] [--json]` prints a thread's estimated cost at list
prices, broken down by model. Without an id it reports the calling thread.
Child threads are listed as a separate total.

The estimate comes from the provider's session transcript on the thread's
machine, priced with Pi's model table (`~/.pi/agent/models-store.json`). Pi
threads use Pi's own recorded cost. It is not an invoice: enterprise
contracted rates, fast-mode surcharges, and regional pricing are not applied.
