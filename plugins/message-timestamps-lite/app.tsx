import {
  definePluginApp,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
  type PluginThreadHeaderActionProps,
} from "@get-bb/plugin-sdk/app";
import { useEffect, useState } from "react";
import { formatSentAt, parseMessageRowId } from "./format.ts";
import type { rpcContract } from "./server.ts";
import { LAST_REPLY_CHANNEL, type LastReplySignal } from "./shared.ts";
import "./app.css";

// The thread timeline renders rows as children of the top-level list, or of a
// [data-timeline-items] wrapper inside it. Only these containers are observed,
// and only for childList changes, so streaming text inside rows never wakes us.
const LIST_SELECTOR = '[data-timeline-row-list="top-level"]';
const ITEMS_ATTR = "data-timeline-items";
const SENT_AT_VAR = "--bb-sent-at";
const MAX_PAGES_PER_RESOLVE = 12;
const MAX_CACHED_THREADS = 50;
// How often to recheck an agent reply that is still streaming while it is on screen.
const IN_PROGRESS_RETRY_MS = 3000;
// Thread switches usually fire navigation events; this interval only catches a
// timeline that mounts without one. Each tick is one attribute selector query.
const LIST_CHECK_MS = 1000;
const NAV_RECHECK_DELAYS_MS = [0, 100, 400, 1000];

type Cursor = { anchorSeq: number; anchorId: string };
type Page = {
  messages: { id: string; createdAt: number | null; inProgress?: boolean }[];
  olderCursor: Cursor | null;
  maxSeq: number;
};
type RpcEnvelope = { ok: true; result: Page } | { ok: false; error?: { message?: string } };

type ThreadState = {
  // null marks a user-role row that has no sent time to show.
  times: Map<string, number | null>;
  loaded: boolean;
  maxSeq: number;
  olderCursor: Cursor | null;
  inFlight: boolean;
  // Agent replies that were still streaming at the last fetch.
  inProgress: Set<string>;
  retryTimer: number;
};

