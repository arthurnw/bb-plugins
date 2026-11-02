# Thread Cost

Shows a thread's estimated API cost above the composer for Pi, Claude Code, and
Codex threads. Click it for a per-model breakdown. Threads with child threads
also show the combined total.

```sh
bb thread-cost show [thread-id] [--json]
```

## How it works

bb records each thread's provider session ids (`thread/identity` events). The
plugin's host entry reads those sessions' transcripts on the thread's machine:

| Provider | Transcript | Cost |
| --- | --- | --- |
| Pi | `<bb data dir>/pi-bridge-sessions/<id>.jsonl` | Pi's recorded `usage.cost.total` |
| Claude Code | `~/.claude/projects/*/<id>.jsonl` and `<id>/subagents/*.jsonl` | tokens × price |
| Codex | rollout from `~/.codex/state_5.sqlite`, plus spawned subagent threads | tokens × price |

Prices come from Pi's model table, `~/.pi/agent/models-store.json`, using the
same formula as Pi (tiered rates, 1h cache writes at 2× input). Claude adds
$10 per 1,000 web searches. For a Claude Code session this matched Claude
Code's own `total_cost_usd` exactly.

The cost refreshes when a thread goes idle.

## Limits

- List prices only. Enterprise contracted rates, Claude fast mode, and
  regional pricing aren't applied.
- A model missing from Pi's table shows "no price", and the total gets a `+`.
- A forked thread's session can repeat its parent's history, so fork costs
  may overlap.
