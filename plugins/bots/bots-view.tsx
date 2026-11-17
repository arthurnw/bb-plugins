// The "Bots" sidebar thread list: Pinned, then bots and custom
// sections in one manual order, then the remaining threads.
import {
  experimental_useProviders as useProviders,
  experimental_useSidebarThreads as useSidebarThreads,
  useBbNavigate, useRealtime, useRpc, useSdk,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { botsContract, spawnContract } from "./bots-server";
import { BotAvatar, useBots, useBotStates, useThreadBots } from "./bot-avatars";
import { liveThread } from "@arthurnw/bb-shared/avatars";
import { activeBots, groupKeys, groupThreads, moveBefore, withoutCoordinators, wouldCycle, type GroupKey } from "./list-model";
import { openNewBot } from "./new-bot-dialog";
import { BotsSummary } from "./bots-summary";
import { AllView } from "./all-view";
import { actionTarget, Divider, DragGhost, errorText, groupTitle, iconButton, NewSection, PAGE, SectionActions, ThreadGroup, useDrag, type RowContext } from "./list-parts";
import { useThreadListPreferences } from "./thread-list-prefs";

const visible = liveThread;
type BotsRpc = ReturnType<typeof useRpc<typeof botsContract>>;
const VIEW_KEY = "bb-bots:list-view";
type View = "bots" | "threads" | "all";
const VIEWS: readonly View[] = ["bots", "threads", "all"];
const VIEW_LABELS: Record<View, string> = { bots: "Bots", threads: "Threads", all: "All" };
const storedView = (): View => { const value = localStorage.getItem(VIEW_KEY); return value === "bots" || value === "all" ? value : "threads"; };

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

export function BotThreadList({ activeThreadId, activeProjectId, onNavigate }: { activeThreadId: string | null; activeProjectId: string | null; onNavigate?: () => void }) {
  const sidebar = useSidebarThreads();
  const allBots = useBots();
  // Initiative bots whose coordinator is archived (or gone) leave the list.
  const bots = useMemo(() => allBots === null ? null : activeBots(allBots, new Set(sidebar.threads.filter(visible).map((thread) => thread.id))), [allBots, sidebar.threads]);
  const threadBots = useThreadBots();
  // Combined over all of a bot's threads, including those filed under Pinned or a section.
  const botStates = useBotStates();
  const navigate = useBbNavigate();
  const rpc = useRpc<typeof botsContract>();
  const spawnRpc = useRpc<typeof spawnContract>();
  const sdk = useSdk();
  const { providers } = useProviders();
  const [order, saveOrder] = useListOrder(rpc);
  const [collapsedGroups, toggleGroup] = useStoredSet("bb-bots:list-collapsed-groups");
  const [collapsedThreads, toggleThread] = useStoredSet("bb-bots:list-collapsed-threads");
  const { prefs: preferences, reload: reloadPreferences } = useThreadListPreferences();
  const [view, setViewState] = useState<View>(storedView);
  const setView = (next: View) => {
    localStorage.setItem(VIEW_KEY, next);
    setViewState(next);
    if (next === "all") reloadPreferences();
  };
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
      if (target !== payload.key) saveOrder(moveBefore(keys, payload.key as GroupKey, target as GroupKey));
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
      // Under the coordinator, the thread becomes one of the bot's workers.
      const coordinator = bots?.find((bot) => `bot:${bot.id}` === target)?.coordinatorThreadId;
      if (!coordinator || coordinator === thread.id || thread.parentThreadId === coordinator) return;
      if (wouldCycle(thread.id, coordinator, (id) => byId.get(id)?.parentThreadId ?? null)) { toast.error("A thread cannot go under its own child."); return; }
      sdk.threads.update({ threadId: thread.id, parentThreadId: coordinator }).catch(fail);
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

  // A coordinator thread renamed in bb renames its bot. Only a change of title
  // counts: renaming the bot retitles the thread a moment later, and the gap
  // between the two must not rename the bot back.
  const seenTitles = useRef(new Map<string, string>());
  useEffect(() => {
    for (const bot of allBots ?? []) {
      const thread = bot.coordinatorThreadId ? sidebar.threads.find((item) => item.id === bot.coordinatorThreadId) : undefined;
      const title = thread?.title?.trim();
      if (!thread || !title) continue;
      const before = seenTitles.current.get(thread.id);
      seenTitles.current.set(thread.id, title);
      if (before !== undefined && before !== title && title !== bot.name) void spawnRpc.call("renameFromTitle", { threadId: thread.id, title }).catch(() => {});
    }
  }, [allBots, sidebar.threads, spawnRpc]);

  const placed = useMemo(() => {
    const known = new Set((bots ?? []).map((bot) => bot.id));
    const sectionIds = new Set(sections.map((section) => section.id));
    const rows = withoutCoordinators(sidebar.threads.filter(visible).map((thread) => {
      const owner = threadBots[thread.id];
      return {
        thread, id: thread.id, parentThreadId: thread.parentThreadId, pinned: thread.isPinned,
        botId: owner && known.has(owner) ? owner : null,
        sectionId: thread.sectionId && sectionIds.has(thread.sectionId) ? thread.sectionId : null,
      };
    }), bots ?? []);
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
  // Dividers separate Pinned, the bot and section groups, and Threads, only between non-empty groups.
  const hasPinned = (placed.get("pinned")?.length ?? 0) > 0;
  const hasMiddle = keys.length > 0;
  const hasThreads = (placed.get("threads")?.length ?? 0) > 0;
  const toggle = (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
    <div role="tablist" aria-label="Sidebar view" style={{ display: "inline-flex", alignSelf: "flex-start", margin: "4px 8px 6px", padding: 2, borderRadius: 8, background: "var(--accent)" }}>
      {VIEWS.map((item) => (
        <button key={item} type="button" role="tab" aria-selected={view === item} onClick={() => setView(item)}
          style={{ border: "none", cursor: "pointer", fontSize: 12, padding: "3px 12px", borderRadius: 6,
            background: view === item ? "var(--background)" : "transparent", color: view === item ? "var(--foreground)" : "var(--muted-foreground)",
            boxShadow: view === item ? "0 1px 2px rgb(0 0 0 / .12)" : "none" }}>
          {VIEW_LABELS[item]}
        </button>
      ))}
    </div>
    <button type="button" aria-label="New bot" title="New bot" style={{ ...iconButton, marginLeft: "auto", marginRight: 8 }}
      onClick={() => openNewBot({ projectId: activeProjectId })}>+</button>
    </div>
  );
  const ghost = <DragGhost drag={dragged} />;
  if (view === "all") return <AllView activeThreadId={activeThreadId} bots={bots} threadBots={threadBots} onOpen={open} header={toggle} />;
  if (view === "bots") {
    return (
      <div style={{ display: "flex", flexDirection: "column", padding: "4px 4px 16px", userSelect: dragged ? "none" : undefined }}>
        {toggle}
        <BotsSummary bots={bots} threads={sidebar.threads.filter(visible)} threadBots={threadBots} activeThreadId={activeThreadId}
          activeProjectId={activeProjectId} builtInSort={preferences.chronologicalSort} showRowMetadata={preferences.showRowMetadata} actionTarget={actionTarget} onOpen={open} onShowBot={showBot} startDrag={context.startDrag} over={dragState.over} />
        {ghost}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "4px 4px 16px", userSelect: dragged ? "none" : undefined }}>
      {toggle}
      {hasPinned && (
        <ThreadGroup {...groupProps("pinned")} title={<span style={groupTitle}>Pinned</span>} threads={placed.get("pinned") ?? []} />
      )}
      {hasPinned && hasMiddle && <Divider />}
      {keys.map((key) => {
        const headerDrag = dragState.start({ kind: "group", key, label: key });
        if (key.startsWith("bot:")) {
          const bot = bots.find((item) => `bot:${item.id}` === key)!;
          // Bots lists initiative bots only, so every bot has a coordinator.
          const coordinator = bot.coordinatorThreadId!;
          const title = <><BotAvatar bot={bot} size={16} state={botStates.get(bot.id)} track /><span style={{ ...groupTitle, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{bot.name}</span></>;
          return (
            <ThreadGroup key={key} {...groupProps(key)} groupBot={bot.id} threads={placed.get(key) ?? []} onHeaderPointerDown={headerDrag} done={bot.doneThreads} depth={1} menuThread={sidebar.threads.find((thread) => thread.id === coordinator)}
              title={title} onOpen={() => { if (!dragState.suppressClick.current) { navigate.toThread(coordinator); onNavigate?.(); } else dragState.suppressClick.current = false; }}
              empty="No workers yet." />
          );
        }
        const section = sections.find((item) => `section:${item.id}` === key)!;
        return (
          <ThreadGroup key={key} {...groupProps(key)} threads={placed.get(key) ?? []} onHeaderPointerDown={headerDrag}
            title={<span style={groupTitle}>{section.name}</span>} actions={<SectionActions section={section} />} empty="Drop a thread here to file it." />
        );
      })}
      {hasMiddle && hasThreads && <Divider />}
      <ThreadGroup {...groupProps("threads")} title={<span style={groupTitle}>Threads</span>} threads={placed.get("threads") ?? []} limit={PAGE} />
      <NewSection onCreated={(id) => saveOrder([...keys, `section:${id}`])} />
      {ghost}
    </div>
  );
}
