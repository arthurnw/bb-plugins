// The "All" mode: bb's regular thread list, drawn by Bots, with each bot
// thread's avatar in place of its provider icon. Organization, sort, and
// collapse state are bb's own thread-list preferences, read and written back.
import {
  experimental_Icon as Icon,
  experimental_useProviders as useProviders,
  experimental_useSidebarThreads as useSidebarThreads,
  useSdk,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import type { Bot } from "@arthurnw/bb-shared/bots";
import { planDrop, reorderGroups, type DropAction } from "./all-drop";
import { organizeAll, splitHidden, type AllGroup, type AllItem, type AllNode } from "./all-model";
import { GroupMenu, OrganizeMenu } from "./all-menus";
import { chevron, DragGhost, errorText, Group, groupTitle, iconSlot, NewSection, PAGE, plainButton, rowStyle, ThreadRow, useDrag, type DragPayload, type RowContext } from "./list-parts";
import { useThreadListPreferences, type ThreadListPrefs } from "./thread-list-prefs";

type Thread = PluginSidebarThread;
type ListKey = { [K in keyof ThreadListPrefs]: string[] extends ThreadListPrefs[K] ? K : never }[keyof ThreadListPrefs];

interface ItemContext extends RowContext {
  collapsedEnvironments: ReadonlySet<string>;
  toggleEnvironment: (id: string) => void;
}

function NodeRow({ node, depth, context }: { node: AllNode<Thread>; depth: number; context: ItemContext }) {
  return (
    <ThreadRow thread={node.thread} depth={depth} childCount={node.children.length} context={context}
      renderChildren={() => node.children.map((item) => <ItemRow key={itemKey(item)} item={item} depth={depth + 1} context={context} />)} />
  );
}

/** A worktree row: sibling threads that share one worktree, collapsible. */
function EnvironmentRow({ item, depth, context }: { item: Extract<AllItem<Thread>, { kind: "environment" }>; depth: number; context: ItemContext }) {
  const open = !context.collapsedEnvironments.has(item.id);
  return (
    <>
      <button type="button" aria-expanded={open} title={item.label} onClick={() => context.toggleEnvironment(item.id)}
        style={{ ...plainButton, ...rowStyle, width: "100%", boxSizing: "border-box", alignItems: "center", paddingLeft: 8 + depth * 14, color: "var(--muted-foreground)" }}>
        <span style={iconSlot}><Icon name="GitBranch" className="size-3.5" aria-hidden /></span>
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.label}</span>
        <span style={chevron}>{open ? "▾" : `${item.nodes.length} ▸`}</span>
      </button>
      {open && item.nodes.map((node) => <NodeRow key={node.thread.id} node={node} depth={depth + 1} context={context} />)}
    </>
  );
}

const itemKey = (item: AllItem<Thread>) => item.kind === "thread" ? item.node.thread.id : `env:${item.id}`;
function ItemRow({ item, depth, context }: { item: AllItem<Thread>; depth: number; context: ItemContext }) {
  return item.kind === "thread"
    ? <NodeRow node={item.node} depth={depth} context={context} />
    : <EnvironmentRow item={item} depth={depth} context={context} />;
}

const GROUP_TARGETS = "section[data-drop]";

// Kept across remounts, like bb's list: the open thread's unread state when it
// was opened, and the parents expanded while grouping by read status.
let opened: { threadId: string; isUnread: boolean } | null = null;
let readStatusExpanded: readonly string[] = [];
let moreOpen = false;

/** While grouping by read status, the open thread keeps its place until another thread opens. */
function readOverrideFor(activeThreadId: string | null, threads: readonly Thread[]) {
  if (opened?.threadId !== activeThreadId) {
    const current = activeThreadId === null ? undefined : threads.find((thread) => thread.id === activeThreadId);
    opened = current ? { threadId: current.id, isUnread: current.isUnread } : null;
  }
  return opened;
}

