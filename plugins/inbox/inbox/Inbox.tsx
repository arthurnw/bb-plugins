import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  experimental_useProviders as useProviders,
  experimental_useSidebarThreads as useSidebarThreads,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { cn } from "@/lib/utils";
import { Icon } from "./icons.tsx";
import { RollingNumber, useFlip, useNow } from "./motion.tsx";
import { Row, type RowAction, type RowMeta } from "./Row.tsx";
import { FILTERS, compareRows, matchesFilter, statusOf, type Filter, type Status } from "./status.ts";

const ALL_PROJECTS = "all";

/** The threads the inbox lists: everything in bb's own list. */
const listed = (thread: PluginSidebarThread) => !thread.isArchived && !thread.isHidden;

function isTyping(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

/** Filter tabs with rolling counts and a pill that slides to the active tab. */
function Tabs({ filter, counts, onChange }: { filter: Filter; counts: Record<Filter, number>; onChange(filter: Filter): void }) {
  const refs = useRef(new Map<Filter, HTMLButtonElement>());
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const tab = refs.current.get(filter);
    if (tab) setPill({ left: tab.offsetLeft, width: tab.offsetWidth });
  }, [filter, counts]);
  return (
    <div role="tablist" aria-label="Filter" className="relative flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
      {pill !== null ? (
        <span
          aria-hidden
          className="bb-inbox-pill absolute inset-y-0.5 left-0 rounded-md bg-background shadow-sm"
          style={{ transform: `translateX(${pill.left}px)`, width: pill.width }}
        />
      ) : null}
      {FILTERS.map((tab, index) => (
        <button
          key={tab.id}
          ref={(node) => {
            if (node) refs.current.set(tab.id, node);
          }}
          type="button"
          role="tab"
          aria-selected={filter === tab.id}
          title={`${tab.label} (${index + 1})`}
          onClick={() => onChange(tab.id)}
          className={cn(
            "relative flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors",
            filter === tab.id ? "text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {tab.label}
          <span className={cn("text-[11px]", filter === tab.id ? "text-muted-foreground" : "text-muted-foreground/70")}>
            <RollingNumber value={counts[tab.id]} />
          </span>
        </button>
      ))}
    </div>
  );
}

function Empty({ filter, loading }: { filter: Filter; loading: boolean }) {
  const text = loading
    ? "Loading threads…"
    : filter === "waiting"
      ? "Nothing needs you right now."
      : filter === "running"
        ? "No agents are running."
        : filter === "failed"
          ? "No failed threads."
          : filter === "done"
            ? "No finished threads."
            : "No threads yet.";
  return (
    <div role="status" className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}

const KEYS: [string, string][] = [
  ["j / k", "move"],
  ["Enter", "unfold"],
  ["o", "open (⇧ split)"],
  ["a / x", "approve / reject"],
  ["r", "retry"],
  ["s", "stop"],
  ["e", "mark read"],
  ["1–5", "filters"],
];

export function InboxPage() {
  const { status: loadStatus, threads, projects } = useSidebarThreads();
  const { providers } = useProviders();
  const [filter, setFilter] = useState<Filter>("all");
  const [projectId, setProjectId] = useState<string>(ALL_PROJECTS);
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(() => new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showKeys, setShowKeys] = useState(false);
  const now = useNow(15_000);
  const listRef = useRef<HTMLUListElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const actions = useRef(new Map<string, RowAction[]>());

  const providerName = useMemo(() => new Map(providers.map((provider) => [provider.id, provider.displayName])), [providers]);
  const projectName = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects]);
  const byId = useMemo(() => new Map(threads.map((thread) => [thread.id, thread])), [threads]);

  const rows = useMemo(() => {
    const inScope = threads.filter((thread) => listed(thread) && (projectId === ALL_PROJECTS || thread.projectId === projectId));
    return inScope
      .map((thread) => ({ thread, status: statusOf(thread), latestAttentionAt: thread.latestAttentionAt }))
      .sort(compareRows);
  }, [threads, projectId]);

  const counts = useMemo(() => {
    const result = { all: 0, waiting: 0, running: 0, failed: 0, done: 0 } satisfies Record<Filter, number>;
    for (const row of rows) for (const tab of FILTERS) if (matchesFilter(row.status, tab.id)) result[tab.id] += 1;
    return result;
  }, [rows]);

  const visible = useMemo(() => rows.filter((row) => matchesFilter(row.status, filter)), [rows, filter]);
  useFlip(listRef, visible.map((row) => row.thread.id).join(","));

  // Keep a selection on screen: the first row when the old one leaves the view.
  const selected = visible.find((row) => row.thread.id === selectedId) ?? null;
  const selectedIndex = selected === null ? -1 : visible.indexOf(selected);

  const toggle = useCallback((id: string) => {
    setOpenIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const registerActions = useCallback((id: string, list: RowAction[] | null) => {
    if (list === null) actions.current.delete(id);
    else actions.current.set(id, list);
  }, []);

  const meta = (thread: PluginSidebarThread): RowMeta => {
    const parent = thread.parentThreadId === null ? undefined : byId.get(thread.parentThreadId);
    return {
      provider: providerName.get(thread.providerId) ?? thread.providerId,
      project: projectId === ALL_PROJECTS ? (projectName.get(thread.projectId) ?? null) : null,
      parentTitle: parent?.displayTitle ?? null,
    };
  };

  useEffect(() => {
    pageRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (selectedId === null) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-flip-id="${CSS.escape(selectedId)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
    const key = event.key;
    const move = (delta: number) => {
      if (visible.length === 0) return;
      const index = selectedIndex === -1 ? (delta > 0 ? 0 : visible.length - 1) : Math.min(visible.length - 1, Math.max(0, selectedIndex + delta));
      setSelectedId(visible[index]!.thread.id);
    };
    if (key === "j" || key === "ArrowDown") move(1);
    else if (key === "k" || key === "ArrowUp") move(-1);
    else if (/^[1-5]$/.test(key) && !(selected !== null && openIds.has(selected.thread.id) && hasChoice(selected.thread.id))) {
      setFilter(FILTERS[Number(key) - 1]!.id);
    } else if (key === "?") setShowKeys((value) => !value);
    else if (selected !== null && (key === "Enter" || key === " ")) {
      // A focused button already activates on Enter and Space.
      if (event.target instanceof HTMLButtonElement) return;
      toggle(selected.thread.id);
    } else if (selected !== null) {
      const action = actions.current.get(selected.thread.id)?.find((candidate) => candidate.shortcut === key.toLowerCase());
      if (action === undefined) return;
      action.run({ split: event.shiftKey });
    } else return;
    event.preventDefault();
  };

  const hasChoice = (id: string) => actions.current.get(id)?.some((action) => action.id.startsWith("choice-")) ?? false;

  return (
    <div ref={pageRef} tabIndex={-1} onKeyDown={onKeyDown} className="bb-inbox h-full min-h-0 flex-1 overflow-y-auto outline-none">
      <div className="mx-auto box-border w-full max-w-3xl px-4 pb-6 pt-3 md:px-5 md:pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <Tabs filter={filter} counts={counts} onChange={setFilter} />
          <div className="ml-auto flex items-center gap-1">
            <select
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              aria-label="Project"
              className="h-8 max-w-48 truncate rounded-md border border-input bg-transparent px-2 text-xs text-foreground"
            >
              <option value={ALL_PROJECTS}>All projects</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              aria-label="Keyboard shortcuts (?)"
              title="Keyboard shortcuts (?)"
              aria-pressed={showKeys}
              onClick={() => setShowKeys((value) => !value)}
              className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground aria-pressed:bg-state-active"
            >
              <Icon name="Keyboard" className="size-4" />
            </button>
          </div>
        </div>
        {showKeys ? (
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 rounded-md border border-border px-3 py-2 text-[11px] text-muted-foreground">
            {KEYS.map(([keys, label]) => (
              <span key={keys}>
                <kbd className="font-mono text-foreground">{keys}</kbd> {label}
              </span>
            ))}
          </div>
        ) : null}
        <div className="mt-3">
          {visible.length === 0 ? (
            <Empty filter={filter} loading={loadStatus === "loading"} />
          ) : (
            <ul ref={listRef} className="overflow-hidden rounded-lg border border-border bg-card">
              {visible.map(({ thread, status }) => (
                <Row
                  key={thread.id}
                  thread={thread}
                  status={status as Status}
                  meta={meta(thread)}
                  open={openIds.has(thread.id)}
                  selected={thread.id === selected?.thread.id}
                  now={now}
                  onToggle={() => toggle(thread.id)}
                  onSelect={() => setSelectedId(thread.id)}
                  registerActions={registerActions}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/** The count beside the Inbox entry in bb's sidebar: threads that need you. */
export function NeedsYouCount() {
  const { threads } = useSidebarThreads();
  const count = threads.filter((thread) => listed(thread) && statusOf(thread) === "waiting").length;
  if (count === 0) return null;
  return (
    <span className="bb-inbox">
      <span
        data-status="waiting"
        className="bb-inbox-tag inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums"
      >
        {count}
      </span>
    </span>
  );
}
