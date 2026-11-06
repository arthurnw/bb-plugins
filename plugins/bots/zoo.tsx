// The bot zoo: every bot's animated avatar in one place, floating as a
// draggable card or docked as a strip along the bottom of bb's right panel.
//
// Docking leans on bb's DOM, which is not a public API (the SDK has no hook
// for the right panel's open state or bounds). The right panel is the
// react-resizable-panels panel `[data-panel-id^="thread-detail-secondary-panel"]`
// (`-pane-N` is appended in split layouts, where one panel serves the focused
// pane). On thread routes it stays mounted at width 0 while closed; elsewhere
// a placeholder replaces it or it is gone. Its only child is an absolutely
// positioned `aside`, a full-height flex column, and the strip joins that
// column as a `flex: none` last item so the panel's content shrinks above it.
// React may append its own children after the strip, so the strip moves
// itself back to the end. If these change, the zoo stays floating; nothing
// else depends on them.
import {
  experimental_useSidebarThreads as useSidebarThreads, ThreadTitle, useBbContext, useBbNavigate, useSidebarSplitLayout,
  type PluginAppBuilder, type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent, type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { liveThread, remeasureAvatars, threadAvatarState, type AvatarState } from "@arthurnw/bb-shared/avatars";
import type { Bot } from "@arthurnw/bb-shared/bots";
import { openNewThread } from "@arthurnw/bb-shared/events";
import { BotAvatar, useBots, useBotStates, useThreadBots } from "./bot-avatars";
import {
  anchorFromRect, attentionCount, botSummary, cardColumns, clamp, loudest, rankBots, rectFromAnchor, snap, threadsByUrgency,
  type Point, type Size,
} from "./zoo-layout";
import { setZooPlacement, useZooPlacement, useZooSettings } from "./zoo-settings";

const CARD_FACE = 44;
const STRIP_FACE = 40;
const COLLAPSED_FACE = 48;
const DRAG_THRESHOLD = 4;
const PANEL = '[data-panel-id^="thread-detail-secondary-panel"]';
const WIDE = "(min-width: 46rem)";
const STATE_COLORS: Record<AvatarState, string> = { waiting: "#f5a524", unread: "#ff5d7a", working: "#4ea1ff", idle: "transparent" };

interface Entry { bot: Bot; state: AvatarState; threads: PluginSidebarThread[]; inView: boolean }

function useWideWindow() {
  const [wide, setWide] = useState(() => matchMedia(WIDE).matches);
  useEffect(() => {
    const media = matchMedia(WIDE);
    const update = () => setWide(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return wide;
}

const viewport = (): Size => ({ width: innerWidth, height: innerHeight });

function useViewport() {
  const [size, setSize] = useState(viewport);
  useEffect(() => {
    const update = () => setSize(viewport());
    addEventListener("resize", update);
    return () => removeEventListener("resize", update);
  }, []);
  return size;
}

/** The right panel's `aside` while the panel is open, else null. Looks again on every DOM change and panel resize. */
function useRightPanel(enabled: boolean): Element | null {
  const [aside, setAside] = useState<Element | null>(null);
  useEffect(() => {
    if (!enabled) { setAside(null); return; }
    let frame = 0;
    const watched = new Set<Element>();
    const find = () => {
      frame = 0;
      const panels = [...document.querySelectorAll(PANEL)];
      for (const panel of panels) if (!watched.has(panel)) { watched.add(panel); resizes.observe(panel); }
      for (const panel of watched) if (!panel.isConnected) { watched.delete(panel); resizes.unobserve(panel); }
      const open = panels.find((panel) => panel.getBoundingClientRect().width > 0);
      const next = open?.querySelector(":scope > aside") ?? null;
      setAside((prev) => prev === next ? prev : next);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(find); };
    const resizes = new ResizeObserver(schedule);
    const mutations = new MutationObserver(schedule);
    mutations.observe(document.body, { childList: true, subtree: true });
    find();
    return () => { cancelAnimationFrame(frame); mutations.disconnect(); resizes.disconnect(); };
  }, [enabled]);
  return aside;
}

/** A host for the strip, kept as the aside's last child. */
function useStripHost(aside: Element): HTMLDivElement | null {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const element = document.createElement("div");
    element.dataset.botsZooStrip = "";
    Object.assign(element.style, {
      flex: "none", display: "flex", flexWrap: "wrap", gap: "8px", padding: "8px", borderTop: "1px solid var(--border)",
    } satisfies Partial<CSSStyleDeclaration>);
    aside.append(element);
    const keepLast = new MutationObserver(() => { if (aside.lastElementChild !== element) aside.append(element); });
    keepLast.observe(aside, { childList: true });
    setHost(element);
    return () => { keepLast.disconnect(); element.remove(); };
  }, [aside]);
  return host;
}

/** Ids of the threads showing in visible panes, as the pane avatars resolve them. */
function useVisibleThreadIds(): string[] {
  const layout = useSidebarSplitLayout();
  const { threadId } = useBbContext();
  // The split layout outlives thread routes (it is still reported on settings pages), so no thread route means no panes.
  if (!threadId) return [];
  return layout ? layout.panes.flatMap((pane) => pane.threadId ? [pane.threadId] : []) : [threadId];
}

function useEntries(bots: readonly Bot[] | null): Entry[] {
  const states = useBotStates();
  const threadBots = useThreadBots();
  const { threads } = useSidebarThreads();
  // A new array each render; its key keeps the memo stable.
  const visibleKey = useVisibleThreadIds().join(",");
  return useMemo(() => {
    const byBot = new Map<string, PluginSidebarThread[]>();
    for (const thread of threads) {
      const botId = threadBots[thread.id];
      if (botId && liveThread(thread)) byBot.set(botId, [...(byBot.get(botId) ?? []), thread]);
    }
    const inView = new Set(visibleKey.split(",").map((id) => threadBots[id]).filter(Boolean));
    return rankBots(bots ?? [], states).map(({ bot, state }) => ({
      bot, state, threads: threadsByUrgency(byBot.get(bot.id) ?? []), inView: inView.has(bot.id),
    }));
  }, [bots, states, threadBots, threads, visibleKey]);
}

/** A fixed-position popup beside `anchor`: below or above it, flipped to stay in the window. */
function Popup({ anchor, prefer, children, style, popupRef }: {
  anchor: Element; prefer: "above" | "below"; children: ReactNode; style?: CSSProperties; popupRef?: (element: HTMLDivElement | null) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [point, setPoint] = useState<Point | null>(null);
  useLayoutEffect(() => {
    const popup = ref.current;
    if (!popup) return;
    const a = anchor.getBoundingClientRect(), p = popup.getBoundingClientRect(), gap = 6, edge = 8;
    const fitsBelow = a.bottom + gap + p.height <= innerHeight - edge;
    const fitsAbove = a.top - gap - p.height >= edge;
    const below = prefer === "below" ? fitsBelow || !fitsAbove : !fitsAbove && fitsBelow;
    const top = below ? a.bottom + gap : a.top - gap - p.height;
    // Menus start at the avatar's left edge and flip left; tooltips center on it.
    let left = prefer === "below" ? a.left : a.left + a.width / 2 - p.width / 2;
    if (prefer === "below" && left + p.width > innerWidth - edge) left = a.right - p.width;
    setPoint({ left: Math.max(edge, Math.min(left, innerWidth - edge - p.width)), top: Math.max(edge, top) });
  }, [anchor, prefer, children]);
  return createPortal(
    <div ref={(element) => { ref.current = element; popupRef?.(element); }}
      style={{ position: "fixed", zIndex: 40, left: point?.left ?? 0, top: point?.top ?? 0, visibility: point ? "visible" : "hidden", ...style }}>
      {children}
    </div>,
    document.body,
  );
}

function ThreadMenu({ entry, anchor, onClose }: { entry: Entry; anchor: Element; onClose: () => void }) {
  const navigate = useBbNavigate();
  const { projectId } = useBbContext();
  const menu = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !anchor.contains(target)) onClose();
    };
    addEventListener("keydown", onKey);
    addEventListener("pointerdown", onDown, true);
    return () => { removeEventListener("keydown", onKey); removeEventListener("pointerdown", onDown, true); };
  }, [anchor, onClose]);
  const { bot } = entry;
  return (
    <Popup anchor={anchor} prefer="below" popupRef={(element) => { menu.current = element; }} style={popupBox}>
      <div role="menu" aria-label={`${bot.name}'s threads`} style={{ display: "flex", flexDirection: "column", width: 260, maxHeight: 320, overflowY: "auto", padding: 4 }}>
        {entry.threads.map((thread) => {
          const state = threadAvatarState(thread);
          return (
            <button key={thread.id} type="button" role="menuitem" style={menuRow} onClick={() => { onClose(); navigate.toThread(thread.id); }}>
              <span aria-label={state} style={{ ...dot, background: STATE_COLORS[state], borderColor: state === "idle" ? "var(--border)" : STATE_COLORS[state] }} />
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: thread.isUnread ? 600 : 400 }}>
                <ThreadTitle threadId={thread.id} />
              </span>
            </button>
          );
        })}
        {entry.threads.length > 0 && <div role="separator" style={{ height: 1, margin: "4px 0", background: "var(--border)" }} />}
        <button type="button" role="menuitem" style={menuRow}
          onClick={() => { onClose(); openNewThread({ projectId: bot.projectId ?? projectId, botId: bot.id }); }}>
          <span aria-hidden style={{ ...dot, border: "none", textAlign: "center", lineHeight: "8px" }}>+</span>
          <span>New thread with {bot.name}</span>
        </button>
      </div>
    </Popup>
  );
}

