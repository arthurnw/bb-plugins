// Rows, groups, and drag handling shared by the Bots list's Threads and All modes.
import {
  experimental_Icon as Icon,
  experimental_ProviderIcon as ProviderIcon,
  experimental_ThreadActionsMenu as ThreadActionsMenu,
  experimental_useThreadActions as useThreadActions,
  experimental_ThreadActionsContextMenu as ThreadActionsContextMenu,
  experimental_ThreadRowMetadata as ThreadRowMetadata,
  experimental_ThreadStatusGlyph as ThreadStatusGlyph,
  experimental_useProviders as useProviders,
  experimental_useSidebarThreadSplit as useSidebarThreadSplit,
  ThreadTitle, useSdk,
  type PluginSidebarSection, type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import type { Bot } from "@arthurnw/bb-shared/bots";
import { threadAvatarState } from "@arthurnw/bb-shared/avatars";
import { BotAvatar } from "./bot-avatars";

export const PAGE = 30;
export const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

// The actions target wants an environment with a known id.
export const actionTarget = (thread: PluginSidebarThread) => ({
  ...thread, environment: thread.environment?.id ? { id: thread.environment.id, path: thread.environment.path } : null,
});
const byRecent = (a: PluginSidebarThread, b: PluginSidebarThread) => b.updatedAt - a.updatedAt;

/** Roots of a group with their in-group descendants, most recent first. */
export function tree(threads: readonly PluginSidebarThread[]) {
  const ids = new Set(threads.map((thread) => thread.id));
  const children = new Map<string, PluginSidebarThread[]>();
  const roots: PluginSidebarThread[] = [];
  for (const thread of [...threads].sort(byRecent)) {
    const parent = thread.parentThreadId;
    if (parent && ids.has(parent)) children.set(parent, [...(children.get(parent) ?? []), thread]);
    else roots.push(thread);
  }
  return { roots, children };
}

// Pointer-based drag, like bb's own rows. Drop targets carry data-drop
// ("thread:<id>" for a row, a group key for a group). bb's split drag shares
// the same pointerdown and engages only once the pointer leaves the sidebar.
export type DragPayload = { kind: "thread"; thread: PluginSidebarThread } | { kind: "group"; key: string; label: string };
export function useDrag(onDrop: (payload: DragPayload, target: string) => void, groupTargets = "[data-drop^='bot:'],[data-drop^='section:']") {
  const [drag, setDrag] = useState<{ payload: DragPayload; x: number; y: number } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const suppressClick = useRef(false);
  const dropRef = useRef(onDrop);
  dropRef.current = onDrop;
  const start = (payload: DragPayload) => (down: ReactPointerEvent) => {
    if (down.button !== 0 || down.pointerType === "touch") return;
    suppressClick.current = false;
    const origin = { x: down.clientX, y: down.clientY };
    let started = false;
    const targetAt = (x: number, y: number) => {
      const selector = payload.kind === "group" ? groupTargets : "[data-drop]";
      return document.elementFromPoint(x, y)?.closest<HTMLElement>(selector)?.dataset.drop ?? null;
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", finish);
      window.removeEventListener("keydown", escape);
      setDrag(null);
      setOver(null);
    };
    const move = (event: PointerEvent) => {
      if (!started && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) < 6) return;
      started = true;
      setDrag({ payload, x: event.clientX, y: event.clientY });
      setOver(targetAt(event.clientX, event.clientY));
    };
    const up = (event: PointerEvent) => {
      if (started) {
        suppressClick.current = true;
        const target = targetAt(event.clientX, event.clientY);
        if (target !== null) dropRef.current(payload, target);
      }
      finish();
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") finish(); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", finish);
    window.addEventListener("keydown", escape);
  };
  return { drag, over, start, suppressClick };
}