function formatFull(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function LastReply({ threadId, isCompactViewport }: PluginThreadHeaderActionProps) {
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();
  const [at, setAt] = useState<number | null>(null);

  // Refetch on reconnect: signals sent while disconnected are not replayed.
  const connected = connection === "connected";
  useEffect(() => {
    let cancelled = false;
    rpc
      .call("lastReplyAt", { threadId })
      .then((result) => {
        if (!cancelled) setAt(result.at);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // rpc is not guaranteed to be referentially stable.
  }, [threadId, connected]);

  useRealtime(LAST_REPLY_CHANNEL, (payload) => {
    const signal = payload as Partial<LastReplySignal> | null;
    if (signal?.threadId === threadId && typeof signal.at === "number") setAt(signal.at);
  });

  if (at == null) return null;
  const label = formatSentAt(at);
  return (
    <span
      className="whitespace-nowrap text-xs text-muted-foreground"
      title={`Last agent reply ${formatFull(at)}`}
    >
      {isCompactViewport ? label : `Last reply ${label}`}
    </span>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_threadHeaderAction({
    id: "last-reply",
    title: "Last agent reply",
    component: LastReply,
  });

  app.contentScripts.register({
    id: "sent-message-times",
    mount({ pluginId, signal }) {
      const threads = new Map<string, ThreadState>();
      const pending = new Map<string, Set<HTMLElement>>();
      const observed = new Map<Element, MutationObserver>();
      const stamped = new Set<HTMLElement>();
      const timers = new Set<number>();

      const threadState = (threadId: string): ThreadState => {
        let state = threads.get(threadId);
        if (state) {
          threads.delete(threadId);
        } else {
          state = { times: new Map(), loaded: false, maxSeq: 0, olderCursor: null, inFlight: false, inProgress: new Set(), retryTimer: 0 };
        }
        threads.set(threadId, state);
        if (threads.size > MAX_CACHED_THREADS) {
          const oldest = threads.keys().next().value;
          if (oldest !== undefined) threads.delete(oldest);
        }
        return state;
      };

      const fetchPage = async (threadId: string, before: Cursor | null): Promise<Page> => {
        const response = await fetch(
          `/api/v1/plugins/${encodeURIComponent(pluginId)}/rpc/userMessageTimes`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ threadId, before }),
            signal,
          },
        );
        const envelope = (await response.json()) as RpcEnvelope;
        if (!response.ok || !envelope.ok) {
          throw new Error(envelope.ok ? `HTTP ${response.status}` : envelope.error?.message);
        }
        return envelope.result;
      };

      const stamp = (row: HTMLElement, createdAt: number) => {
        const label = formatSentAt(createdAt);
        if (!label) return;
        row.style.setProperty(SENT_AT_VAR, JSON.stringify(label));
        stamped.add(row);
      };

      // Stamps rows whose time is known and returns the ones still unknown.
      const applyKnown = (threadId: string, state: ThreadState): HTMLElement[] => {
        const rows = pending.get(threadId);
        if (!rows) return [];
        const unknown: HTMLElement[] = [];
        for (const row of rows) {
          const id = row.dataset.timelineRowId;
          if (!row.isConnected || !id) {
            rows.delete(row);
          } else if (state.times.has(id)) {
            const createdAt = state.times.get(id);
            if (createdAt != null) stamp(row, createdAt);
            rows.delete(row);
          } else {
            unknown.push(row);
          }
        }
        if (rows.size === 0) pending.delete(threadId);
        return unknown;
      };

      const resolve = async (threadId: string) => {
        const state = threadState(threadId);
        if (state.inFlight) return;
        state.inFlight = true;
        const merge = (page: Page) => {
          for (const m of page.messages) {
            if (m.inProgress) {
              state.inProgress.add(m.id);
            } else {
              state.inProgress.delete(m.id);
              state.times.set(m.id, m.createdAt);
            }
          }
        };
        try {
          let refreshedNewest = false;
          for (let page = 0; page < MAX_PAGES_PER_RESOLVE && !signal.aborted; page += 1) {
            // A row is "newer" when the newest page may hold it: a user row past
            // the cached maxSeq, a streaming reply, or an agent row (its id has
            // no seq to compare).
            const isNewer = (row: HTMLElement) => {
              const id = row.dataset.timelineRowId!;
              if (state.inProgress.has(id)) return true;
              const seq = parseMessageRowId(id)?.seq;
              return refreshedNewest ? seq != null && seq > state.maxSeq : seq == null || seq > state.maxSeq;
            };
            const unknown = applyKnown(threadId, state);
            // Rows still newer after a refresh stay pending for a later
            // resolve instead of refetching in a loop.
            const older = refreshedNewest ? unknown.filter((row) => !isNewer(row)) : unknown;
            if (older.length === 0) return;

            if (!state.loaded || (!refreshedNewest && older.some(isNewer))) {
              const result = await fetchPage(threadId, null);
              merge(result);
              if (!state.loaded) state.olderCursor = result.olderCursor;
              state.loaded = true;
              state.maxSeq = result.maxSeq;
              refreshedNewest = true;
            } else if (state.olderCursor) {
              const result = await fetchPage(threadId, state.olderCursor);
              merge(result);
              state.olderCursor = result.olderCursor;
            } else {
              for (const row of older) state.times.set(row.dataset.timelineRowId!, null);
            }
          }
        } catch {
          // Leave rows unstamped; the next added row retries.
        } finally {
          state.inFlight = false;
          const waiting = Array.from(pending.get(threadId) ?? []).some(
            (row) => row.isConnected && state.inProgress.has(row.dataset.timelineRowId!),
          );
          if (waiting && !state.retryTimer && !signal.aborted) {
            state.retryTimer = window.setTimeout(() => {
              state.retryTimer = 0;
              scheduleResolve(threadId);
            }, IN_PROGRESS_RETRY_MS);
          }
        }
      };

      const scheduledThreads = new Set<string>();
      let resolveFrame = 0;
      const scheduleResolve = (threadId: string) => {
        scheduledThreads.add(threadId);
        if (resolveFrame) return;
        resolveFrame = window.requestAnimationFrame(() => {
          resolveFrame = 0;
          const ids = Array.from(scheduledThreads);
          scheduledThreads.clear();
          for (const id of ids) void resolve(id);
        });
      };

      const handleRow = (row: HTMLElement) => {
        const id = row.dataset.timelineRowId;
        const parsed = id ? parseMessageRowId(id) : null;
        if (!id || !parsed) return;
        const state = threads.get(parsed.threadId);
        if (state?.times.has(id)) {
          const createdAt = state.times.get(id);
          if (createdAt != null) stamp(row, createdAt);
          return;
        }
        let rows = pending.get(parsed.threadId);
        if (!rows) pending.set(parsed.threadId, (rows = new Set()));
        rows.add(row);
        scheduleResolve(parsed.threadId);
      };

      const handleNode = (node: Node) => {
        if (!(node instanceof HTMLElement)) return;
        if (node.dataset.timelineRowId) handleRow(node);
        else if (node.hasAttribute(ITEMS_ATTR)) watch(node);
      };

      const watch = (container: Element) => {
        if (observed.has(container)) return;
        const observer = new MutationObserver((records) => {
          for (const record of records) {
            record.addedNodes.forEach(handleNode);
            record.removedNodes.forEach((node) => {
              if (node instanceof HTMLElement) stamped.delete(node);
              const removed = observed.get(node as Element);
              if (removed) {
                removed.disconnect();
                observed.delete(node as Element);
              }
            });
          }
        });
        observer.observe(container, { childList: true });
        observed.set(container, observer);
        for (const child of Array.from(container.children)) handleNode(child);
      };

      const syncLists = () => {
        for (const [container, observer] of observed) {
          if (container.isConnected) continue;
          observer.disconnect();
          observed.delete(container);
        }
        for (const row of stamped) if (!row.isConnected) stamped.delete(row);
        document.querySelectorAll(LIST_SELECTOR).forEach(watch);
      };

      const onNavigate = () => {
        for (const delay of NAV_RECHECK_DELAYS_MS) {
          const timer = window.setTimeout(() => {
            timers.delete(timer);
            syncLists();
          }, delay);
          timers.add(timer);
        }
      };

      syncLists();
      const interval = window.setInterval(syncLists, LIST_CHECK_MS);
      window.addEventListener("popstate", onNavigate, { signal });
      const navigation = (window as { navigation?: EventTarget }).navigation;
      navigation?.addEventListener("navigatesuccess", onNavigate, { signal });

      return () => {
        window.clearInterval(interval);
        for (const timer of timers) window.clearTimeout(timer);
        for (const state of threads.values()) window.clearTimeout(state.retryTimer);
        if (resolveFrame) window.cancelAnimationFrame(resolveFrame);
        for (const observer of observed.values()) observer.disconnect();
        for (const row of stamped) row.style.removeProperty(SENT_AT_VAR);
        observed.clear();
        stamped.clear();
        pending.clear();
      };
    },
  });
});