function ZooFace({ entry, size, menuOpen, onToggleMenu }: { entry: Entry; size: number; menuOpen: boolean; onToggleMenu: (anchor: Element) => void }) {
  const [hover, setHover] = useState<HTMLButtonElement | null>(null);
  const summary = botSummary(entry.bot.name, entry.threads);
  return (
    <>
      <button type="button" aria-label={summary} aria-haspopup="menu" aria-expanded={menuOpen} data-bots-zoo-face={entry.bot.id}
        onPointerEnter={(event) => setHover(event.currentTarget)} onPointerLeave={() => setHover(null)} onPointerDown={() => setHover(null)}
        onClick={(event) => { setHover(null); onToggleMenu(event.currentTarget); }}
        style={{ ...faceButton, background: menuOpen ? "var(--accent)" : "transparent", opacity: entry.state === "idle" ? 0.45 : 1 }}>
        <span style={{ display: "block", width: size, height: size, borderRadius: "50%", boxShadow: entry.inView ? "0 0 0 2px var(--ring, var(--primary))" : "none" }}>
          <BotAvatar bot={entry.bot} size={size} state={entry.state} track />
        </span>
      </button>
      {hover && !menuOpen && (
        <Popup anchor={hover} prefer="above" style={{ ...popupBox, padding: "4px 8px", fontSize: 12, whiteSpace: "nowrap", pointerEvents: "none" }}>
          {summary}
        </Popup>
      )}
    </>
  );
}

