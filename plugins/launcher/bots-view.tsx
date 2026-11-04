// The "Launcher bots" sidebar thread list: Pinned, then bots and custom
// sections in one manual order, then the remaining threads.
import {
  experimental_Icon as Icon,
  experimental_ProviderIcon as ProviderIcon,
  experimental_ThreadActionsMenu as ThreadActionsMenu,
  experimental_useThreadActions as useThreadActions,
  experimental_ThreadActionsContextMenu as ThreadActionsContextMenu,
  experimental_ThreadRowMetadata as ThreadRowMetadata,
  experimental_ThreadStatusGlyph as ThreadStatusGlyph,
  experimental_useProviders as useProviders,
  experimental_useSidebarThreads as useSidebarThreads,
  experimental_useSidebarThreadSplit as useSidebarThreadSplit,
  ThreadTitle, useBbNavigate, useRealtime, useRpc, useSdk,
  type PluginSidebarSection, type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import type { botsContract } from "./bots-server";
import type { Bot } from "./bots";
import { BotAvatar, useBots } from "./bot-avatars";
import { quickCompose } from "./overlay-store";
import { groupKeys, groupThreads, moveBefore, wouldCycle, type GroupKey } from "./list-model";
import { BotsSummary } from "./bots-summary";

type BotsRpc = ReturnType<typeof useRpc<typeof botsContract>>;
const PAGE = 30;
const VIEW_KEY = "bb-launcher:list-view";
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

export function useThreadBots(): Record<string, string> {
  const rpc = useRpc<typeof botsContract>();
  const [threads, setThreads] = useState<Record<string, string>>({});
  const load = () => { rpc.call("threadBots", {}).then((result) => setThreads(result.threads), () => {}); };
  useEffect(load, [rpc]);
  useRealtime("bots", load);
  return threads;
}

function useListOrder(rpc: BotsRpc) {
  const [order, setOrder] = useState<string[]>([]);
  const load = () => { rpc.call("getListOrder", {}).then((result) => setOrder(result.order), () => {}); };
  useEffect(load, [rpc]);
  useRealtime("bots", load);
  const save = (next: string[]) => {
    setOrder(next);
    rpc.call("setListOrder", { order: next }).catch((error) => { toast.error(errorText(error)); load(); });
  };
  return [order, save] as const;
}

/**
 * Gives a thread to a bot. One that has not started is reassigned in place; a
 * started one keeps its session's instructions, so this opens a handoff.
 */
export async function sendThreadToBot(rpc: BotsRpc, thread: { id: string; projectId: string; status: string }, botId: string | null) {
  if (thread.status !== "pending") {
    quickCompose.open("handoff", { projectId: thread.projectId, threadId: thread.id, botId });
    return;
  }
  try {
    if (botId) await rpc.call("assignThread", { threadId: thread.id, botId });
    else await rpc.call("detachThread", { threadId: thread.id });
  } catch (error) {
    toast.error(errorText(error));
  }
}

// The actions target wants an environment with a known id.
export const actionTarget = (thread: PluginSidebarThread) => ({
  ...thread, environment: thread.environment?.id ? { id: thread.environment.id, path: thread.environment.path } : null,
});
const visible = (thread: PluginSidebarThread) => !thread.isArchived && !thread.isHidden;
const byRecent = (a: PluginSidebarThread, b: PluginSidebarThread) => b.updatedAt - a.updatedAt;

/** Roots of a group with their in-group descendants, most recent first. */
function tree(threads: readonly PluginSidebarThread[]) {
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

function useStoredSet(key: string) {
  const [set, setSet] = useState<ReadonlySet<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(key) ?? "[]") as string[]); } catch { return new Set(); }
  });
  const toggle = (id: string) => setSet((current) => {
    const next = new Set(current);
    if (!next.delete(id)) next.add(id);
    localStorage.setItem(key, JSON.stringify([...next]));
    return next;
  });
  return [set, toggle] as const;
}

