// The "All" mode: bb's regular thread list, drawn by Bots, with each bot
// thread's avatar in place of its provider icon. Organization, sort, and
// collapse state are bb's own thread-list preferences, read and written back.
import {
  experimental_useProviders as useProviders,
  experimental_useSidebarThreads as useSidebarThreads,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { useMemo, type ReactNode } from "react";
import type { Bot } from "@arthurnw/bb-shared/bots";
import { organizeAll, type AllGroup, type AllNode } from "./all-model";
import { Group, groupTitle, NewSection, PAGE, plainButton, SectionActions, ThreadRow, type RowContext } from "./list-parts";
import { useThreadListPreferences, type PrefKey } from "./thread-list-prefs";

function NodeRow({ node, depth, context }: { node: AllNode<PluginSidebarThread>; depth: number; context: RowContext }) {
  return (
    <ThreadRow thread={node.thread} depth={depth} childCount={node.children.length} context={context}
      renderChildren={() => node.children.map((kid) => <NodeRow key={kid.thread.id} node={kid} depth={depth + 1} context={context} />)} />
  );
}

const noDrag = () => () => {};

export function AllView({ activeThreadId, bots, threadBots, onOpen, header }: {
  activeThreadId: string | null; bots: readonly Bot[]; threadBots: Record<string, string>;
  onOpen: (thread: PluginSidebarThread) => void; header: ReactNode;
}) {
  const { prefs, set } = useThreadListPreferences();
  const sidebar = useSidebarThreads({ experimental_lifecycles: prefs.threadLifecycles });
  const { providers } = useProviders();
  const groups = useMemo(() => organizeAll({ threads: sidebar.threads, prefs, sections: sidebar.sections }), [sidebar.threads, sidebar.sections, prefs]);
  const toggleIn = (key: PrefKey & ("collapsedSections" | "collapsedThreadSections" | "collapsedThreads"), id: string) => {
    const current = prefs[key] as string[];
    set(key, current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };
  const collapsedThreads = useMemo(() => new Set(prefs.collapsedThreads), [prefs.collapsedThreads]);
  const context: RowContext = {
    activeThreadId, over: null, bots, threadBots, providers, onOpen, startDrag: noDrag,
    collapsedThreads, toggleThread: (id) => toggleIn("collapsedThreads", id), preferences: prefs, leadingAvatar: true,
  };
  const collapse = (group: AllGroup<PluginSidebarThread>) => group.kind === "section"
    ? { collapsed: prefs.collapsedThreadSections.includes(group.sectionId!), onToggle: () => toggleIn("collapsedThreadSections", group.sectionId!) }
    : { collapsed: prefs.collapsedSections.includes(group.key), onToggle: () => toggleIn("collapsedSections", group.key) };
  const archived = sidebar.experimental_archived;

  if (sidebar.status === "loading") return <div style={{ padding: 12, fontSize: 12, color: "var(--muted-foreground)" }}>Loading…</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "4px 4px 16px" }}>
      {header}
      {groups.map((group) => {
        const section = group.kind === "section" ? sidebar.sections.find((item) => item.id === group.sectionId) : undefined;
        return (
          <Group key={group.key} dropKey={group.key} over={null} {...collapse(group)} roots={group.roots}
            title={<span style={groupTitle}>{group.title}</span>}
            actions={section && <SectionActions section={section} />}
            empty={group.kind === "section" ? "No threads" : undefined}
            limit={group.kind === "threads" ? PAGE : undefined}
            renderRoot={(node) => <NodeRow key={node.thread.id} node={node} depth={0} context={context} />} />
        );
      })}
      {archived?.hasNextPage && (
        <button type="button" disabled={archived.isFetchingNextPage} onClick={() => void archived.fetchNextPage()}
          style={{ ...plainButton, padding: "4px 8px", fontSize: 12, color: "var(--muted-foreground)" }}>
          {archived.isFetchingNextPage ? "Loading archived threads…" : "Show more archived threads"}
        </button>
      )}
      <NewSection onCreated={() => {}} />
    </div>
  );
}