function useMenu(entries: Entry[]) {
  const [menu, setMenu] = useState<{ botId: string; anchor: Element } | null>(null);
  const entry = menu && entries.find((item) => item.bot.id === menu.botId);
  const toggle = (botId: string) => (anchor: Element) => setMenu((current) => current?.botId === botId ? null : { botId, anchor });
  const close = useCallback(() => setMenu(null), []);
  const element = entry && menu?.anchor.isConnected ? <ThreadMenu entry={entry} anchor={menu.anchor} onClose={close} /> : null;
  return { openBotId: menu?.botId ?? null, toggle, close, element };
}

function ZooStrip({ aside, entries }: { aside: Element; entries: Entry[] }) {
  const host = useStripHost(aside);
  const menu = useMenu(entries);
  useEffect(() => { requestAnimationFrame(remeasureAvatars); }, [host]);
  if (!host) return null;
  return (
    <>
      {createPortal(entries.map((entry) => (
        <ZooFace key={entry.bot.id} entry={entry} size={STRIP_FACE} menuOpen={menu.openBotId === entry.bot.id} onToggleMenu={menu.toggle(entry.bot.id)} />
      )), host)}
      {menu.element}
    </>
  );
}

function ZooCard({ entries }: { entries: Entry[] }) {
  const { anchor, collapsed } = useZooPlacement();
  const view = useViewport();
  const card = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<Size | null>(null);
  const [live, setLive] = useState<Point | null>(null);
  const suppressClick = useRef(false);
  const menu = useMenu(entries);

  useLayoutEffect(() => {
    const element = card.current;
    if (!element) return;
    const measure = () => {
      const next = { width: element.offsetWidth, height: element.offsetHeight };
      setSize((prev) => prev?.width === next.width && prev.height === next.height ? prev : next);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, []);
  const point = live ?? (size ? rectFromAnchor(anchor, size, view) : null);
  useEffect(() => { requestAnimationFrame(remeasureAvatars); }, [point?.left, point?.top, collapsed]);

  const save = (next: Point) => { if (size) setZooPlacement({ anchor: anchorFromRect(next, size, viewport()) }); };

  // Pointer moves are followed on the window from pointer down, so a fast
  // first move that leaves the card before the drag starts is not lost.
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    suppressClick.current = false;
    if (event.button !== 0 || !point || !size || (event.target as Element).closest("[data-zoo-nodrag]")) return;
    const element = event.currentTarget, { pointerId, clientX: x, clientY: y } = event, start = point, cardSize = size;
    let moved = false, last = start;
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      const dx = e.clientX - x, dy = e.clientY - y;
      if (!moved) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        moved = true;
        menu.close();
        // Captured only once it is a drag, so a plain click still reaches the avatar under the pointer.
        element.setPointerCapture(pointerId);
      }
      last = clamp({ left: start.left + dx, top: start.top + dy }, cardSize, viewport());
      setLive(last);
      remeasureAvatars();
    };
    const end = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", end);
      removeEventListener("pointercancel", end);
      if (!moved) return;
      suppressClick.current = true;
      if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
      save(snap(last, cardSize, viewport()));
      setLive(null);
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", end);
    addEventListener("pointercancel", end);
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || !point || !size) return;
    const step = event.shiftKey ? 32 : 8;
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
    if (!delta) return;
    event.preventDefault();
    save(clamp({ left: point.left + delta[0]!, top: point.top + delta[1]! }, size, viewport()));
  };

  const loud = loudest(entries);
  const attention = attentionCount(entries);
  const columns = cardColumns(entries.length);
  const style: CSSProperties = {
    ...cardBox, left: point?.left ?? 0, top: point?.top ?? 0, visibility: point ? "visible" : "hidden",
    cursor: live ? "grabbing" : "default", padding: collapsed ? 6 : 8,
  };

  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 35, pointerEvents: "none" }} data-bots-zoo="">
      <div ref={card} role="group" tabIndex={0} aria-label="Bot zoo. Arrow keys move it." style={style}
        onPointerDown={onPointerDown}
        onClickCapture={(event) => { if (suppressClick.current) { suppressClick.current = false; event.stopPropagation(); event.preventDefault(); } }}
        onKeyDown={onKeyDown}>
        {collapsed ? (
          loud && (
            <button type="button" aria-label={`Show the bot zoo. ${botSummary(loud.bot.name, loud.threads)}`} style={{ ...faceButton, position: "relative" }}
              onClick={() => setZooPlacement({ collapsed: false })}>
              <BotAvatar bot={loud.bot} size={COLLAPSED_FACE} state={loud.state} track />
              {attention > 0 && <span style={badge}>{attention}</span>}
            </button>
          )
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 2px 6px 4px", fontSize: 12, userSelect: "none" }}>
              <span style={{ flex: 1, fontWeight: 600 }}>
                Bots{attention > 0 && <span style={{ fontWeight: 400, color: "var(--muted-foreground)" }}> · {attention} need you</span>}
              </span>
              <button type="button" data-zoo-nodrag="" aria-label="Collapse the bot zoo" title="Collapse"
                onClick={() => { menu.close(); setZooPlacement({ collapsed: true }); }} style={collapseButton}>–</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${columns}, auto)`, gap: 2, justifyContent: "start" }}>
              {entries.map((entry) => (
                <ZooFace key={entry.bot.id} entry={entry} size={CARD_FACE} menuOpen={menu.openBotId === entry.bot.id} onToggleMenu={menu.toggle(entry.bot.id)} />
              ))}
            </div>
          </>
        )}
      </div>
      {menu.element}
    </div>,
    document.body,
  );
}

function ZooBody({ dock }: { dock: boolean }) {
  const bots = useBots();
  const wide = useWideWindow();
  const aside = useRightPanel(dock && wide);
  const entries = useEntries(bots);
  if (!wide || !bots?.length) return null;
  return aside ? <ZooStrip key="strip" aside={aside} entries={entries} /> : <ZooCard key="card" entries={entries} />;
}

/** Mounted once as an app overlay; renders nothing until the zoo is turned on in Bots settings. */
function Zoo() {
  const { enabled, dockToPanel } = useZooSettings();
  return enabled ? <ZooBody dock={dockToPanel} /> : null;
}

export function registerZoo(app: PluginAppBuilder) {
  app.slots.experimental_appOverlay({ id: "zoo", component: Zoo });
}

const popupBox: CSSProperties = {
  background: "var(--popover, var(--background))", color: "var(--popover-foreground, var(--foreground))", border: "1px solid var(--border)",
  borderRadius: 8, boxShadow: "0 8px 24px rgb(0 0 0 / 0.18)", fontSize: 13,
};
const cardBox: CSSProperties = { ...popupBox, position: "fixed", borderRadius: 12, pointerEvents: "auto", outline: "none", touchAction: "none" };
const faceButton: CSSProperties = { display: "inline-flex", padding: 4, border: "none", borderRadius: 10, cursor: "pointer", transition: "opacity 150ms ease" };
const collapseButton: CSSProperties = {
  width: 20, height: 20, padding: 0, border: "none", borderRadius: 4, background: "transparent", color: "var(--muted-foreground)", cursor: "pointer", fontSize: 14, lineHeight: "20px",
};
const menuRow: CSSProperties = {
  display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "6px 8px", border: "none", borderRadius: 6, background: "transparent",
  color: "inherit", cursor: "pointer", fontSize: 13, textAlign: "left",
};
const dot: CSSProperties = { flex: "none", width: 8, height: 8, borderRadius: "50%", border: "1px solid", boxSizing: "border-box" };
const badge: CSSProperties = {
  position: "absolute", top: 0, right: 0, minWidth: 18, height: 18, padding: "0 5px", borderRadius: 9, background: "#ff5d7a", color: "#fff",
  fontSize: 11, fontWeight: 600, lineHeight: "18px", textAlign: "center", boxSizing: "border-box",
};
