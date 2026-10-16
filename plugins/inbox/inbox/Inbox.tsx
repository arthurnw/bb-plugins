import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  experimental_useProviders as useProviders,
  experimental_useSidebarThreads as useSidebarThreads,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { cn } from "@/lib/utils";
import { Card, type CardAction, type CardMeta, type Layout } from "./Card.tsx";
import { Icon, type IconName } from "./icons.tsx";
import { RollingNumber, useFlip, useNow } from "./motion.tsx";
import { GROUPS, compareRows, groupOf, statusOf, type Group, type Status } from "./status.ts";

const ALL_PROJECTS = "all";
const VIEW_KEY = "bb-inbox:view";
/** Done holds every idle thread too; past this many it folds the rest behind a button. */
const DONE_LIMIT = 12;

/** The threads the inbox lists: everything in bb's own list. */
const listed = (thread: PluginSidebarThread) => !thread.isArchived && !thread.isHidden;

function isTyping(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

function readView(): Layout {
  try {
    return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "board";
  } catch {
    return "board";
  }
}

interface Item {
  thread: PluginSidebarThread;
  status: Status;
  latestAttentionAt: number;
}

const KEYS: [string, string][] = [
  ["j / k", "move"],
  ["h / l", "previous / next column"],
  ["Enter", "unfold"],
  ["o", "open (⇧ split)"],
  ["a / x", "approve / reject"],
  ["1–9", "pick an answer"],
  ["r", "retry"],
  ["s", "stop"],
  ["e", "mark read"],
  ["v", "board / list"],
];

function ViewToggle({ view, onChange }: { view: Layout; onChange(view: Layout): void }) {
  const options: { id: Layout; label: string; icon: IconName }[] = [
    { id: "board", label: "Board", icon: "Columns3" },
    { id: "list", label: "List", icon: "List" },
  ];
  return (
    <div role="radiogroup" aria-label="View" className="bb-inbox-well flex items-center gap-0.5 rounded-lg p-0.5">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={view === option.id}
          onClick={() => onChange(option.id)}
          className={cn(
            "flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors",
            view === option.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon name={option.icon} className="size-3.5" />
          {option.label}
        </button>
      ))}
    </div>
  );
}

function GroupHeader({ label, count, layout }: { label: string; count: number; layout: Layout }) {
  return (
    <div className={cn("flex items-center gap-2 px-2 pb-1.5 pt-1", layout === "board" && "justify-between")}>
      <Icon name="Sparkle" className="size-3 text-muted-foreground/70" />
      <span className={cn("text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground", layout === "board" && "flex-1 text-center")}>
        {label}
      </span>
      <span className="rounded bg-foreground/[0.07] px-1.5 text-[11px] font-medium leading-[18px] text-muted-foreground">
        <RollingNumber value={count} />
      </span>
    </div>
  );
}