// Pointer-based drag, like bb's own rows. Drop targets carry data-drop
// ("thread:<id>" for a row, a group key for a group). bb's split drag shares
// the same pointerdown and engages only once the pointer leaves the sidebar.
type DragPayload = { kind: "thread"; thread: PluginSidebarThread } | { kind: "group"; key: GroupKey; label: string };
function useDrag(onDrop: (payload: DragPayload, target: string) => void) {
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
      const selector = payload.kind === "group" ? "[data-drop^='bot:'],[data-drop^='section:']" : "[data-drop]";
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

export interface RowPreferences { rowActions: string[]; showProviderIcons: boolean; showRowMetadata: boolean; chronologicalSort: string }
const DEFAULT_ROW_PREFERENCES: RowPreferences = { rowActions: ["bb--core/read", "bb--core/archive"], showProviderIcons: true, showRowMetadata: true, chronologicalSort: "updated" };

function useRowPreferences(rpc: BotsRpc) {
  const [preferences, setPreferences] = useState(DEFAULT_ROW_PREFERENCES);
  // The built-in list's preferences change rarely; re-read when the window regains focus.
  useEffect(() => {
    const load = () => { rpc.call("rowPreferences", {}).then(setPreferences, () => {}); };
    load();
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, [rpc]);
  return preferences;
}

/** The row's hover actions: the built-in list's chosen quick actions, then the full menu. */
function HoverActions({ thread, keys, onMenuOpenChange }: { thread: PluginSidebarThread; keys: readonly string[]; onMenuOpenChange: (open: boolean) => void }) {
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

interface RowContext {
  activeThreadId: string | null;
  over: string | null;
  bots: readonly Bot[];
  threadBots: Record<string, string>;
  providers: ReturnType<typeof useProviders>["providers"];
  onOpen: (thread: PluginSidebarThread) => void;
  startDrag: (thread: PluginSidebarThread) => (event: ReactPointerEvent) => void;
  collapsedThreads: ReadonlySet<string>;
  toggleThread: (id: string) => void;
  preferences: RowPreferences;
}

function ThreadRow({ thread, depth, childrenOf, groupBot, context }: {
  thread: PluginSidebarThread; depth: number; childrenOf: Map<string, PluginSidebarThread[]>; groupBot: string | null; context: RowContext;
}) {
  const split = useSidebarThreadSplit(thread.id);
  const kids = childrenOf.get(thread.id) ?? [];
  const open = kids.length > 0 && !context.collapsedThreads.has(thread.id);
  const active = thread.id === context.activeThreadId;
  const provider = context.providers.find((item) => item.id === thread.providerId) ?? { id: thread.providerId };
  const botId = context.threadBots[thread.id];
  // Outside its own bot's group, a bot thread shows the bot's avatar.
  const bot = botId && botId !== groupBot ? context.bots.find((item) => item.id === botId) : undefined;
  const dropping = context.over === `thread:${thread.id}`;
  const ours = context.startDrag(thread);
  const [hover, setHover] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const showActions = hover || menuOpen;
  return (
    <>
      <ThreadActionsContextMenu thread={actionTarget(thread)}>
        <a href={thread.href} draggable={false} data-drop={`thread:${thread.id}`} aria-current={active ? "page" : undefined}
          onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onFocus={() => setHover(true)} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setHover(false); }}
          onPointerDown={(event) => { split.splitProps.onPointerDown?.(event); ours(event); }}
          onClick={(event) => { if (event.metaKey || event.ctrlKey || event.shiftKey) return; event.preventDefault(); context.onOpen(thread); }}
          style={{ ...rowStyle, paddingLeft: 8 + depth * 14, background: dropping ? "var(--accent)" : active ? "var(--accent)" : "transparent",
            outline: dropping ? "2px solid var(--ring, var(--primary))" : "none", outlineOffset: -2 }}>
          {context.preferences.showProviderIcons && (
            <span style={{ width: 16, height: 16, flex: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", marginTop: 1 }}>
              <ProviderIcon providerKind="agent" provider={provider} aria-hidden className="size-3.5" />
            </span>
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
                  {bot && <span title={bot.name} style={{ flex: "none", display: "inline-flex" }}><BotAvatar bot={bot} size={14} /></span>}
                  <span style={{ flex: "none", display: "inline-flex" }}><ThreadStatusGlyph indicator={thread.indicator} size="compact" /></span>
                </>
              )}
            </span>
            {context.preferences.showRowMetadata && (
              <span style={{ fontSize: 12, color: "var(--muted-foreground)", minWidth: 0, overflow: "hidden" }}><ThreadRowMetadata thread={thread} /></span>
            )}
          </span>
          {kids.length > 0 && (
            <button type="button" aria-label={open ? "Hide child threads" : `Show ${kids.length} child threads`} aria-expanded={open}
              onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.preventDefault(); e.stopPropagation(); context.toggleThread(thread.id); }}
              style={chevron}>{open ? "▾" : `${kids.length} ▸`}</button>
          )}
        </a>
      </ThreadActionsContextMenu>
      {open && kids.map((kid) => <ThreadRow key={kid.id} thread={kid} depth={depth + 1} childrenOf={childrenOf} groupBot={groupBot} context={context} />)}
    </>
  );
}

function Group({ dropKey, title, actions, threads, groupBot = null, limit, empty, collapsed, onToggle, onHeaderPointerDown, context }: {
  dropKey: string; title: ReactNode; actions?: ReactNode; threads: readonly PluginSidebarThread[]; groupBot?: string | null;
  limit?: number; empty?: string; collapsed: boolean; onToggle: () => void;
  onHeaderPointerDown?: (event: ReactPointerEvent) => void; context: RowContext;
}) {
  const { roots, children } = useMemo(() => tree(threads), [threads]);
  const [shown, setShown] = useState(limit ?? Infinity);
  const dropping = context.over === dropKey;
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
      {!collapsed && roots.slice(0, shown).map((thread) => <ThreadRow key={thread.id} thread={thread} depth={0} childrenOf={children} groupBot={groupBot} context={context} />)}
      {!collapsed && roots.length > shown && (
        <button type="button" onClick={() => setShown(shown + PAGE)} style={{ ...plainButton, padding: "2px 8px 2px 32px", fontSize: 12, color: "var(--muted-foreground)" }}>
          Show {Math.min(PAGE, roots.length - shown)} more
        </button>
      )}
    </section>
  );
}