/** The floating label that follows the pointer during a drag. */
export function DragGhost({ drag }: { drag: ReturnType<typeof useDrag>["drag"] }) {
  if (!drag) return null;
  return createPortal(
    <div aria-hidden style={{ position: "fixed", left: drag.x + 12, top: drag.y + 8, zIndex: 60, pointerEvents: "none", maxWidth: 240,
      padding: "4px 8px", borderRadius: 6, background: "var(--popover, var(--background))", border: "1px solid var(--border)", fontSize: 12,
      boxShadow: "0 4px 12px rgb(0 0 0 / .15)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
      {drag.payload.kind === "thread" ? drag.payload.thread.displayTitle : "Move group"}
    </div>, document.body);
}

export interface RowPreferences { rowActions: string[]; showProviderIcons: boolean; showRowMetadata: boolean }

/** The row's hover actions: the built-in list's chosen quick actions, then the full menu. */
function HoverActions({ thread, keys, onMenuOpenChange }: { thread: PluginSidebarThread; keys: string[]; onMenuOpenChange: (open: boolean) => void }) {
  const target = actionTarget(thread);
  const actions = useThreadActions(target, { keys });
  return (
    <span onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
      style={{ flex: "none", display: "inline-flex", alignItems: "center", gap: 2 }}>
      {actions.filter(({ action }) => !action.choices).map(({ key, action }) => (
        <button key={key} type="button" aria-label={action.label} title={action.label} disabled={action.disabled}
          onClick={() => void action.run()} style={hoverButton}>
          <Icon name={action.icon} className="size-3.5" aria-hidden />
        </button>
      ))}
      <ThreadActionsMenu thread={target} align="end" onOpenChange={onMenuOpenChange}
        trigger={(props) => <button {...props} type="button" aria-label="Thread actions" title="Thread actions" style={hoverButton}>⋯</button>} />
    </span>
  );
}

export interface RowContext {
  activeThreadId: string | null;
  over: string | null;
  bots: readonly Bot[];
  threadBots: Record<string, string>;
  providers: ReturnType<typeof useProviders>["providers"];
  onOpen: (thread: PluginSidebarThread) => void;
  startDrag: (thread: PluginSidebarThread) => (event: ReactPointerEvent) => void;
  collapsedThreads: { has(id: string): boolean };
  toggleThread: (id: string) => void;
  preferences: RowPreferences;
  /** A bot thread's avatar replaces its provider icon, shown even when provider icons are off. */
  leadingAvatar?: boolean;
}

/**
 * One thread row. `renderChildren` draws its child rows while it is expanded.
 * Outside its own bot's group (`groupBot`), a bot thread shows the bot's avatar.
 */
export function ThreadRow({ thread, depth, childCount, renderChildren, groupBot = null, context }: {
  thread: PluginSidebarThread; depth: number; childCount: number; renderChildren: () => ReactNode; groupBot?: string | null; context: RowContext;
}) {
  const split = useSidebarThreadSplit(thread.id);
  const open = childCount > 0 && !context.collapsedThreads.has(thread.id);
  const active = thread.id === context.activeThreadId;
  const provider = context.providers.find((item) => item.id === thread.providerId) ?? { id: thread.providerId };
  const botId = context.threadBots[thread.id];
  const bot = botId && botId !== groupBot ? context.bots.find((item) => item.id === botId) : undefined;
  const leadingBot = context.leadingAvatar ? bot : undefined;
  const dropping = context.over === `thread:${thread.id}`;
  const ours = context.startDrag(thread);
  const [hover, setHover] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const showActions = hover || menuOpen;
  return (
    <>
      <ThreadActionsContextMenu thread={actionTarget(thread)}>
        <a href={thread.href} draggable={false} data-sidebar-thread-shortcut-target="" data-sidebar-thread-id={thread.id} data-drop={`thread:${thread.id}`} aria-current={active ? "page" : undefined}
          onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onFocus={() => setHover(true)} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setHover(false); }}
          onPointerDown={(event) => { split.splitProps.onPointerDown?.(event); ours(event); }}
          onClick={(event) => { if (event.metaKey || event.ctrlKey || event.shiftKey) return; event.preventDefault(); context.onOpen(thread); }}
          style={{ ...rowStyle, paddingLeft: 8 + depth * 14, background: dropping ? "var(--accent)" : active ? "var(--accent)" : "transparent",
            outline: dropping ? "2px solid var(--ring, var(--primary))" : "none", outlineOffset: -2 }}>
          {leadingBot ? (
            <span title={leadingBot.name} style={iconSlot}><BotAvatar bot={leadingBot} size={16} state={threadAvatarState(thread)} /></span>
          ) : context.preferences.showProviderIcons && (
            <span style={iconSlot}><ProviderIcon providerKind="agent" provider={provider} aria-hidden className="size-3.5" /></span>
          )}
          <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: thread.isUnread ? 600 : 400 }}>
                <ThreadTitle threadId={thread.id} />
              </span>
              {showActions ? (
                <HoverActions thread={thread} keys={context.preferences.rowActions} onMenuOpenChange={setMenuOpen} />
              ) : (
                <>
                  {bot && !leadingBot && <span title={bot.name} style={{ flex: "none", display: "inline-flex" }}><BotAvatar bot={bot} size={14} state={threadAvatarState(thread)} /></span>}
                  <span style={{ flex: "none", display: "inline-flex" }}><ThreadStatusGlyph indicator={thread.indicator} size="compact" /></span>
                </>
              )}
            </span>
            {context.preferences.showRowMetadata && (
              <span style={{ fontSize: 12, color: "var(--muted-foreground)", minWidth: 0, overflow: "hidden" }}><ThreadRowMetadata thread={thread} /></span>
            )}
          </span>
          {childCount > 0 && (
            <button type="button" aria-label={open ? "Hide child threads" : `Show ${childCount} child threads`} aria-expanded={open}
              onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.preventDefault(); e.stopPropagation(); context.toggleThread(thread.id); }}
              style={chevron}>{open ? "▾" : `${childCount} ▸`}</button>
          )}
        </a>
      </ThreadActionsContextMenu>
      {open && renderChildren()}
    </>
  );
}