export function InboxPage() {
  const { status: loadStatus, threads, projects } = useSidebarThreads();
  const { providers } = useProviders();
  const [view, setView] = useState<Layout>(readView);
  const [projectId, setProjectId] = useState<string>(ALL_PROJECTS);
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(() => new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAllDone, setShowAllDone] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const now = useNow(15_000);
  const boardRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const actions = useRef(new Map<string, CardAction[]>());

  const providerName = useMemo(() => new Map(providers.map((provider) => [provider.id, provider.displayName])), [providers]);
  const projectName = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects]);
  const byId = useMemo(() => new Map(threads.map((thread) => [thread.id, thread])), [threads]);

  const groups = useMemo(() => {
    const result: Record<Group, Item[]> = { needs: [], running: [], done: [] };
    for (const thread of threads) {
      if (!listed(thread) || (projectId !== ALL_PROJECTS && thread.projectId !== projectId)) continue;
      const status = statusOf(thread);
      result[groupOf(status)].push({ thread, status, latestAttentionAt: thread.latestAttentionAt });
    }
    for (const items of Object.values(result)) items.sort(compareRows);
    return result;
  }, [threads, projectId]);

  const shown: Record<Group, Item[]> = {
    ...groups,
    done: showAllDone ? groups.done : groups.done.slice(0, DONE_LIMIT),
  };
  /** Every visible card, in reading order: what j and k walk. */
  const order = [...shown.needs, ...shown.running, ...shown.done];
  useFlip(boardRef, `${view}:${GROUPS.map((group) => shown[group.id].map((item) => item.thread.id).join(",")).join("|")}`);

  const selected = order.find((item) => item.thread.id === selectedId) ?? null;

  // Start on the first card, and pick a new one when the selected card leaves the inbox.
  useEffect(() => {
    if (selected === null && order.length > 0) setSelectedId(order[0]!.thread.id);
  }, [selected, order]);

  const changeView = (next: Layout) => {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // Private mode: the choice lasts for this page only.
    }
  };

  const toggle = useCallback((id: string) => {
    setOpenIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const registerActions = useCallback((id: string, list: CardAction[] | null) => {
    if (list === null) actions.current.delete(id);
    else actions.current.set(id, list);
  }, []);

  // After an answer, move on to the next card that needs you, as a mail inbox does.
  const orderRef = useRef(order);
  orderRef.current = order;
  const onAnswered = useCallback((threadId: string) => {
    const current = orderRef.current;
    const index = current.findIndex((item) => item.thread.id === threadId);
    const rest = [...current.slice(index + 1), ...current.slice(0, Math.max(0, index))];
    const next = rest.find((item) => groupOf(item.status) === "needs") ?? null;
    if (next !== null) setSelectedId(next.thread.id);
  }, []);

  const meta = (thread: PluginSidebarThread): CardMeta => {
    const parent = thread.parentThreadId === null ? undefined : byId.get(thread.parentThreadId);
    return {
      provider: providerName.get(thread.providerId) ?? thread.providerId,
      project: projectId === ALL_PROJECTS ? (projectName.get(thread.projectId) ?? null) : null,
      parentTitle: parent?.displayTitle ?? null,
    };
  };

  useEffect(() => {
    if (selectedId === null) return;
    boardRef.current?.querySelector<HTMLElement>(`[data-flip-id="${CSS.escape(selectedId)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  // Keys are read on the window, not the page: clicking a button that then
  // disables itself (Approve) drops focus to the document body, and a page
  // listener would stop hearing keys. Keys typed elsewhere in bb are left alone.
  const onKey = useRef<(event: KeyboardEvent) => void>(() => undefined);
  onKey.current = (event) => {
    const target = event.target;
    const inPage = target instanceof Node && pageRef.current?.contains(target) === true;
    // Focus falls to the body after a click anywhere, so body keys count only
    // when the inbox was the last thing used (it may share the window with a thread).
    const ours = inPage || (target === document.body && active.current);
    if (!ours || event.metaKey || event.ctrlKey || event.altKey || isTyping(target)) return;
    const key = event.key;
    const move = (delta: number) => {
      if (order.length === 0) return;
      const index = selected === null ? -1 : order.indexOf(selected);
      const next = index === -1 ? (delta > 0 ? 0 : order.length - 1) : Math.min(order.length - 1, Math.max(0, index + delta));
      setSelectedId(order[next]!.thread.id);
    };
    // h and l jump to the neighboring column (or list section) that has cards,
    // keeping the selection's position in it where they can.
    const moveGroup = (delta: number) => {
      const groupIds = GROUPS.map((group) => group.id);
      const from = selected === null ? -1 : groupIds.indexOf(groupOf(selected.status));
      const row = selected === null ? 0 : Math.max(0, shown[groupOf(selected.status)].indexOf(selected));
      for (let index = from + delta; index >= 0 && index < groupIds.length; index += delta) {
        const items = shown[groupIds[index]!];
        if (items.length === 0) continue;
        setSelectedId(items[Math.min(row, items.length - 1)]!.thread.id);
        return;
      }
    };
    if (key === "j" || key === "ArrowDown") move(1);
    else if (key === "h" || key === "ArrowLeft") moveGroup(-1);
    else if (key === "l" || key === "ArrowRight") moveGroup(1);
    else if (key === "k" || key === "ArrowUp") move(-1);
    else if (key === "?") setShowKeys((value) => !value);
    else if (key === "v") changeView(view === "board" ? "list" : "board");
    else if (selected !== null && (key === "Enter" || key === " ")) {
      // A focused button already activates on Enter and Space.
      if (target instanceof HTMLButtonElement) return;
      toggle(selected.thread.id);
    } else if (selected !== null) {
      const action = actions.current.get(selected.thread.id)?.find((candidate) => candidate.shortcut === key.toLowerCase());
      if (action === undefined) return;
      action.run({ split: event.shiftKey });
    } else return;
    event.preventDefault();
  };
  const active = useRef(true);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey.current(event);
    const track = (event: Event) => {
      active.current = event.target instanceof Node && pageRef.current?.contains(event.target) === true;
    };
    window.addEventListener("keydown", listener);
    window.addEventListener("pointerdown", track, true);
    window.addEventListener("focusin", track, true);
    return () => {
      window.removeEventListener("keydown", listener);
      window.removeEventListener("pointerdown", track, true);
      window.removeEventListener("focusin", track, true);
    };
  }, []);

  const empty = order.length === 0;

  return (
    <div ref={pageRef} className="bb-inbox h-full min-h-0 flex-1 overflow-y-auto">
      <div className={cn("mx-auto box-border w-full px-4 pb-8 pt-3 md:px-6 md:pt-4", view === "board" ? "max-w-6xl" : "max-w-3xl")}>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
            aria-label="Project"
            className="h-8 max-w-56 truncate rounded-md border border-border bg-transparent px-2 text-sm font-medium text-foreground"
          >
            <option value={ALL_PROJECTS}>All projects</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <div className="ml-auto flex items-center gap-1.5">
            <ViewToggle view={view} onChange={changeView} />
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
        {empty ? (
          <div role="status" className="mt-4 rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
            {loadStatus === "loading" ? "Loading threads…" : "No threads yet."}
          </div>
        ) : (
          <div ref={boardRef} className={cn("mt-4 grid items-start gap-3", view === "board" ? "md:grid-cols-3" : "grid-cols-1")}>
            {GROUPS.map((group) => {
              const items = shown[group.id];
              if (view === "list" && items.length === 0) return null;
              const hidden = groups[group.id].length - items.length;
              return (
                <section key={group.id} aria-label={group.label} className="bb-inbox-well rounded-xl p-1.5">
                  <GroupHeader label={group.label} count={groups[group.id].length} layout={view} />
                  {items.length === 0 ? (
                    <div className="px-2 py-6 text-center text-xs text-muted-foreground">
                      {group.id === "needs" ? "Nothing needs you." : group.id === "running" ? "No agents running." : "Nothing finished yet."}
                    </div>
                  ) : (
                    <ul className="space-y-1.5">
                      {items.map(({ thread, status }) => (
                        <Card
                          key={thread.id}
                          thread={thread}
                          status={status}
                          meta={meta(thread)}
                          layout={view}
                          open={openIds.has(thread.id)}
                          selected={thread.id === selected?.thread.id}
                          now={now}
                          onToggle={() => toggle(thread.id)}
                          onSelect={() => setSelectedId(thread.id)}
                          onAnswered={() => onAnswered(thread.id)}
                          registerActions={registerActions}
                        />
                      ))}
                    </ul>
                  )}
                  {group.id === "done" && (hidden > 0 || showAllDone) && groups.done.length > DONE_LIMIT ? (
                    <button
                      type="button"
                      onClick={() => setShowAllDone((value) => !value)}
                      className="mt-1.5 w-full rounded-md py-1.5 text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground"
                    >
                      {showAllDone ? "Show fewer" : `Show ${hidden} more`}
                    </button>
                  ) : null}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/** The count beside the Inbox entry in bb's sidebar: threads that need you. */
export function NeedsYouCount() {
  const { threads } = useSidebarThreads();
  const count = threads.filter((thread) => listed(thread) && groupOf(statusOf(thread)) === "needs").length;
  if (count === 0) return null;
  return (
    <span className="bb-inbox">
      <span
        data-status="waiting"
        className="bb-inbox-tone inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-foreground/[0.07] px-1 text-[10px] font-semibold tabular-nums"
      >
        {count}
      </span>
    </span>
  );
}
