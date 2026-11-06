// The thread's bot avatar floating in a corner of each thread pane that shows it.
//
// Which threads are on screen, and in which pane, comes from bb:
// `useSidebarSplitLayout` for splits, else the route's thread. An app overlay
// draws each avatar in a fixed-position portal on <body> over its pane.
// The context row segment adds a chip that cycles the bot's corner, and tells
// the overlay the exact element of its pane.
//
// Measuring a pane uses bb's DOM, which is not a public API:
// `[data-split-pane-id]` and `[data-thread-window]` (the pane and its chat
// column) and `[data-app-composer]` (the bottom edge for bottom corners). If
// they change, avatars stop showing or bottom corners overlap the composer;
// nothing else depends on them.
import {
  experimental_useSidebarThreads as useSidebarThreads, useBbContext, useRealtime, useRpc, useSidebarSplitLayout,
  type PluginAppBuilder, type PluginRpcClient,
} from "@get-bb/plugin-sdk/app";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { remeasureAvatars } from "@arthurnw/bb-shared/avatars";
import { botDraft, type AvatarCorner, type Bot } from "@arthurnw/bb-shared/bots";
import type { botsContract } from "./bots-server";
import { BotAvatar, useBots } from "./bot-avatars";
import { cornerPosition, nextCorner, PANE_AVATAR_SIZE as SIZE, paneAvatarState, type Box } from "./pane-avatar-layout";

const ARROWS: Record<AvatarCorner, string> = { "top-right": "↗", "bottom-right": "↘", "bottom-left": "↙", "top-left": "↖", off: "∅" };
const CORNER_NAMES: Record<AvatarCorner, string> = { "top-right": "top right", "bottom-right": "bottom right", "bottom-left": "bottom left", "top-left": "top left", off: "off" };

// One small store: each thread's bot, and the chat column each mounted chip sits in.
const listeners = new Set<() => void>();
let version = 0;
const notify = () => { version++; listeners.forEach((listener) => listener()); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const useStoreVersion = () => useSyncExternalStore(subscribe, () => version, () => version);

/** Thread id → bot id (own or inherited), null for none. Cleared on every Bots change. */
const threadBots = new Map<string, string | null>();
const loading = new Set<string>();
function threadBotId(rpc: PluginRpcClient<typeof botsContract>, threadId: string): string | null | undefined {
  if (threadBots.has(threadId)) return threadBots.get(threadId);
  if (!loading.has(threadId)) {
    loading.add(threadId);
    rpc.call("threadBot", { threadId }).then((result) => result.botId, () => null)
      .then((botId) => { loading.delete(threadId); threadBots.set(threadId, botId); notify(); });
  }
  return undefined;
}
function useThreadBotId(threadId: string): string | null | undefined {
  useStoreVersion();
  return threadBotId(useRpc<typeof botsContract>(), threadId);
}

/** Thread id → the chat column its context row chip is in, while the chip is mounted. */
const chipPanes = new Map<string, Element>();

/** The chat column of the pane showing `threadId`. */
function paneElement(threadId: string, paneId: string | null): Element | null {
  const fromChip = chipPanes.get(threadId);
  if (fromChip?.isConnected) return fromChip;
  // The chip unmounts while a question or approval card replaces the composer.
  const pane = paneId === null ? document : document.querySelector(`[data-split-pane-id="${CSS.escape(paneId)}"]`);
  return pane?.querySelector("[data-thread-window]") ?? (pane instanceof Element ? pane : null);
}

/** The context row segment: cycles the bot's corner and reports its pane. */
function CornerChip({ threadId }: { threadId: string }) {
  const rpc = useRpc<typeof botsContract>();
  const botId = useThreadBotId(threadId);
  const bot = useBots()?.find((item) => item.id === botId) ?? null;
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const pane = anchor?.closest("[data-thread-window]");
    if (!pane) return;
    chipPanes.set(threadId, pane);
    notify();
    return () => { if (chipPanes.get(threadId) === pane) { chipPanes.delete(threadId); notify(); } };
  }, [anchor, threadId]);
  if (!bot) return null;
  const next = nextCorner(bot.avatarCorner);
  const cycle = () => {
    setError(null);
    rpc.call("saveBot", { botId: bot.id, bot: { ...botDraft(bot), avatarCorner: next } })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };
  return (
    <button ref={setAnchor} type="button" onClick={cycle}
      title={error ?? `${bot.name}'s avatar: ${CORNER_NAMES[bot.avatarCorner]}. Click for ${CORNER_NAMES[next]}; set it in Bots settings.`}
      aria-label={`Move ${bot.name}'s avatar to ${CORNER_NAMES[next]}`}
      style={{ display: "inline-flex", alignItems: "center", gap: 4, border: "none", background: "transparent", color: error ? "var(--destructive, #e5484d)" : "var(--muted-foreground)", fontSize: 12, padding: 0, cursor: "pointer" }}>
      <BotAvatar bot={bot} size={14} />
      <span aria-hidden>{ARROWS[bot.avatarCorner]}</span>
    </button>
  );
}

const box = (rect: DOMRect): Box => ({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });

/**
 * Keeps the avatar on its corner. Measures when the pane or its composer
 * resizes, the window resizes, or `layoutKey` changes (panes added, closed,
 * moved, or a chip mounting); nothing runs while a turn streams.
 */