function SectionActions({ section }: { section: PluginSidebarSection }) {
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

function NewSection({ onCreated }: { onCreated: (id: string) => void }) {
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

export function BotThreadList({ activeThreadId, activeProjectId, onNavigate }: { activeThreadId: string | null; activeProjectId: string | null; onNavigate?: () => void }) {
  const sidebar = useSidebarThreads();
  const bots = useBots();
  const threadBots = useThreadBots();
  const navigate = useBbNavigate();
  const rpc = useRpc<typeof botsContract>();
  const sdk = useSdk();
  const { providers } = useProviders();
  const [order, saveOrder] = useListOrder(rpc);
  const [collapsedGroups, toggleGroup] = useStoredSet("bb-launcher:list-collapsed-groups");
  const [collapsedThreads, toggleThread] = useStoredSet("bb-launcher:list-collapsed-threads");
  const preferences = useRowPreferences(rpc);
  const [view, setViewState] = useState<"threads" | "bots">(() => localStorage.getItem(VIEW_KEY) === "bots" ? "bots" : "threads");
  const setView = (next: "threads" | "bots") => { localStorage.setItem(VIEW_KEY, next); setViewState(next); };
  const showBot = (botId: string) => {
    const key = `bot:${botId}`;
    if (collapsedGroups.has(key)) toggleGroup(key);
    setView("threads");
    requestAnimationFrame(() => document.querySelector(`section[data-drop="${key}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" }));
  };

  const byId = useMemo(() => new Map(sidebar.threads.map((thread) => [thread.id, thread])), [sidebar.threads]);
  const sections = sidebar.sections;
  const keys = useMemo(() => groupKeys(order, (bots ?? []).map((bot) => bot.id), sections.map((section) => section.id)), [order, bots, sections]);

  const dragState = useDrag((payload, target) => {
    if (payload.kind === "group") {
      if (target !== payload.key) saveOrder(moveBefore(keys, payload.key, target as GroupKey));
      return;
    }
    const { thread } = payload;
    const fail = (error: unknown) => toast.error(errorText(error));
    if (target.startsWith("thread:")) {
      const parent = target.slice("thread:".length);
      if (parent === thread.id || parent === thread.parentThreadId) return;
      if (wouldCycle(thread.id, parent, (id) => byId.get(id)?.parentThreadId ?? null)) { toast.error("A thread cannot go under its own child."); return; }
      sdk.threads.update({ threadId: thread.id, parentThreadId: parent }).catch(fail);
    } else if (target.startsWith("bot:")) {
      const botId = target.slice("bot:".length);
      if (threadBots[thread.id] !== botId) void sendThreadToBot(rpc, thread, botId);
    } else if (target.startsWith("section:")) {
      const sectionId = target.slice("section:".length);
      if (thread.sectionId !== sectionId || thread.parentThreadId) sdk.threads.update({ threadId: thread.id, sectionId, parentThreadId: null }).catch(fail);
    } else if (target === "threads") {
      if (thread.sectionId !== null || thread.parentThreadId) sdk.threads.update({ threadId: thread.id, sectionId: null, parentThreadId: null }).catch(fail);
    } else if (target === "pinned" && !thread.isPinned) {
      sdk.threads.pin({ threadId: thread.id }).catch(fail);
    }
  });

  const open = (thread: PluginSidebarThread) => {
    if (dragState.suppressClick.current) { dragState.suppressClick.current = false; return; }
    navigate.toThread(thread.id);
    onNavigate?.();
  };

  const placed = useMemo(() => {
    const known = new Set((bots ?? []).map((bot) => bot.id));
    const sectionIds = new Set(sections.map((section) => section.id));
    const rows = sidebar.threads.filter(visible).map((thread) => {
      const owner = threadBots[thread.id];
      return {
        thread, id: thread.id, parentThreadId: thread.parentThreadId, pinned: thread.isPinned,
        botId: owner && known.has(owner) ? owner : null,
        sectionId: thread.sectionId && sectionIds.has(thread.sectionId) ? thread.sectionId : null,
      };
    });
    const result = new Map<string, PluginSidebarThread[]>();
    for (const [key, members] of groupThreads(rows)) result.set(key, members.map((row) => row.thread));
    return result;
  }, [sidebar.threads, bots, threadBots, sections]);

  if (sidebar.status === "loading" || bots === null) return <div style={{ padding: 12, fontSize: 12, color: "var(--muted-foreground)" }}>Loading…</div>;

  const context: RowContext = {
    activeThreadId, over: dragState.over, bots, threadBots, providers, onOpen: open,
    startDrag: (thread) => dragState.start({ kind: "thread", thread }), collapsedThreads, toggleThread, preferences,
  };
  const groupProps = (key: string) => ({ dropKey: key, collapsed: collapsedGroups.has(key), onToggle: () => toggleGroup(key), context });
  const dragged = dragState.drag;
  const toggle = (
    <div role="tablist" aria-label="Sidebar view" style={{ display: "inline-flex", alignSelf: "flex-start", margin: "4px 8px 6px", padding: 2, borderRadius: 8, background: "var(--accent)" }}>
      {(["bots", "threads"] as const).map((item) => (
        <button key={item} type="button" role="tab" aria-selected={view === item} onClick={() => setView(item)}
          style={{ border: "none", cursor: "pointer", fontSize: 12, padding: "3px 12px", borderRadius: 6,
            background: view === item ? "var(--background)" : "transparent", color: view === item ? "var(--foreground)" : "var(--muted-foreground)",
            boxShadow: view === item ? "0 1px 2px rgb(0 0 0 / .12)" : "none" }}>
          {item === "bots" ? "Bots" : "Threads"}
        </button>
      ))}
    </div>
  );
  if (view === "bots") {
    return (
      <div style={{ display: "flex", flexDirection: "column", padding: "4px 4px 16px" }}>
        {toggle}
        <BotsSummary bots={bots} threads={sidebar.threads.filter(visible)} threadBots={threadBots} activeThreadId={activeThreadId}
          activeProjectId={activeProjectId} builtInSort={preferences.chronologicalSort} showRowMetadata={preferences.showRowMetadata}
          actionTarget={actionTarget} onOpen={open} onShowBot={showBot} />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "4px 4px 16px", userSelect: dragged ? "none" : undefined }}>
      {toggle}
      {(placed.get("pinned")?.length ?? 0) > 0 && (
        <Group {...groupProps("pinned")} title={<span style={groupTitle}>Pinned</span>} threads={placed.get("pinned") ?? []} />
      )}
      {keys.map((key) => {
        const headerDrag = dragState.start({ kind: "group", key, label: key });
        if (key.startsWith("bot:")) {
          const bot = bots.find((item) => `bot:${item.id}` === key)!;
          return (
            <Group key={key} {...groupProps(key)} groupBot={bot.id} threads={placed.get(key) ?? []} onHeaderPointerDown={headerDrag}
              title={<><BotAvatar bot={bot} size={16} /><span style={{ ...groupTitle, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{bot.name}</span></>}
              actions={<button type="button" aria-label={`New thread with ${bot.name}`} title={`New thread with ${bot.name}`} style={iconButton}
                onClick={() => quickCompose.open("new-thread", { projectId: bot.projectId ?? activeProjectId, threadId: null, botId: bot.id })}>+</button>}
              empty="Drop a thread here to hand it off." />
          );
        }
        const section = sections.find((item) => `section:${item.id}` === key)!;
        return (
          <Group key={key} {...groupProps(key)} threads={placed.get(key) ?? []} onHeaderPointerDown={headerDrag}
            title={<span style={groupTitle}>{section.name}</span>} actions={<SectionActions section={section} />} empty="Drop a thread here to file it." />
        );
      })}
      <Group {...groupProps("threads")} title={<span style={groupTitle}>Threads</span>} threads={placed.get("threads") ?? []} limit={PAGE} />
      <NewSection onCreated={(id) => saveOrder([...keys, `section:${id}`])} />
      {dragged && createPortal(
        <div aria-hidden style={{ position: "fixed", left: dragged.x + 12, top: dragged.y + 8, zIndex: 60, pointerEvents: "none", maxWidth: 240,
          padding: "4px 8px", borderRadius: 6, background: "var(--popover, var(--background))", border: "1px solid var(--border)", fontSize: 12,
          boxShadow: "0 4px 12px rgb(0 0 0 / .15)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {dragged.payload.kind === "thread" ? dragged.payload.thread.displayTitle : "Move group"}
        </div>, document.body)}
    </div>
  );
}

const rowStyle: CSSProperties = { display: "flex", alignItems: "flex-start", gap: 8, padding: "5px 8px", borderRadius: 6, fontSize: 13, color: "var(--foreground)", textDecoration: "none", cursor: "pointer" };
const plainButton: CSSProperties = { border: "none", background: "transparent", color: "var(--foreground)", cursor: "pointer", padding: 0, textAlign: "left", fontSize: 13 };
const chevron: CSSProperties = { ...plainButton, color: "var(--muted-foreground)", fontSize: 11, padding: "0 4px", alignSelf: "center" };
const iconButton: CSSProperties = { ...plainButton, padding: "0 6px", borderRadius: 4, color: "var(--muted-foreground)", fontSize: 15, lineHeight: "18px" };
const hoverButton: CSSProperties = { ...plainButton, width: 22, height: 20, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 4, color: "var(--muted-foreground)" };
const smallButton: CSSProperties = { ...plainButton, padding: "0 4px", fontSize: 11, color: "var(--muted-foreground)" };
const groupTitle: CSSProperties = { fontSize: 12, fontWeight: 600, color: "var(--muted-foreground)" };