/** A thread and its in-group descendants from a `tree` children map. */
export function TreeRow({ thread, depth, childrenOf, groupBot, context }: {
  thread: PluginSidebarThread; depth: number; childrenOf: Map<string, PluginSidebarThread[]>; groupBot: string | null; context: RowContext;
}) {
  const kids = childrenOf.get(thread.id) ?? [];
  return (
    <ThreadRow thread={thread} depth={depth} childCount={kids.length} groupBot={groupBot} context={context}
      renderChildren={() => kids.map((kid) => <TreeRow key={kid.id} thread={kid} depth={depth + 1} childrenOf={childrenOf} groupBot={groupBot} context={context} />)} />
  );
}

/** A collapsible group of root rows with paging. */
export function Group<R>({ dropKey, title, actions, roots, renderRoot, limit, empty, collapsed, onToggle, onHeaderPointerDown, over, footer }: {
  dropKey: string; title: ReactNode; actions?: ReactNode; roots: readonly R[]; renderRoot: (root: R) => ReactNode;
  limit?: number; empty?: string; collapsed: boolean; onToggle: () => void;
  onHeaderPointerDown?: (event: ReactPointerEvent) => void; over: string | null; footer?: ReactNode;
}) {
  const [shown, setShown] = useState(limit ?? Infinity);
  const dropping = over === dropKey;
  return (
    <section data-drop={dropKey} style={{ borderRadius: 8, paddingBottom: 4, outline: dropping ? "2px solid var(--ring, var(--primary))" : "none", outlineOffset: -2 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 8px 2px" }} onPointerDown={onHeaderPointerDown}>
        <button type="button" aria-expanded={!collapsed} onClick={onToggle}
          style={{ ...plainButton, flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 6, cursor: onHeaderPointerDown ? "grab" : "pointer" }}>
          {title}
          <span style={{ color: "var(--muted-foreground)", fontSize: 11 }}>{roots.length || ""}</span>
        </button>
        <span onPointerDown={(e) => e.stopPropagation()} style={{ display: "inline-flex", gap: 2 }}>{actions}</span>
      </div>
      {!collapsed && roots.length === 0 && empty && <div style={{ padding: "2px 8px 4px 32px", fontSize: 12, color: "var(--muted-foreground)" }}>{empty}</div>}
      {!collapsed && roots.slice(0, shown).map(renderRoot)}
      {!collapsed && roots.length > shown && (
        <button type="button" onClick={() => setShown(shown + PAGE)} style={{ ...plainButton, padding: "2px 8px 2px 32px", fontSize: 12, color: "var(--muted-foreground)" }}>
          Show {Math.min(PAGE, roots.length - shown)} more
        </button>
      )}
      {!collapsed && footer}
    </section>
  );
}

/** A Group of plain threads, nested with `tree`. */
export function ThreadGroup({ threads, groupBot = null, context, ...props }: Omit<Parameters<typeof Group>[0], "roots" | "renderRoot" | "over"> & {
  threads: readonly PluginSidebarThread[]; groupBot?: string | null; context: RowContext;
}) {
  const { roots, children } = useMemo(() => tree(threads), [threads]);
  return (
    <Group {...props} over={context.over} roots={roots}
      renderRoot={(thread) => <TreeRow key={thread.id} thread={thread} depth={0} childrenOf={children} groupBot={groupBot} context={context} />} />
  );
}

export function SectionActions({ section }: { section: PluginSidebarSection }) {
  const sdk = useSdk();
  const [mode, setMode] = useState<"menu" | "rename" | "delete" | null>(null);
  const [name, setName] = useState(section.name);
  const run = (operation: Promise<unknown>) => operation.then(() => setMode(null), (error) => toast.error(errorText(error)));
  if (mode === "rename") {
    return (
      <input autoFocus value={name} aria-label="Section name" onChange={(e) => setName(e.target.value)} onBlur={() => setMode(null)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && name.trim()) void run(sdk.threadSections.update({ id: section.id, name: name.trim() }));
          else if (e.key === "Escape") setMode(null);
        }}
        style={{ width: 120, fontSize: 12, padding: "1px 4px", border: "1px solid var(--border)", borderRadius: 4, background: "transparent", color: "var(--foreground)" }} />
    );
  }
  if (mode === "delete") {
    return (
      <>
        <button type="button" style={smallButton} onClick={() => void run(sdk.threadSections.delete({ id: section.id }))}>Delete</button>
        <button type="button" style={smallButton} onClick={() => setMode(null)}>Cancel</button>
      </>
    );
  }
  if (mode === "menu") {
    return (
      <>
        <button type="button" style={smallButton} onClick={() => { setName(section.name); setMode("rename"); }}>Rename</button>
        <button type="button" style={smallButton} title="Its threads move to Threads" onClick={() => setMode("delete")}>Delete</button>
        <button type="button" style={smallButton} aria-label="Close" onClick={() => setMode(null)}>×</button>
      </>
    );
  }
  return <button type="button" aria-label={`${section.name} options`} style={iconButton} onClick={() => setMode("menu")}>⋯</button>;
}

