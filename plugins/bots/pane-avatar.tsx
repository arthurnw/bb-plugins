// The thread's bot avatar in a corner of each thread pane that shows it.
//
// Which threads are on screen, and in which pane, comes from bb:
// `useSidebarSplitLayout` for splits, else the route's thread. An app overlay
// renders one avatar per pane into a host it inserts at the top of the pane's
// chat column, so layout moves the avatar with the pane (the right panel
// animates the column's width) and the column clips it.
//
// This leans on bb's DOM, which is not a public API: `[data-split-pane-id]`
// and `[data-thread-window]` (the pane and its chat column, a flex column the
// host joins as a zero-height first item) and `[data-app-composer]` (the
// bottom edge for bottom corners). If they change, avatars stop showing or
// bottom corners overlap the composer; nothing else depends on them.
import {
  experimental_useSidebarThreads as useSidebarThreads, useBbContext, useRealtime, useRpc, useSidebarSplitLayout,
  type PluginAppBuilder, type PluginRpcClient,
} from "@get-bb/plugin-sdk/app";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { remeasureAvatars } from "@arthurnw/bb-shared/avatars";
import type { AvatarCorner, Bot } from "@arthurnw/bb-shared/bots";
import type { botsContract } from "./bots-server";
import { BotAvatar, useBots } from "./bot-avatars";
import { cornerPlacement, PANE_AVATAR_MARGIN as MARGIN, PANE_AVATAR_SIZE as SIZE, paneAvatarState, type Box } from "./pane-avatar-layout";

/** Thread id → bot id (own or inherited), null for none. Cleared on every Bots change. */
const threadBots = new Map<string, string | null>();
const loading = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;
const notify = () => { version++; listeners.forEach((listener) => listener()); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

function threadBotId(rpc: PluginRpcClient<typeof botsContract>, threadId: string): string | null | undefined {
  if (threadBots.has(threadId)) return threadBots.get(threadId);
  if (!loading.has(threadId)) {
    loading.add(threadId);
    rpc.call("threadBot", { threadId }).then((result) => result.botId, () => null)
      .then((botId) => { loading.delete(threadId); threadBots.set(threadId, botId); notify(); });
  }
  return undefined;
}

/** The chat column of the pane showing a thread; `paneId` is null without a split. */
function chatColumn(paneId: string | null): Element | null {
  const pane = paneId === null ? document : document.querySelector(`[data-split-pane-id="${CSS.escape(paneId)}"]`);
  return pane?.querySelector("[data-thread-window]") ?? null;
}

const paneKeys = new WeakMap<Element, number>();
let nextPaneKey = 0;
const paneKey = (pane: Element) => paneKeys.get(pane) ?? (paneKeys.set(pane, ++nextPaneKey), nextPaneKey);

const box = (rect: DOMRect): Box => ({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });

/**
 * A zero-height, full-width first item of the chat column for the avatar to
 * sit in. Inserted outside React's view of bb's tree, and removed on unmount.
 */
function usePaneHost(pane: Element): HTMLDivElement | null {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const element = document.createElement("div");
    element.dataset.botsPaneAvatarHost = "";
    // Above the timeline and composer (z-20), below bb's popovers and dialogs (z-50).
    Object.assign(element.style, { position: "relative", flex: "none", alignSelf: "stretch", height: "0", zIndex: "30", pointerEvents: "none" });
    pane.prepend(element);
    setHost(element);
    return () => element.remove();
  }, [pane]);
  return host;
}

/**
 * The avatar's side and its offset from the pane's top. Only bottom corners
 * depend on measurements (the pane's height and the composer); they are taken
 * when the pane or composer resizes. Horizontal movement needs none.
 */