function usePlacement(pane: Element, corner: AvatarCorner, layoutKey: string, onDetached: () => void) {
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  // The composer's last box, for bottom corners while a question card replaces it.
  const lastComposer = useRef<Box | null>(null);
  useLayoutEffect(() => {
    let frame = 0;
    let composer: Element | null = null;
    const observer = new ResizeObserver(() => schedule());
    const measure = () => {
      if (!pane.isConnected) { onDetached(); return; }
      const nextComposer = pane.querySelector("[data-app-composer]");
      if (nextComposer !== composer) {
        if (composer) observer.unobserve(composer);
        if (nextComposer) observer.observe(nextComposer);
        composer = nextComposer;
      }
      // A pane behind a maximized sibling is aria-hidden or inert.
      const hidden = !!pane.closest("[aria-hidden=true],[inert]");
      if (composer) lastComposer.current = box(composer.getBoundingClientRect());
      const next = hidden ? null : cornerPosition(corner, box(pane.getBoundingClientRect()), lastComposer.current);
      setPosition((prev) => prev?.left === next?.left && prev?.top === next?.top ? prev : next);
      remeasureAvatars();
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    observer.observe(pane);
    addEventListener("resize", schedule);
    measure();
    return () => { observer.disconnect(); removeEventListener("resize", schedule); cancelAnimationFrame(frame); };
  }, [pane, corner, layoutKey]);
  return position;
}

/** True while the pointer is over the avatar; the avatar itself ignores pointer events. */
function usePointerOver(position: { left: number; top: number } | null): boolean {
  const [over, setOver] = useState(false);
  useEffect(() => {
    setOver(false);
    if (!position) return;
    const { left, top } = position;
    const onMove = (event: PointerEvent) => {
      const inside = event.clientX >= left && event.clientX <= left + SIZE && event.clientY >= top && event.clientY <= top + SIZE;
      setOver((prev) => prev === inside ? prev : inside);
    };
    addEventListener("pointermove", onMove, { passive: true });
    return () => removeEventListener("pointermove", onMove);
  }, [position]);
  return over;
}

function FloatingAvatar({ bot, threadId, pane, layoutKey, onDetached }: { bot: Bot; threadId: string; pane: Element; layoutKey: string; onDetached: () => void }) {
  const thread = useSidebarThreads().threads.find((item) => item.id === threadId);
  const position = usePlacement(pane, bot.avatarCorner, layoutKey, onDetached);
  const over = usePointerOver(position);
  if (!position) return null;
  const style: CSSProperties = {
    position: "fixed", left: position.left, top: position.top, width: SIZE, height: SIZE,
    // Above the timeline and composer (z-20), below bb's popovers and dialogs (z-50).
    zIndex: 30, pointerEvents: "none",
    opacity: over ? 0.12 : 1, transition: "opacity 150ms ease, left 200ms ease, top 200ms ease",
    filter: "drop-shadow(0 4px 10px rgb(0 0 0 / 0.25))",
  };
  return createPortal(
    <div data-bots-pane-avatar={threadId} aria-hidden style={style}>
      <BotAvatar bot={bot} size={SIZE} state={paneAvatarState(thread)} track />
    </div>,
    document.body,
  );
}

/** Mounted once as an app overlay: one avatar per visible thread pane with a bot. */
function PaneAvatars() {
  useStoreVersion();
  const rpc = useRpc<typeof botsContract>();
  const bots = useBots();
  const layout = useSidebarSplitLayout();
  const { threadId: routeThreadId } = useBbContext();
  // Re-resolves panes when one the overlay measured left the DOM.
  const [detached, setDetached] = useState(0);
  const onDetached = () => setDetached((n) => n + 1);
  useRealtime("bots", () => { threadBots.clear(); notify(); });
  const shown = layout
    ? layout.panes.filter((pane) => pane.threadId).map((pane) => ({ threadId: pane.threadId!, paneId: pane.paneId as string | null }))
    : routeThreadId ? [{ threadId: routeThreadId, paneId: null }] : [];
  const layoutKey = `${detached}|${[...chipPanes.keys()].join(",")}|${shown.map((item) => `${item.paneId}:${item.threadId}`).join(",")}|${layout?.panes.map((pane) => `${pane.rect.x},${pane.rect.y}`).join(";") ?? ""}`;
  return <>{shown.map(({ threadId, paneId }) => {
    const bot = bots?.find((item) => item.id === threadBotId(rpc, threadId));
    const pane = bot && paneElement(threadId, paneId);
    return bot && pane && <FloatingAvatar key={`${paneId}:${threadId}`} bot={bot} threadId={threadId} pane={pane} layoutKey={layoutKey} onDetached={onDetached} />;
  })}</>;
}

export function registerPaneAvatar(app: PluginAppBuilder) {
  app.slots.experimental_threadContextSegment({
    id: "pane-avatar",
    title: "Bot avatar",
    group: "9_bots",
    summary: ({ threadId }) => <CornerChip threadId={threadId} />,
    useVisible: ({ threadId }) => !!useThreadBotId(threadId),
  });
  app.slots.experimental_appOverlay({ id: "pane-avatars", component: PaneAvatars });
}