export function AllView({ activeThreadId, bots, threadBots, onOpen, header }: {
  activeThreadId: string | null; bots: readonly Bot[]; threadBots: Record<string, string>;
  onOpen: (thread: Thread) => void; header: ReactNode;
}) {
  const { prefs, set } = useThreadListPreferences();
  const sidebar = useSidebarThreads({ experimental_lifecycles: prefs.threadLifecycles });
  const { providers } = useProviders();
  const [expanded, setExpanded] = useState(readStatusExpanded);
  const [showMore, setShowMore] = useState(moreOpen);
  const toggleMore = () => { moreOpen = !showMore; setShowMore(moreOpen); };
  const readOverride = prefs.groupByReadStatus ? readOverrideFor(activeThreadId, sidebar.threads) : null;
  const groups = useMemo(() => organizeAll({
    threads: sidebar.threads, prefs, sections: sidebar.sections, projects: sidebar.projects, hosts: sidebar.experimental_hosts ?? [], readOverride,
  }), [sidebar.threads, sidebar.sections, sidebar.projects, sidebar.experimental_hosts, prefs, readOverride]);
  const toggleIn = (key: ListKey, id: string) => {
    const current = prefs[key];
    set(key, current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };
  const collapsedThreads = useMemo(() => new Set(prefs.collapsedThreads), [prefs.collapsedThreads]);
  const collapsedEnvironments = useMemo(() => new Set(prefs.collapsedEnvironments), [prefs.collapsedEnvironments]);
  // Grouping by read status starts every parent collapsed without touching collapsedThreads.
  const readStatusCollapsed = useMemo(() => { const open = new Set(expanded); return { has: (id: string) => !open.has(id) }; }, [expanded]);
  const toggleReadStatusParent = (id: string) => {
    readStatusExpanded = expanded.includes(id) ? expanded.filter((item) => item !== id) : [...expanded, id];
    setExpanded(readStatusExpanded);
  };
  const sdk = useSdk();
  const threadsById = useMemo(() => new Map(sidebar.threads.map((thread) => [thread.id, thread])), [sidebar.threads]);
  const run = async (actions: readonly DropAction[]) => {
    try {
      for (const action of actions) {
        if (action.kind === "pin") await sdk.threads.pin({ threadId: action.threadId });
        else if (action.kind === "unpin") await sdk.threads.unpin({ threadId: action.threadId });
        else if (action.kind === "reorderPinned") {
          await sdk.threads.reorderPinned({ threadId: action.threadId, previousThreadId: action.previousThreadId, nextThreadId: action.nextThreadId });
        } else {
          const { kind: _, ...update } = action;
          await sdk.threads.update(update);
        }
      }
    } catch (error) {
      toast.error(errorText(error));
    }
  };
  const onDrop = (payload: DragPayload, target: string) => {
    if (payload.kind === "group") {
      const change = reorderGroups(prefs, groups.map((group) => group.key), payload.key, target);
      if (change) set(change.key, change.value);
      return;
    }
    const plan = planDrop({ thread: payload.thread, target, groups, threadsById, mode: prefs.organizationMode,
      personalProjectId: sidebar.projects.find((project) => project.isPersonal)?.id ?? null });
    if (plan.kind === "rejected") { if (plan.reason !== "already-child") toast.error(plan.reason); }
    else if (plan.kind === "apply") void run(plan.actions);
  };
  const dragState = useDrag(onDrop, GROUP_TARGETS, true);
  const open = (thread: Thread) => {
    if (dragState.suppressClick.current) { dragState.suppressClick.current = false; return; }
    onOpen(thread);
  };
  const context: ItemContext = {
    activeThreadId, over: dragState.over, bots, threadBots, providers, onOpen: open, startDrag: (thread) => dragState.start({ kind: "thread", thread }),
    preferences: prefs, leadingAvatar: true,
    collapsedThreads: prefs.groupByReadStatus ? readStatusCollapsed : collapsedThreads,
    toggleThread: prefs.groupByReadStatus ? toggleReadStatusParent : (id) => toggleIn("collapsedThreads", id),
    collapsedEnvironments, toggleEnvironment: (id) => toggleIn("collapsedEnvironments", id),
  };
  const collapse = (group: AllGroup<Thread>) => {
    const key: ListKey = group.kind === "section" ? "collapsedThreadSections" : group.kind === "project" ? "collapsedProjects"
      : group.kind === "machine" ? "collapsedMachines" : "collapsedSections";
    const id = group.entityId ?? group.key;
    return { collapsed: prefs[key].includes(id), onToggle: () => toggleIn(key, id) };
  };
  const archived = sidebar.experimental_archived;

  const { shown, hidden } = splitHidden(groups, prefs.hiddenGroups);
  const renderGroup = (group: AllGroup<Thread>) => {
    const section = group.kind === "section" ? sidebar.sections.find((item) => item.id === group.entityId) : undefined;
    return (
      <Group key={group.key} dropKey={group.key} over={dragState.over} {...collapse(group)} roots={group.roots}
        onHeaderPointerDown={dragState.start({ kind: "group", key: group.key, label: group.title })}
        title={<span style={{ ...groupTitle, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{group.title}</span>}
        actions={group.kind !== "pinned" && <GroupMenu title={group.title} groupKey={group.key} section={section} prefs={prefs} set={set} />}
        empty={group.kind === "pinned" || group.kind === "threads" ? undefined : "No threads"}
        limit={group.kind === "pinned" || group.kind === "section" ? undefined : PAGE}
        renderRoot={(item) => <ItemRow key={itemKey(item)} item={item} depth={0} context={context} />} />
    );
  };

  if (sidebar.status === "loading") return <div style={{ padding: 12, fontSize: 12, color: "var(--muted-foreground)" }}>Loading…</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "4px 4px 16px", userSelect: dragState.drag ? "none" : undefined }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingRight: 4 }}>
        {header}
        <OrganizeMenu prefs={prefs} set={set} />
      </div>
      {shown.map(renderGroup)}
      {hidden.length > 0 && (
        <section aria-label="More">
          <button type="button" aria-expanded={showMore} onClick={toggleMore}
            style={{ ...plainButton, ...groupTitle, display: "flex", alignItems: "center", gap: 6, padding: "6px 8px 2px" }}>
            <Icon name="MoreHorizontal" className="size-3.5" aria-hidden />More
            <span style={{ fontSize: 11, fontWeight: 400 }}>{showMore ? "▾" : `${hidden.length} ▸`}</span>
          </button>
          {showMore && <div style={{ paddingLeft: 8 }}>{hidden.map(renderGroup)}</div>}
        </section>
      )}
      {archived?.hasNextPage && (
        <button type="button" disabled={archived.isFetchingNextPage} onClick={() => void archived.fetchNextPage()}
          style={{ ...plainButton, padding: "4px 8px", fontSize: 12, color: "var(--muted-foreground)" }}>
          {archived.isFetchingNextPage ? "Loading archived threads…" : "Show more archived threads"}
        </button>
      )}
      {prefs.organizationMode === "chronological" && <NewSection onCreated={() => {}} />}
      <DragGhost drag={dragState.drag} />
    </div>
  );
}
