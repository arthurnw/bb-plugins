// Loads what a row shows beyond bb's live thread list: the latest turn's
// steps and timing from the timeline, and the pending interaction to answer.
// Results are cached per thread so collapsing and reopening a row is instant.

import { useCallback, useEffect, useRef, useState } from "react";
import { useSdk, type PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { askOf, type Ask } from "./interaction.ts";
import type { Status } from "./status.ts";
import { expandCollapsedTurn, summarizeTurn, type TimelineRowLike, type TurnSummary } from "./steps.ts";

export interface Details {
  summary: TurnSummary;
  ask: Ask | null;
}

type Sdk = ReturnType<typeof useSdk>;

const cache = new Map<string, { key: string; details: Details }>();

/** Refetches of an open, busy row are spaced at least this far apart. */
const MIN_REFRESH_MS = 2000;

async function load(sdk: Sdk, thread: PluginSidebarThread, running: boolean, withSteps: boolean): Promise<Details> {
  const threadId = thread.id;
  const [page, interactions] = await Promise.all([
    sdk.threads.timeline({ threadId, segmentLimit: "1", deferContent: "true" }),
    thread.hasPendingInteraction ? sdk.threads.interactions.list({ threadId }) : Promise.resolve([]),
  ]);
  const rows = page.rows as unknown as TimelineRowLike[];
  let summary = summarizeTurn(rows, running);
  const collapsed = summary.collapsedTurn;
  if (withSteps && collapsed !== null) {
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

/**
 * Details for `thread`, or null until loaded. An open row follows every
 * update; a closed running row loads once per run, for its clock.
 */
export function useDetails(thread: PluginSidebarThread, status: Status, open: boolean) {
  const sdk = useSdk();
  const wanted = open || status === "running" || status === "waiting";
  const key = open
    ? `open|${status}|${thread.hasPendingInteraction}|${thread.updatedAt}`
    : `closed|${status}|${thread.hasPendingInteraction}`;
  const cached = cache.get(thread.id);
  const [details, setDetails] = useState<Details | null>(cached?.details ?? null);
  const [error, setError] = useState<string | null>(null);
  const lastFetch = useRef(0);
  const [nonce, setNonce] = useState(0);
  const fetchedNonce = useRef(0);

  useEffect(() => {
    if (!wanted) return;
    const hit = cache.get(thread.id);
    if (hit !== undefined) setDetails(hit.details);
    // A closed row is also satisfied by an open row's fetch in the same state.
    const fresh =
      hit !== undefined &&
      (hit.key === key || (!open && hit.key.startsWith(`open|${status}|${thread.hasPendingInteraction}|`)));
    if (fresh && fetchedNonce.current === nonce) return;
    fetchedNonce.current = nonce;
    let cancelled = false;
    const wait = Math.max(0, lastFetch.current + MIN_REFRESH_MS - Date.now());
    const timer = setTimeout(() => {
      lastFetch.current = Date.now();
      load(sdk, thread, status === "running", open).then(
        (next) => {
          cache.set(thread.id, { key, details: next });
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
  }, [sdk, thread.id, key, wanted, nonce]);

  const refresh = useCallback(() => setNonce((value) => value + 1), []);
  return { details: wanted ? details : (cached?.details ?? null), error, refresh };
}
