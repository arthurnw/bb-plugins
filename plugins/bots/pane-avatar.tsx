// Prototype: the thread's bot avatar floating in a corner of its thread pane.
//
// The context row above the composer mounts once per thread pane, so its
// segment is the per-pane anchor: it registers which pane shows which thread.
// An app overlay draws every registered avatar in a fixed-position portal on
// <body> over its pane's corner.
//
// Finding the pane leans on bb's own DOM, which is not a public API:
// `[data-thread-window]` (the chat column), `[data-split-pane-id]` (fallback),
// `[data-app-composer]` (bottom edge), and `[data-timeline-row-id]`, whose
// values start with `<threadId>:`. bb replaces the composer, context row
// included, with the question or approval card while a thread waits, which
// unmounts the segment; the overlay keeps the avatar while that pane's
// timeline rows still belong to the same thread.
import { experimental_useSidebarThreads as useSidebarThreads, useRealtime, useRpc, type PluginAppBuilder, type PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { useEffect, useState, useSyncExternalStore, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { remeasureAvatars, threadAvatarState, type AvatarState } from "@arthurnw/bb-shared/avatars";
import type { botsContract } from "./bots-server";
import { BotAvatar, useBots } from "./bot-avatars";

const SIZE = 96;
const MARGIN = 12;
const CORNERS = ["top-right", "bottom-right", "bottom-left", "top-left", "off"] as const;
type Corner = (typeof CORNERS)[number];
const ARROWS: Record<Corner, string> = { "top-right": "↗", "bottom-right": "↘", "bottom-left": "↙", "top-left": "↖", off: "∅" };

// One store for corners and pane registrations, read with useSyncExternalStore.
const listeners = new Set<() => void>();
let version = 0;
const notify = () => { version++; listeners.forEach((listener) => listener()); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const useStoreVersion = () => useSyncExternalStore(subscribe, () => version, () => version);

// Per bot, per browser profile; a real version belongs in bot settings.
const cornerKey = (botId: string) => `bb-bots:pane-avatar-corner:${botId}`;
function readCorner(botId: string): Corner {
  const value = localStorage.getItem(cornerKey(botId));
  return (CORNERS as readonly string[]).includes(value ?? "") ? value as Corner : "top-right";
}
function cycleCorner(botId: string) {
  localStorage.setItem(cornerKey(botId), CORNERS[(CORNERS.indexOf(readCorner(botId)) + 1) % CORNERS.length]!);
  notify();
}

interface PaneEntry { threadId: string; botId: string; mounted: boolean }
/** Pane element → the thread its context row last reported. */
const panes = new Map<Element, PaneEntry>();

const paneKeys = new WeakMap<Element, number>();
let nextPaneKey = 0;
const paneKey = (pane: Element) => paneKeys.get(pane) ?? (paneKeys.set(pane, ++nextPaneKey), nextPaneKey);

const findPane = (from: Element) => from.closest("[data-thread-window]") ?? from.closest("[data-split-pane-id]");

/** Whether `pane` still shows `threadId`, judged by its timeline rows. */
const paneShows = (pane: Element, threadId: string) =>
  pane.isConnected && !!pane.querySelector(`[data-timeline-row-id^="${CSS.escape(threadId)}:"]`);

function prune() {
  let changed = false;
  for (const [pane, entry] of panes) {
    if (!pane.isConnected || (!entry.mounted && !paneShows(pane, entry.threadId))) { panes.delete(pane); changed = true; }
  }
  if (changed) notify();
}

/** Thread id → bot id (null for none) for threads found by `scan`; a pending lookup is absent. */
const scannedBots = new Map<string, string | null>();
const lookups = new Set<string>();

/**
 * Picks up thread panes whose context row is not mounted, such as a thread
 * opened while it already waits on a question. The thread id comes from the
 * pane's timeline rows.
 */
function scan(threadBot: (threadId: string) => Promise<string | null>) {
  let changed = false;
  for (const pane of document.querySelectorAll("[data-thread-window]")) {
    if (panes.has(pane)) continue;
    const threadId = pane.querySelector<HTMLElement>("[data-timeline-row-id]")?.dataset.timelineRowId?.split(":")[0];
    if (!threadId?.startsWith("thr_")) continue;
    const botId = scannedBots.get(threadId);
    if (botId) { panes.set(pane, { threadId, botId, mounted: false }); changed = true; }
    else if (botId === undefined && !lookups.has(threadId)) {
      lookups.add(threadId);
      threadBot(threadId).then((id) => scannedBots.set(threadId, id), () => scannedBots.set(threadId, null)).finally(() => lookups.delete(threadId));
    }
  }
  if (changed) notify();
}

/** The thread's bot id, own or inherited; null without one, undefined while loading. */
function useThreadBotId(threadId: string): string | null | undefined {
  const rpc = useRpc<typeof botsContract>();
  const [botId, setBotId] = useState<string | null | undefined>(undefined);
  const load = () => { rpc.call("threadBot", { threadId }).then((result) => setBotId(result.botId), () => setBotId(null)); };
  useEffect(load, [rpc, threadId]);
  useRealtime("bots", load);
  return botId;
}

/** The context row segment: registers its pane and offers the corner toggle. */
function PaneAvatarChip({ threadId }: { threadId: string }) {
  useStoreVersion();
  const botId = useThreadBotId(threadId);
  const bot = useBots()?.find((item) => item.id === botId) ?? null;
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const pane = anchor && findPane(anchor);
    if (!pane || !bot) return;
    panes.set(pane, { threadId, botId: bot.id, mounted: true });
    notify();
    return () => {
      const entry = panes.get(pane);
      if (entry?.threadId === threadId) { entry.mounted = false; prune(); }
    };
  }, [anchor, bot?.id, threadId]);
  if (!bot) return null;
  const corner = readCorner(bot.id);
  return (
    <button ref={setAnchor} type="button" onClick={() => cycleCorner(bot.id)} title={`${bot.name}'s avatar: ${corner}. Click to move it.`}
      aria-label={`Move ${bot.name}'s avatar (now ${corner})`}
      style={{ display: "inline-flex", alignItems: "center", gap: 4, border: "none", background: "transparent", color: "var(--muted-foreground)", fontSize: 12, padding: 0, cursor: "pointer" }}>
      <BotAvatar bot={bot} size={14} />
      <span aria-hidden>{ARROWS[corner]}</span>
    </button>
  );
}

interface Placement { left: number; top: number }

/** Where the avatar goes for `corner` of `pane`, in viewport coordinates; null to hide. */
function place(pane: Element, corner: Corner, lastBottom: number | null): Placement & { bottom: number } | null {
  if (corner === "off") return null;
  const rect = pane.getBoundingClientRect();
  // A pane behind a maximized sibling has no size or is aria-hidden.
  if (rect.width < SIZE + MARGIN * 2 || rect.height < SIZE + MARGIN * 2 || pane.closest("[aria-hidden=true],[inert]")) return null;
  const left = corner.endsWith("left") ? rect.left + MARGIN : rect.right - MARGIN - SIZE;
  // The composer (with the context row and queue) is a centered column; a
  // bottom corner sits above it only where the two would overlap. While a
  // question card replaces the composer, the last known edge is kept.
  const composer = pane.querySelector("[data-app-composer]")?.getBoundingClientRect();
  const overlaps = composer ? left < composer.right && left + SIZE > composer.left : true;
  const bottom = !overlaps ? rect.bottom : composer ? composer.top : lastBottom ?? rect.bottom;
  const top = corner.startsWith("top") ? rect.top + MARGIN : bottom - MARGIN - SIZE;
  return { left, top, bottom };
}

function usePlacement(pane: Element, corner: Corner): Placement | null {
  const [placement, setPlacement] = useState<Placement | null>(null);
  useEffect(() => {
    let frame = 0;
    let lastBottom: number | null = null;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = place(pane, corner, lastBottom);
        if (next && pane.querySelector("[data-app-composer]")) lastBottom = next.bottom;
        setPlacement((prev) => prev?.left === next?.left && prev?.top === next?.top ? prev : next && { left: next.left, top: next.top });
        remeasureAvatars();
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(pane);
    observer.observe(document.body);
    // Children change size when the composer grows or the question card swaps in.
    const mutations = new MutationObserver(update);
    mutations.observe(pane, { childList: true, subtree: true });
    addEventListener("resize", update);
    // Panes can move without resizing (a sibling closes, the sidebar toggles).
    const poll = setInterval(update, 500);
    return () => { observer.disconnect(); mutations.disconnect(); removeEventListener("resize", update); clearInterval(poll); cancelAnimationFrame(frame); };
  }, [pane, corner]);
  return placement;
}

/** True while the pointer is over the avatar; the avatar itself ignores pointer events. */
function usePointerOver(placement: Placement | null): boolean {
  const [over, setOver] = useState(false);
  useEffect(() => {
    if (!placement) { setOver(false); return; }
    const { left, top } = placement;
    const onMove = (event: PointerEvent) => {
      setOver(event.clientX >= left && event.clientX <= left + SIZE && event.clientY >= top && event.clientY <= top + SIZE);
    };
    addEventListener("pointermove", onMove, { passive: true });
    return () => removeEventListener("pointermove", onMove);
  }, [placement]);
  return over;
}

const WORKING = new Set(["starting", "active", "stopping"]);
/** The pane shows this thread, so a running turn outranks unread. */
function paneState(thread: PluginSidebarThread | undefined): AvatarState {
  if (!thread) return "idle";
  if (!thread.hasPendingInteraction && WORKING.has(thread.status)) return "working";
  return threadAvatarState(thread);
}

function FloatingAvatar({ pane, entry, thread }: { pane: Element; entry: PaneEntry; thread: PluginSidebarThread | undefined }) {
  const bot = useBots()?.find((item) => item.id === entry.botId) ?? null;
  const placement = usePlacement(pane, readCorner(entry.botId));
  const over = usePointerOver(placement);
  if (!bot || !placement) return null;
  const style: CSSProperties = {
    position: "fixed", left: placement.left, top: placement.top, width: SIZE, height: SIZE,
    // Above the timeline and composer (z-20), below bb's popovers and dialogs (z-50).
    zIndex: 30, pointerEvents: "none",
    opacity: over ? 0.12 : 1, transition: "opacity 150ms ease, left 200ms ease, top 200ms ease",
    filter: "drop-shadow(0 4px 10px rgb(0 0 0 / 0.25))",
  };
  return createPortal(
    <div data-bots-pane-avatar={entry.threadId} aria-hidden style={style}>
      <BotAvatar bot={bot} size={SIZE} state={paneState(thread)} track />
    </div>,
    document.body,
  );
}

/** Mounted once in the app overlay; draws an avatar for every registered pane. */
export function PaneAvatars() {
  useStoreVersion();
  const threads = useSidebarThreads().threads;
  const rpc = useRpc<typeof botsContract>();
  useRealtime("bots", () => { scannedBots.clear(); });
  useEffect(() => {
    const poll = setInterval(() => { prune(); scan((threadId) => rpc.call("threadBot", { threadId }).then((result) => result.botId)); }, 500);
    return () => clearInterval(poll);
  }, [rpc]);
  return <>{[...panes].map(([pane, entry]) =>
    <FloatingAvatar key={`${paneKey(pane)}:${entry.threadId}`} pane={pane} entry={entry}
      thread={threads.find((item) => item.id === entry.threadId)} />)}</>;
}

export function registerPaneAvatar(app: PluginAppBuilder) {
  app.slots.experimental_threadContextSegment({
    id: "pane-avatar",
    title: "Bot avatar",
    group: "9_bots",
    summary: ({ threadId }) => <PaneAvatarChip threadId={threadId} />,
    useVisible: ({ threadId }) => !!useThreadBotId(threadId),
  });
  app.slots.experimental_appOverlay({ id: "pane-avatars", component: PaneAvatars });
}
