// Loads what a card shows beyond bb's live thread list: the latest turn's
// message, steps, and counts from the timeline, and the pending interaction to
// answer. Results are cached per thread and refetched when the thread changes,
// at most a few at a time, so a long list doesn't flood the server.

import { useEffect, useState } from "react";
import { useSdk, type PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { askOf, type Ask } from "./interaction.ts";
import type { Status } from "./status.ts";
import { expandCollapsedTurn, summarizeTurn, type TimelineRowLike, type TurnSummary } from "./steps.ts";

export interface Details {
  summary: TurnSummary;
  ask: Ask | null;
}

type Sdk = ReturnType<typeof useSdk>;

interface Entry {
  key: string;
  /** Whether the collapsed turn's rows were loaded too. */
  full: boolean;
  details: Details;
  fetchedAt: number;
}

const cache = new Map<string, Entry>();

/** A running thread changes constantly; its card refetches at most this often. */
const RUNNING_REFRESH_MS = { open: 2_000, closed: 10_000 };
const MAX_IN_FLIGHT = 4;

let inFlight = 0;
const queue: (() => void)[] = [];

function limited<T>(work: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      inFlight += 1;
      work()
        .then(resolve, reject)
        .finally(() => {
          inFlight -= 1;
          queue.shift()?.();
        });
    };
    if (inFlight < MAX_IN_FLIGHT) run();
    else queue.push(run);
  });
}

async function load(sdk: Sdk, thread: PluginSidebarThread, running: boolean, full: boolean): Promise<Details> {
  const threadId = thread.id;
  const [page, interactions] = await Promise.all([
    sdk.threads.timeline({ threadId, segmentLimit: "1", deferContent: "true" }),
    thread.hasPendingInteraction ? sdk.threads.interactions.list({ threadId }) : Promise.resolve([]),
  ]);
  const rows = page.rows as unknown as TimelineRowLike[];
  let summary = summarizeTurn(rows, running);
  const collapsed = summary.collapsedTurn;
  if (full && collapsed !== null) {
    const turn = await sdk.threads.timelineTurnSummaryDetails({
      threadId,
      turnId: collapsed.turnId,
      sourceSeqStart: String(collapsed.sourceSeqStart),
      sourceSeqEnd: String(collapsed.sourceSeqEnd),
      deferContent: "true",
    });
    summary = expandCollapsedTurn(rows, turn.rows as unknown as TimelineRowLike[], running);
  }
  return { summary, ask: askOf(interactions as unknown as Parameters<typeof askOf>[0]) };
}

/** Details for `thread`, or null until loaded. An open card also loads the steps of a finished turn. */
export function useDetails(thread: PluginSidebarThread, status: Status, open: boolean) {
  const sdk = useSdk();
  const key = `${status}|${thread.hasPendingInteraction}|${thread.updatedAt}`;
  const [details, setDetails] = useState<Details | null>(() => cache.get(thread.id)?.details ?? null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const hit = cache.get(thread.id);
    if (hit !== undefined) setDetails(hit.details);
    const complete = hit !== undefined && (hit.full || !open);
    if (complete && hit.key === key) return;
    // A running thread's updatedAt moves with every event; space those refetches out.
    const sameRun = hit !== undefined && complete && hit.key.split("|", 2).join("|") === key.split("|", 2).join("|");
    const spacing = status === "running" && sameRun ? RUNNING_REFRESH_MS[open ? "open" : "closed"] : 0;
    const wait = hit === undefined ? 0 : Math.max(0, hit.fetchedAt + spacing - Date.now());
    let cancelled = false;
    const timer = setTimeout(() => {
      limited(() => (cancelled ? Promise.resolve(null) : load(sdk, thread, status === "running", open))).then(
        (next) => {
          if (next === null) return;
          cache.set(thread.id, { key, full: open, details: next, fetchedAt: Date.now() });
          if (!cancelled) {
            setDetails(next);
            setError(null);
          }
        },
        (cause: unknown) => {
          if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
        },
      );
    }, wait);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `thread` is read through `key`, which carries every field that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sdk, thread.id, key, open]);

  return { details, error };
}