export function NewSection({ onCreated }: { onCreated: (id: string) => void }) {
  const sdk = useSdk();
  const [name, setName] = useState<string | null>(null);
  if (name === null) {
    return <button type="button" onClick={() => setName("")} style={{ ...plainButton, padding: "6px 8px", fontSize: 12, color: "var(--muted-foreground)" }}>+ New section</button>;
  }
  const create = () => {
    if (!name.trim()) { setName(null); return; }
    sdk.threadSections.create({ name: name.trim() }).then(
      (section) => { setName(null); onCreated(section.id); },
      (error) => toast.error(errorText(error)));
  };
  return (
    <div style={{ padding: "4px 8px" }}>
      <input autoFocus value={name} placeholder="Section name" aria-label="New section name" onChange={(e) => setName(e.target.value)}
        onBlur={create} onKeyDown={(e) => { if (e.key === "Enter") create(); else if (e.key === "Escape") setName(null); }}
        style={{ width: "100%", boxSizing: "border-box", fontSize: 13, padding: "4px 6px", border: "1px solid var(--border)", borderRadius: 6, background: "transparent", color: "var(--foreground)" }} />
    </div>
  );
}

export function Divider() {
  return <div role="separator" style={{ height: 0, margin: "4px 0", borderTop: "1px solid color-mix(in srgb, var(--border) 60%, transparent)" }} />;
}

export const iconSlot: CSSProperties = { width: 16, height: 16, flex: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", marginTop: 1 };
export const rowStyle: CSSProperties = { display: "flex", alignItems: "flex-start", gap: 8, padding: "5px 8px", borderRadius: 6, fontSize: 13, color: "var(--foreground)", textDecoration: "none", cursor: "pointer" };
export const plainButton: CSSProperties = { border: "none", background: "transparent", color: "var(--foreground)", cursor: "pointer", padding: 0, textAlign: "left", fontSize: 13 };
export const chevron: CSSProperties = { ...plainButton, color: "var(--muted-foreground)", fontSize: 11, padding: "0 4px", alignSelf: "center" };
export const iconButton: CSSProperties = { ...plainButton, padding: "0 6px", borderRadius: 4, color: "var(--muted-foreground)", fontSize: 15, lineHeight: "18px" };
const hoverButton: CSSProperties = { ...plainButton, width: 22, height: 20, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 4, color: "var(--muted-foreground)" };
const smallButton: CSSProperties = { ...plainButton, padding: "0 4px", fontSize: 11, color: "var(--muted-foreground)" };
export const groupTitle: CSSProperties = { fontSize: 12, fontWeight: 600, color: "var(--muted-foreground)" };