function usePlacement(pane: Element, host: HTMLElement | null, corner: AvatarCorner, onDetached: () => void) {
  const [placement, setPlacement] = useState<{ side: "left" | "right"; top: number } | null>(null);
  // The composer's last box, for bottom corners while a question card replaces it.
  const lastComposer = useRef<Box | null>(null);
  useLayoutEffect(() => {
    if (!host) return;
    let composer: Element | null = null;
    const measure = () => {
      if (!pane.isConnected) { onDetached(); return; }
      const nextComposer = pane.querySelector("[data-app-composer]");
      if (nextComposer !== composer) {
        if (composer) observer.unobserve(composer);
        if (nextComposer) observer.observe(nextComposer);
        composer = nextComposer;
      }
      if (composer) lastComposer.current = box(composer.getBoundingClientRect());
      // A pane behind a maximized sibling is aria-hidden or inert.
      const hidden = !!pane.closest("[aria-hidden=true],[inert]");
      const paneBox = { ...box(pane.getBoundingClientRect()), top: host.getBoundingClientRect().top };
      const next = hidden ? null : cornerPlacement(corner, paneBox, lastComposer.current);
      setPlacement((prev) => prev?.side === next?.side && prev?.top === next?.top ? prev : next);
      // Eye tracking caches positions; the pane moved or resized.
      remeasureAvatars();
    };
    const observer = new ResizeObserver(measure);
    observer.observe(pane);
    measure();
    return () => observer.disconnect();
  }, [pane, host, corner]);
  return placement;
}

/** True while the pointer is over `element`; the avatar itself ignores pointer events. */
function usePointerOver(element: HTMLElement | null): boolean {
  const [over, setOver] = useState(false);
  useEffect(() => {
    if (!element) return;
    const onMove = (event: PointerEvent) => {
      const r = element.getBoundingClientRect();
      const inside = event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom;
      setOver((prev) => prev === inside ? prev : inside);
    };
    addEventListener("pointermove", onMove, { passive: true });
    return () => removeEventListener("pointermove", onMove);
  }, [element]);
  return over;
}

function PaneAvatar({ bot, threadId, pane, onDetached }: { bot: Bot; threadId: string; pane: Element; onDetached: () => void }) {
  const thread = useSidebarThreads().threads.find((item) => item.id === threadId);
  const host = usePaneHost(pane);
  const placement = usePlacement(pane, host, bot.avatarCorner, onDetached);
  const [avatar, setAvatar] = useState<HTMLDivElement | null>(null);
  const over = usePointerOver(avatar);
  if (!host || !placement) return null;
  const style: CSSProperties = {
    position: "absolute", top: placement.top, [placement.side]: MARGIN, width: SIZE, height: SIZE,
    opacity: over ? 0.12 : 1, transition: "opacity 150ms ease",
    filter: "drop-shadow(0 4px 10px rgb(0 0 0 / 0.25))",
  };
  return createPortal(
    <div ref={setAvatar} data-bots-pane-avatar={threadId} aria-hidden style={style}>
      <BotAvatar bot={bot} size={SIZE} state={paneAvatarState(thread)} track />
    </div>,
    host,
  );
}

/** Mounted once as an app overlay: one avatar per visible thread pane with a bot. */
function PaneAvatars() {
  useSyncExternalStore(subscribe, () => version, () => version);
  const rpc = useRpc<typeof botsContract>();
  const bots = useBots();
  const layout = useSidebarSplitLayout();
  const { threadId: routeThreadId } = useBbContext();
  // Resolves panes again when one left the DOM without a layout change, or
  // was not in the DOM yet when the layout or route changed.
  const [, setAttempt] = useState(0);
  const onDetached = () => setAttempt((n) => n + 1);
  useRealtime("bots", () => { threadBots.clear(); notify(); });
  const shown = layout
    ? layout.panes.filter((pane) => pane.threadId).map((pane) => ({ threadId: pane.threadId!, paneId: pane.paneId as string | null }))
    : routeThreadId ? [{ threadId: routeThreadId, paneId: null }] : [];
  let missing = 0;
  const avatars = shown.map(({ threadId, paneId }) => {
    const bot = bots?.find((item) => item.id === threadBotId(rpc, threadId));
    if (!bot || bot.avatarCorner === "off") return null;
    const pane = chatColumn(paneId);
    if (!pane) { missing++; return null; }
    return <PaneAvatar key={`${paneKey(pane)}:${threadId}`} bot={bot} threadId={threadId} pane={pane} onDetached={onDetached} />;
  });
  const retries = useRef(0);
  const shownKey = shown.map((item) => `${item.paneId}:${item.threadId}`).join(",");
  useEffect(() => { retries.current = 0; }, [shownKey]);
  useEffect(() => {
    if (missing === 0 || retries.current >= 20) return;
    const timer = setTimeout(() => { retries.current++; setAttempt((n) => n + 1); }, 100);
    return () => clearTimeout(timer);
  });
  return <>{avatars}</>;
}

export function registerPaneAvatar(app: PluginAppBuilder) {
  app.slots.experimental_appOverlay({ id: "pane-avatars", component: PaneAvatars });
}
