# Message Timestamps (lite)

Shows when each message was sent in BB chat: above your bubbles, and below
agent replies (the time the reply finished). The thread header shows
"Last reply <time>" for the agent's last finished turn.

- Today: `12:43 PM`
- Yesterday: `Yesterday 12:43 PM`
- Older: `Aug 12, 12:43 PM`

## How it stays cheap

- Observes only the timeline row lists (`[data-timeline-row-list="top-level"]`
  and its `[data-timeline-items]` wrapper) for `childList` changes. Streaming
  text inside rows does not trigger it.
- Handles only the rows in each mutation's `addedNodes`; no document-wide scans.
- Reads the thread id from the row id (`thr_abc:user-seed:212`).
- Fetches one timeline page per thread and caches it (50 threads). Revisiting a
  thread makes no request. A row newer than the cache refetches the newest
  page; an unknown older row fetches the next older page.
- Sets a `--bb-sent-at` custom property on the row; CSS draws the label.

- An agent reply that is still streaming is rechecked every 3 seconds while
  it is on screen, until it finishes.
- The header time is saved when the thread goes idle (`thread.idle`) and
  pushed to open clients over realtime. Threads that went idle before install
  fall back to the newest agent message's time.

Finding the list costs one attribute selector query after navigation events
and once a second.

## Limits

- Depends on BB's DOM (`data-timeline-row-id`, `.group/message`).
- Labels such as "Yesterday" update when a row remounts, not at midnight.

## Develop

```sh
npm install
npm test
npm run typecheck
bb plugin build
bb plugin install . --yes
```
