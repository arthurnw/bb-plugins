import type * as React from "react";
import type { VariantProps } from "class-variance-authority";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
  SelectionMode,
  useStore,
  useStoreApi,
  type Edge,
  type NodeChange,
  type Viewport,
} from "@xyflow/react";
import { toast } from "sonner";
import { Drawer } from "vaul";
import {
  ThreadChat,
  experimental_usePluginId as usePluginId,
  experimental_useSidebarThreads as useSidebarThreads,
  useBbNavigate,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
  useSdk,
  useSettings,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport";
import { usePortalScopeProps } from "@/lib/portal-scope";
import { cn } from "@/lib/utils";
import type { Arrangement, Layout, Note, PinnedChat, rpcContract } from "../server";
import { CanvasActionsContext, type CanvasActions } from "./context";
import { Icon, type IconName } from "./icons.tsx";
import { CARD_H, CARD_W, DEFAULT_ARRANGE, arrangeGroup, autoLayout, frameBounds, placeNew, type ArrangeOptions, type Point, type Rect } from "./layout.ts";
import { DIRECTION_KEYS, nearestInDirection, nearestTo, type Direction, type NavItem } from "./nav.ts";
import { nodeTypes, type CanvasNode } from "./nodes";
import { matchesShortcut, shortcutLabel, useArchive, useArchiveShortcut } from "./archive.ts";
import { childForest, childListHeight } from "./children.ts";
import { useReleaseChatFocus } from "./chatFocus.ts";
import { useCollapseHostSidebar } from "./hostSidebar.ts";
import { useOpenUrlRequests } from "./openUrl.ts";
import { Picker, type PickerItem } from "./Picker.tsx";
import { CHAT_H, CHAT_HEADER_H, CHAT_W } from "./ChatNode.tsx";
import { edgeTypes } from "./TetherEdge.tsx";
import { Triage, needsAttention } from "./Triage.tsx";
import { GROUPINGS, LAYOUT_CHANGED, emptyLayout, type ArrangeStyle, type Grouping } from "./shared.ts";
import { BUCKETS, BUCKET_LABEL, age, bucketOf, type Bucket } from "./status.ts";

const CLIENT_ID = Math.random().toString(36).slice(2, 10);
const UNDO_LIMIT = 50;
const NO_GROUP = "none";
const EMPTY_ARRANGEMENT: Arrangement = emptyLayout().arrangements.project;
const GROUPING_LABEL: Record<Grouping, string> = { project: "Project", section: "Section", machine: "Machine" };

/** A promise rejection handler that reports "Could not <what>: <error>". */
const failed = (what: string) => (error: unknown) =>
  void toast.error(`Could not ${what}: ${error instanceof Error ? error.message : String(error)}`);

/**
 * The last layout this app session saw. Leaving the canvas unmounts it, and
 * coming back would otherwise wait on a round trip to the server (slow when
 * bb runs on another machine) before drawing anything; this draws the last
 * known layout at once and refreshes it in the background.
 */
let lastLayout: Layout | null = null;

function useStoredLayout() {
  const rpc = useRpc<typeof rpcContract>();
  const [layout, setLayoutState] = useState<Layout | null>(lastLayout);
  const setLayout = useCallback((next: Layout | null | ((current: Layout | null) => Layout | null)) => {
    setLayoutState((current) => {
      const value = typeof next === "function" ? next(current) : next;
      lastLayout = value;
      return value;
    });
  }, []);
  const refetch = useCallback(() => {
    rpc.call("layout_get").then(setLayout, (error: unknown) => {
      failed("load the canvas layout")(error);
      setLayout((current) => current ?? emptyLayout());
    });
  }, [rpc, setLayout]);
  useEffect(refetch, [refetch]);
  useRealtime(LAYOUT_CHANGED, (payload) => {
    if ((payload as { origin: string }).origin !== CLIENT_ID) refetch();
  });
  // Realtime signals are not replayed; catch up after a reconnect.
  const connection = useRealtimeConnectionState();
  const wasConnected = useRef(false);
  useEffect(() => {
    if (connection !== "connected") return;
    if (wasConnected.current) refetch();
    wasConnected.current = true;
  }, [connection, refetch]);
  return { rpc, layout, setLayout };
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** A string kept in localStorage. */
function useStoredPreference<T extends string>(key: string, fallback: T) {
  const [value, setValue] = useState(() => (localStorage.getItem(key) as T | null) ?? fallback);
  const update = useCallback(
    (next: T) => {
      setValue(next);
      localStorage.setItem(key, next);
    },
    [key],
  );
  return [value, update] as const;
}

function matches(thread: PluginSidebarThread, groupName: string, query: string): boolean {
  if (query === "") return true;
  const haystack = [
    thread.displayTitle,
    groupName,
    thread.environment?.branchName,
    thread.environment?.name,
    thread.environment?.path,
    thread.providerId,
    thread.id,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .every((word) => haystack.includes(word));
}

/** A host-styled button that keeps the native `title` tooltip. */
function ToolButton({
  variant,
  size,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>) {
  return <button type="button" className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

function Inspector({
  thread,
  focusRequest,
  compact,
  onClose,
  onPin,
  onReleaseFocus,
}: {
  thread: PluginSidebarThread;
  focusRequest: number;
  /** Phone-sized screens: a drawer from the right that swipes closed. */
  compact: boolean;
  onClose(): void;
  onPin(): void;
  /** Hands keyboard focus back to the canvas. */
  onReleaseFocus(): void;
}) {
  const navigate = useBbNavigate();
  const asideRef = useRef<HTMLElement>(null);
  useReleaseChatFocus(asideRef, thread.id, focusRequest, onReleaseFocus);
  // The drawer portals outside the plugin's page; these attributes keep the
  // plugin's styles applying to it.
  const portalScope = usePortalScopeProps();
  const archive = useArchive(thread);
  const buttons: { icon: IconName; label: string; title: string; run(): void }[] = [
    ...(compact
      ? []
      : [
          { icon: "Pin" as const, label: "Pin to the canvas", title: "Pin to the canvas (p)", run: onPin },
          { icon: "Columns2" as const, label: "Open in a split", title: "Open in a split (⇧↵)", run: () => navigate.toThread(thread.id, { split: true }) },
        ]),
    { icon: "ArrowUpRight", label: "Open thread", title: "Open thread (↵)", run: () => navigate.toThread(thread.id) },
    ...(archive === null ? [] : [{ icon: "Archive" as const, label: "Archive thread", title: "Archive thread", run: archive }]),
    { icon: "X", label: "Close", title: "Close (Space or Esc)", run: onClose },
  ];
  const header = (
    <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border px-3">
      <span className="min-w-0 flex-1 truncate text-sm font-medium" title={thread.displayTitle}>
        {thread.displayTitle}
      </span>
      {buttons.map((button) => (
        <ToolButton key={button.label} variant="ghost" size="icon" className="size-7" title={button.title} aria-label={button.label} onClick={button.run}>
          <Icon name={button.icon} className="size-4" />
        </ToolButton>
      ))}
    </div>
  );
  const chat = (
    <div className="min-h-0 flex-1">
      <ThreadChat key={thread.id} threadId={thread.id} variant="compact" focusRequest={focusRequest} />
    </div>
  );
  if (compact) {
    return (
      <Drawer.Root open direction="right" onOpenChange={(open) => (open ? undefined : onClose())}>
        <Drawer.Portal>
          <Drawer.Overlay {...portalScope} className="fixed inset-0 z-40 bg-black/40" />
          <Drawer.Content
            {...portalScope}
            ref={asideRef as React.RefObject<HTMLDivElement>}
            data-bb-canvas-chat=""
            className="fixed bottom-0 right-0 top-0 z-50 flex w-[calc(100%-2.5rem)] max-w-[480px] flex-col border-l border-border bg-background outline-none"
          >
            <Drawer.Title className="sr-only">{thread.displayTitle}</Drawer.Title>
            <Drawer.Description className="sr-only">Chat for this thread. Swipe right to close.</Drawer.Description>
            {header}
            {chat}
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    );
  }
  return (
    <aside ref={asideRef} data-bb-canvas-chat="" className="flex h-full w-[min(480px,45%)] shrink-0 flex-col border-l border-border bg-background">
      {header}
      {chat}
    </aside>
  );
}

const SHORTCUTS: [string, string][] = [
  ["⌘K or g", "Go to a thread"],
  ["h j k l", "Move between threads in a frame"],
  ["⇧ H J K L", "Move between frames"],
  ["Space", "Show or hide the chat panel (or go to the pinned chat)"],
  ["p or ⌥-click", "Pin or unpin a thread's chat to the canvas"],
  ["Tab / ⇧Tab", "Go to the next / previous pinned chat"],
  ["-", "Minimize or restore the pinned chat"],
  ["t", "Triage the threads that need you"],
  ["r", "Reply to the selected thread"],
  ["⇧Esc", "Leave the chat panel for the canvas"],
  ["↵ / ⇧↵", "Open the thread / in a split"],
  ["n / ⇧N", "Next / previous thread that needs you"],
  ["m", "Move the thread to a section"],
  ["a", "Rearrange the selected thread's frame"],
  ["z", "Fold or unfold a card's child threads"],
  ["1 2 3", "Group by project, section, machine"],
  ["c / f", "Center the selection / fit everything"],
  ["/", "Filter"],
  ["⌘Z / ⇧⌘Z", "Undo / redo a layout change"],
  ["Esc", "Close, then clear the selection"],
  ["?", "Show or hide these shortcuts"],
];

function ShortcutHelp({ archiveLabel, onClose }: { archiveLabel: string | null; onClose(): void }) {
  const shortcuts: [string, string][] = archiveLabel === null ? SHORTCUTS : [...SHORTCUTS.slice(0, -1), [archiveLabel, "Archive the selected thread (bb's binding)"], SHORTCUTS.at(-1)!];
  return (
    <div className="absolute inset-0 z-20 flex items-start justify-center bg-black/10 pt-[12vh]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label="Keyboard shortcuts"
        className="w-[min(440px,90%)] rounded-xl border border-border bg-popover p-4 text-sm text-popover-foreground shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mb-3 font-medium">Keyboard shortcuts</div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
          {shortcuts.map(([keys, label]) => (
            <div key={keys} className="contents">
              <dt className="font-mono text-xs leading-5 text-muted-foreground">{keys}</dt>
              <dd>{label}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

interface Group {
  key: string;
  name: string;
  projectId: string | null;
  sectionId: string | null;
  hostId: string | null;
}

type Overlay = null | { kind: "goto" } | { kind: "move"; threadId: string } | { kind: "new-section" } | { kind: "help" };

/**
 * Whether bb is in its dark theme. React Flow puts a `light` or `dark` class on
 * the canvas, and bb's theme tokens are scoped to those same classes, so the
 * canvas must use bb's mode or everything inside it (cards, pinned chats)
 * falls back to the light tokens.
 */
function useHostDark(): boolean {
  const read = () =>
    document.documentElement.classList.contains("dark") || document.body.classList.contains("dark");
  const [dark, setDark] = useState(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setDark(read()));
    for (const element of [document.documentElement, document.body]) {
      observer.observe(element, { attributes: true, attributeFilter: ["class"] });
    }
    return () => observer.disconnect();
  }, []);
  return dark;
}

/** Keeps `runRef` pointing at bb's archive action for the selected thread. */
function ArchiveRunner({ thread, runRef }: { thread: PluginSidebarThread; runRef: { current: (() => void) | null } }) {
  const archive = useArchive(thread);
  useEffect(() => {
    runRef.current = archive;
    return () => {
      runRef.current = null;
    };
  }, [archive, runRef]);
  return null;
}

/** Equal top-level fields, comparing nested objects one level deep. */
function shallowEqual(a: unknown, b: unknown, depth = 1): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a);
  if (keysA.length !== Object.keys(b).length) return false;
  return keysA.every((key) => {
    const valueA = (a as Record<string, unknown>)[key];
    const valueB = (b as Record<string, unknown>)[key];
    return depth > 0 ? shallowEqual(valueA, valueB, depth - 1) : Object.is(valueA, valueB);
  });
}

/** Whether a rebuilt node would draw the same as the one on screen. */
function sameNode(old: CanvasNode, next: CanvasNode): boolean {
  return (
    old.type === next.type &&
    old.position.x === next.position.x &&
    old.position.y === next.position.y &&
    old.width === next.width &&
    old.height === next.height &&
    old.zIndex === next.zIndex &&
    // bb rebuilds thread objects on every list update; compare their fields.
    shallowEqual(old.data, next.data, 2)
  );
}

function CanvasInner() {
  const hostDark = useHostDark();
  // Phone-sized screens: no toolbar or pinned chats; the chat is a drawer.
  const compact = useIsCompactViewport();
  const pluginId = usePluginId();
  const navigate = useBbNavigate();
  const sdk = useSdk();
  const flow = useReactFlow<CanvasNode, Edge>();
  const flowStore = useStoreApi<CanvasNode, Edge>();
  const [showArchived, setShowArchived] = useState(false);
  const sidebar = useSidebarThreads(
    showArchived ? { experimental_lifecycles: ["active", "archived"] } : undefined,
  );
  const { rpc, layout, setLayout } = useStoredLayout();
  const now = useNow(30_000);
  const [grouping, setGrouping] = useStoredPreference<Grouping>(`${pluginId}:grouping`, "project");
  const [query, setQuery] = useState("");
  const [hidden, setHidden] = useState<ReadonlySet<Bucket>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [chatFocus, setChatFocus] = useState(0);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const settings = useSettings();
  // bb's "Archive thread" shortcut does nothing on a plugin page (there's no
  // thread in view), so the canvas handles the user's binding itself.
  const archiveShortcut = useArchiveShortcut();
  const arrangeOptions = useMemo<ArrangeOptions>(
    () => ({
      style: (settings.values?.arrangeStyle as ArrangeStyle | undefined) ?? DEFAULT_ARRANGE.style,
      gridSize: (settings.values?.arrangeGridSize as number | undefined) ?? DEFAULT_ARRANGE.gridSize,
    }),
    [settings.values?.arrangeStyle, settings.values?.arrangeGridSize],
  );
  const archiveSelected = useRef<(() => void) | null>(null);
  // Phones show bb's sidebar as a slide-over, so there is nothing to collapse.
  // Settings load after the first render; use the last value this browser saw
  // so the sidebar collapses before the canvas first paints.
  const collapseKey = `${pluginId}:collapse-sidebar`;
  const loadedCollapse = settings.values === undefined ? undefined : settings.values.collapseSidebar !== false;
  const collapseSidebar = loadedCollapse ?? localStorage.getItem(collapseKey) !== "false";
  useEffect(() => {
    if (loadedCollapse !== undefined) localStorage.setItem(collapseKey, String(loadedCollapse));
  }, [collapseKey, loadedCollapse]);
  useCollapseHostSidebar(!compact && collapseSidebar);
  const maxPinned = (settings.values?.maxPinnedWindows as number | undefined) ?? 4;

  const releaseFocus = useCallback(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    wrapperRef.current?.focus({ preventScroll: true });
  }, []);

  const threads = useMemo(
    () => sidebar.threads.filter((thread) => !thread.isHidden && (showArchived || !thread.isArchived)),
    [sidebar.threads, showArchived],
  );
  const threadsById = useMemo(() => new Map(threads.map((thread) => [thread.id, thread])), [threads]);
  const projectNames = useMemo(
    () => new Map(sidebar.projects.map((project) => [project.id, project.isPersonal ? "Personal" : project.name])),
    [sidebar.projects],
  );
  const sectionNames = useMemo(
    () => new Map(sidebar.sections.map((section) => [section.id, section.name])),
    [sidebar.sections],
  );
  const groupOf = useCallback(
    (thread: PluginSidebarThread): Group => {
      if (grouping === "section") {
        const sectionId = thread.sectionId !== null && sectionNames.has(thread.sectionId) ? thread.sectionId : null;
        return {
          key: sectionId ?? NO_GROUP,
          name: sectionId === null ? "No section" : sectionNames.get(sectionId)!,
          projectId: null,
          sectionId,
          hostId: null,
        };
      }
      if (grouping === "machine") {
        return {
          key: thread.host?.id ?? NO_GROUP,
          name: thread.host?.name ?? "No machine",
          projectId: null,
          sectionId: null,
          hostId: thread.host?.id ?? null,
        };
      }
      return {
        key: thread.projectId,
        name: projectNames.get(thread.projectId) ?? thread.projectId,
        projectId: thread.projectId,
        sectionId: null,
        hostId: null,
      };
    },
    [grouping, projectNames, sectionNames],
  );
  const groups = useMemo(() => new Map(threads.map((thread) => [thread.id, groupOf(thread)])), [threads, groupOf]);
  const buckets = useMemo(() => new Map(threads.map((thread) => [thread.id, bucketOf(thread)])), [threads]);

  // Child threads fold into their top-level ancestor's card instead of
  // getting cards of their own.
  const forest = useMemo(() => childForest(threads), [threads]);
  const topLevel = useMemo(() => threads.filter((thread) => !forest.rootOf.has(thread.id)), [threads, forest]);
  const rootOf = useCallback((id: string) => forest.rootOf.get(id) ?? id, [forest]);
  const foldedKey = `${pluginId}:folded`;
  const [folded, setFolded] = useState<ReadonlySet<string>>(
    () => new Set(JSON.parse(localStorage.getItem(foldedKey) ?? "[]") as string[]),
  );
  const toggleFold = useCallback(
    (id: string) =>
      setFolded((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        localStorage.setItem(foldedKey, JSON.stringify([...next]));
        return next;
      }),
    [foldedKey],
  );
  /** A card's height: taller when it lists its children. */
  const cardHeight = useCallback(
    (id: string) => {
      const rows = forest.rowsOf.get(id);
      return rows !== undefined && !folded.has(id) ? CARD_H + childListHeight(rows.length) : CARD_H;
    },
    [forest, folded],
  );

  const arrangement = layout?.arrangements[grouping] ?? EMPTY_ARRANGEMENT;
  // Live positions: stored ones, plus computed spots for threads never placed.
  const [positions, setPositions] = useState<Record<string, Point>>({});
  const positionsRef = useRef(positions);
  positionsRef.current = positions;
  const notes = arrangement.notes;
  // Pinned chats live on the canvas like notes, per grouping.
  const chats = arrangement.chats;
  const [focusedChat, setFocusedChat] = useState<string | null>(null);
  // Pinned chats lay out at screen size for this zoom (see ChatNode). It
  // follows the live zoom once it has been still briefly, which covers
  // gestures and animated moves alike.
  const liveZoom = useStore((state) => state.transform[2]);
  const [settledZoom, setSettledZoom] = useState(liveZoom);
  useEffect(() => {
    const timer = setTimeout(() => setSettledZoom(liveZoom), 150);
    return () => clearTimeout(timer);
  }, [liveZoom]);
  const [chatFocusRequests, setChatFocusRequests] = useState<Record<string, number>>({});
  const dragging = useRef(false);

  // Undo and redo hold whole-layout snapshots, kept per window in memory.
  // record() runs before each user edit; one event that makes several edits
  // (a drag that moves cards and a note) sees the same snapshot and records once.
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const [history, setHistory] = useState<{ undo: Layout[]; redo: Layout[] }>({ undo: [], redo: [] });
  const record = useCallback(() => {
    const snapshot = layoutRef.current;
    if (snapshot === null) return;
    setHistory((current) =>
      current.undo.at(-1) === snapshot
        ? current
        : { undo: [...current.undo, snapshot].slice(-UNDO_LIMIT), redo: [] },
    );
  }, []);
  const restore = useCallback(
    (direction: "undo" | "redo") => {
      const current = layoutRef.current;
      const stack = history[direction];
      const target = stack.at(-1);
      if (current === null || target === undefined) return;
      const other = direction === "undo" ? "redo" : "undo";
      setHistory({ [direction]: stack.slice(0, -1), [other]: [...history[other], current] } as typeof history);
      layoutRef.current = target;
      setLayout(target);
      rpc.call("layout_set", { origin: CLIENT_ID, layout: target }).catch(failed("save the layout"));
    },
    [history, rpc, setLayout],
  );

  // Local edits go into `layout` first so later re-derivations see them; the
  // server's echo to this window is skipped.
  const updateArrangement = useCallback(
    (change: (arrangement: Arrangement) => Arrangement) =>
      setLayout((current) =>
        current === null
          ? current
          : {
              ...current,
              arrangements: { ...current.arrangements, [grouping]: change(current.arrangements[grouping]) },
            },
      ),
    [setLayout, grouping],
  );
  const setNotes = useCallback(
    (change: (notes: Note[]) => Note[]) =>
      updateArrangement((current) => ({ ...current, notes: change(current.notes) })),
    [updateArrangement],
  );

  const setChats = useCallback(
    (change: (chats: PinnedChat[]) => PinnedChat[]) =>
      updateArrangement((current) => ({ ...current, chats: change(current.chats) })),
    [updateArrangement],
  );

  const save = useCallback(
    (changes: Record<string, Point | null>, replace = false) => {
      updateArrangement((current) => {
        const next = replace ? {} : { ...current.positions };
        for (const [id, point] of Object.entries(changes)) {
          if (point === null) delete next[id];
          else next[id] = point;
        }
        return { ...current, positions: next };
      });
      rpc.call("positions_set", { origin: CLIENT_ID, grouping, positions: changes, replace }).catch(failed("save the layout"));
    },
    [rpc, grouping, updateArrangement],
  );

  const layoutThreads = useMemo(
    () =>
      topLevel.map((thread) => ({ ...thread, group: groups.get(thread.id)?.key ?? NO_GROUP, height: cardHeight(thread.id) })),
    [topLevel, groups, cardHeight],
  );

  useEffect(() => {
    if (layout === null || dragging.current) return;
    const ids = new Set(layoutThreads.map((thread) => thread.id));
    const stored = new Map(Object.entries(arrangement.positions).filter(([id]) => ids.has(id)));
    const noteRects = arrangement.notes.map((note) => ({ x: note.x, y: note.y, width: note.width, height: note.height }));
    const placed =
      stored.size === 0 && arrangement.notes.length === 0
        ? autoLayout(layoutThreads)
        : placeNew(layoutThreads, stored, noteRects);
    setPositions(Object.fromEntries(placed));
    const fresh = [...placed].filter(([id]) => !stored.has(id));
    if (fresh.length > 0 && sidebar.status === "ready") save(Object.fromEntries(fresh));
  }, [layout, arrangement, layoutThreads, sidebar.status, save]);

  // Frames with their members and bounds; also what Shift+HJKL moves between.
  const frames = useMemo(() => {
    const byGroup = new Map<string, { group: Group; members: PluginSidebarThread[] }>();
    for (const thread of topLevel) {
      const group = groups.get(thread.id)!;
      const entry = byGroup.get(group.key) ?? { group, members: [] };
      entry.members.push(thread);
      byGroup.set(group.key, entry);
    }
    return [...byGroup.values()].flatMap(({ group, members }) => {
      const bounds = frameBounds(
        members.flatMap((thread) => {
          const point = positions[thread.id];
          return point === undefined ? [] : [{ ...point, height: cardHeight(thread.id) }];
        }),
      );
      return bounds === null ? [] : [{ group, members, bounds }];
    });
  }, [topLevel, groups, positions, cardHeight]);

  /** Files a thread under a section and lets the canvas re-place it there. */
  const moveToSection = useCallback(
    async (threadId: string, sectionId: string | null, keepPosition: boolean) => {
      try {
        await sdk.threads.update({ threadId, sectionId });
        if (grouping === "section" && !keepPosition) save({ [threadId]: null });
        const name = sectionId === null ? "No section" : (sectionNames.get(sectionId) ?? "the section");
        toast.success(`Moved to ${name}`);
      } catch (error) {
        failed("move the thread")(error);
      }
    },
    [sdk, grouping, save, sectionNames],
  );

  const updateNote = useCallback(
    (note: Note) => {
      record();
      setNotes((current) => current.map((existing) => (existing.id === note.id ? note : existing)));
      rpc.call("note_upsert", { origin: CLIENT_ID, grouping, note }).catch(failed("save the note"));
    },
    [record, setNotes, rpc, grouping],
  );
  const updateChat = useCallback(
    (chat: PinnedChat) => {
      record();
      setChats((current) => current.map((existing) => (existing.threadId === chat.threadId ? chat : existing)));
      rpc.call("chat_upsert", { origin: CLIENT_ID, grouping, chat }).catch(failed("save the pinned chat"));
    },
    [record, setChats, rpc, grouping],
  );
  const unpinChat = useCallback(
    (threadId: string) => {
      record();
      setChats((current) => current.filter((chat) => chat.threadId !== threadId));
      rpc.call("chat_delete", { origin: CLIENT_ID, grouping, threadId }).catch(failed("unpin the chat"));
    },
    [record, setChats, rpc, grouping],
  );

  // Nodes derived from threads, positions, and notes.
  const derived = useMemo<CanvasNode[]>(() => {
    const lowered = query.trim();
    const result: CanvasNode[] = [];
    const rowsOf = (id: string) => forest.rowsOf.get(id) ?? [];
    const pinnedIds = new Set(chats.map((chat) => chat.threadId));
    for (const { group, members, bounds } of frames) {
      const frameKey = `${grouping}:${group.key}`;
      result.push({
        id: `frame:${group.key}`,
        type: "frame",
        position: { x: bounds.x, y: bounds.y },
        width: bounds.width,
        height: bounds.height,
        zIndex: -1,
        data: {
          grouping,
          groupKey: group.key,
          frameKey,
          projectId: group.projectId,
          sectionId: group.sectionId,
          name: group.name,
          count: members.length,
          attention: members
            .flatMap((thread) => [thread.id, ...rowsOf(thread.id).map((row) => row.id)])
            .filter((id) => buckets.get(id) === "needs-you").length,
          color: layout?.frameColors[frameKey] ?? "none",
          width: bounds.width,
          height: bounds.height,
        },
      });
    }
    for (const thread of topLevel) {
      const position = positions[thread.id];
      if (position === undefined) continue;
      const bucket = buckets.get(thread.id) ?? "idle";
      const height = cardHeight(thread.id);
      const children = rowsOf(thread.id).flatMap((row) => {
        const child = threadsById.get(row.id);
        return child === undefined
          ? []
          : [
              {
                id: child.id,
                depth: row.depth,
                title: child.displayTitle,
                bucket: buckets.get(child.id) ?? "idle",
                ageLabel: age(child.updatedAt, now),
                pinned: pinnedIds.has(child.id),
              },
            ];
      });
      const groupName = groups.get(thread.id)?.name ?? "";
      const anyMatch =
        matches(thread, groupName, lowered) ||
        children.some((child) => matches(threadsById.get(child.id)!, groupName, lowered));
      result.push({
        id: thread.id,
        type: "thread",
        position,
        width: CARD_W,
        height,
        data: {
          thread,
          bucket,
          highlighted: selectedId !== null && rootOf(selectedId) === thread.id,
          pinned: pinnedIds.has(thread.id),
          compact,
          ageLabel: age(thread.updatedAt, now),
          children,
          folded: folded.has(thread.id),
          height,
          dimmed: hidden.has(bucket) || !anyMatch,
        },
      });
    }
    for (const note of notes) {
      result.push({
        id: `note:${note.id}`,
        type: "note",
        position: { x: note.x, y: note.y },
        width: note.width,
        height: note.height,
        zIndex: 1,
        data: { note },
      });
    }
    // Pinned chats stay saved but aren't drawn on phone-sized screens.
    for (const chat of compact ? [] : chats) {
      const thread = threadsById.get(chat.threadId);
      if (thread === undefined) continue;
      result.push({
        id: `chat:${chat.threadId}`,
        type: "chat",
        position: { x: chat.x, y: chat.y },
        width: chat.width,
        height: chat.minimized ? CHAT_HEADER_H : chat.height,
        // Above cards and notes; the focused chat on top.
        zIndex: chat.threadId === focusedChat ? 3 : 2,
        dragHandle: ".bb-canvas-chat-handle",
        selectable: false,
        data: {
          chat,
          thread,
          bucket: buckets.get(thread.id) ?? "idle",
          focused: chat.threadId === focusedChat,
          focusRequest: chatFocusRequests[chat.threadId] ?? 0,
          zoom: settledZoom,
          parentTitle:
            thread.parentThreadId === null ? null : (threadsById.get(thread.parentThreadId)?.displayTitle ?? null),
        },
      });
    }
    return result;
  }, [compact, threadsById, topLevel, forest, folded, cardHeight, rootOf, frames, positions, notes, chats, focusedChat, chatFocusRequests, settledZoom, selectedId, groups, buckets, hidden, query, now, grouping, layout?.frameColors]);

  // React Flow owns transient state (measured size, selection, drag); merge
  // it into each rebuild.
  const [nodes, setNodes] = useState<CanvasNode[]>([]);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  useEffect(() => {
    setNodes((previous) => {
      const byId = new Map(previous.map((node) => [node.id, node]));
      let changed = previous.length !== derived.length;
      const next = derived.map((node, index) => {
        const old = byId.get(node.id);
        if (old === undefined) {
          changed = true;
          return node;
        }
        // Keep the previous object when nothing visible changed, so React Flow
        // and the memoized node components skip it.
        if (!old.dragging && sameNode(old, node)) {
          if (previous[index] !== old) changed = true;
          return old;
        }
        changed = true;
        return {
          ...node,
          measured: old.measured,
          selected: old.selected,
          dragging: old.dragging,
          position: old.dragging ? old.position : node.position,
        } as CanvasNode;
      });
      return changed ? next : previous;
    });
  }, [derived]);

  const membersOf = useCallback(
    (groupKey: string) => topLevel.filter((thread) => groups.get(thread.id)?.key === groupKey).map((thread) => thread.id),
    [topLevel, groups],
  );

  const chatsRef = useRef(chats);
  chatsRef.current = chats;
  const linkedChat = useCallback(
    (threadId: string) => chatsRef.current.find((chat) => chat.threadId === threadId && chat.linked),
    [],
  );

  const onNodesChange = useCallback(
    (incoming: NodeChange<CanvasNode>[]) => {
      const current = new Map(nodesRef.current.map((node) => [node.id, node]));
      // The selection box picks cards it touches but only frames it encloses;
      // otherwise boxing a few cards would also grab their frame and all its
      // members. Enclosed frames are selected in onSelectionEnd. React Flow has
      // already marked its internal copy selected, so a refused frame gets a
      // fresh object below to make it rebuild that copy.
      const boxing = flowStore.getState().userSelectionRect !== null;
      const refused = new Set<string>();
      const changes = incoming.filter((change) => {
        if (!boxing || change.type !== "select" || !change.selected || current.get(change.id)?.type !== "frame") return true;
        refused.add(change.id);
        return false;
      });
      const moved: Record<string, Point> = {};
      const extra: NodeChange<CanvasNode>[] = [];
      // A linked chat follows its card by the same amount, and the reverse.
      const followCardOnce = (threadId: string, dx: number, dy: number) => {
        if (linkedChat(threadId) === undefined) return;
        const chatNode = current.get(`chat:${threadId}`);
        if (chatNode === undefined) return;
        extra.push({
          type: "position",
          id: chatNode.id,
          position: { x: chatNode.position.x + dx, y: chatNode.position.y + dy },
        });
      };
      // A Shift+drag selection can move a frame with its own cards, or a card
      // with its linked chat; each must move once.
      const changing = new Set(changes.flatMap((change) => (change.type === "position" ? [change.id] : [])));
      const movingFrames = new Set(
        [...changing].flatMap((id) => {
          const node = current.get(id);
          return node?.type === "frame" ? [node.data.groupKey] : [];
        }),
      );
      const followCard = (threadId: string, dx: number, dy: number) => {
        if (changing.has(`chat:${threadId}`)) return;
        followCardOnce(threadId, dx, dy);
      };
      for (const change of changes) {
        if (change.type !== "position" || change.position === undefined) continue;
        const node = current.get(change.id);
        if (node === undefined) continue;
        const dx = change.position.x - node.position.x;
        const dy = change.position.y - node.position.y;
        if (node.type === "thread" && movingFrames.has(groups.get(node.id)?.key ?? "")) continue;
        if (node.type === "thread") {
          moved[change.id] = change.position;
          followCard(change.id, dx, dy);
        }
        if (node.type === "frame") {
          for (const id of membersOf(node.data.groupKey)) {
            const point = moved[id] ?? positionsRef.current[id];
            if (point !== undefined) moved[id] = { x: point.x + dx, y: point.y + dy };
            followCard(id, dx, dy);
          }
        }
        if (node.type === "chat" && node.data.chat.linked) {
          const threadId = node.data.chat.threadId;
          if (changing.has(threadId) || movingFrames.has(groups.get(threadId)?.key ?? "")) continue;
          const point = positionsRef.current[threadId];
          if (point !== undefined) moved[threadId] = { x: point.x + dx, y: point.y + dy };
        }
      }
      if (Object.keys(moved).length > 0) setPositions((previous) => ({ ...previous, ...moved }));
      setNodes((previous) => {
        const next = applyNodeChanges([...changes, ...extra], previous);
        return refused.size === 0 ? next : next.map((node) => (refused.has(node.id) ? ({ ...node, selected: false } as CanvasNode) : node));
      });
    },
    [membersOf, linkedChat, groups, flowStore],
  );

  // The last selection box in flow coordinates; React Flow clears its own
  // before onSelectionEnd runs.
  const lastBox = useRef<Rect | null>(null);
  useEffect(
    () =>
      flowStore.subscribe(({ userSelectionRect: rect, transform: [tx, ty, scale] }) => {
        if (rect === null) return;
        lastBox.current = { x: (rect.x - tx) / scale, y: (rect.y - ty) / scale, width: rect.width / scale, height: rect.height / scale };
      }),
    [flowStore],
  );
  // A box that starts on a card or frame ends with a click on it. React Flow
  // swallows that click only while Shift is still held; otherwise it would
  // select the frame (dropping the box's picks) or open the card.
  const boxJustEnded = useRef(false);
  const onSelectionEnd = useCallback(() => {
    boxJustEnded.current = true;
    setTimeout(() => {
      boxJustEnded.current = false;
    });
    const box = lastBox.current;
    lastBox.current = null;
    if (box === null) return;
    const inside = (node: CanvasNode) =>
      node.position.x >= box.x &&
      node.position.y >= box.y &&
      node.position.x + (node.width ?? 0) <= box.x + box.width &&
      node.position.y + (node.height ?? 0) <= box.y + box.height;
    setNodes((previous) =>
      previous.some((node) => node.type === "frame" && !node.selected && inside(node))
        ? previous.map((node) => (node.type === "frame" && !node.selected && inside(node) ? { ...node, selected: true } : node))
        : previous,
    );
  }, []);

  // Frame bounds as they were when a drag began, for drop-to-file.
  const framesAtDragStart = useRef(frames);
  const onNodeDragStart = useCallback(() => {
    dragging.current = true;
    framesAtDragStart.current = frames;
  }, [frames]);
  const onNodeDragStop = useCallback(
    (_event: unknown, _node: CanvasNode, dragged: CanvasNode[]) => {
      dragging.current = false;
      record();
      const changes: Record<string, Point> = {};
      // Save where linked chats ended up after their cards moved.
      const saveLinkedChat = (threadId: string) => {
        const chat = linkedChat(threadId);
        const chatNode = nodesRef.current.find((candidate) => candidate.id === `chat:${threadId}`);
        if (chat !== undefined && chatNode !== undefined) {
          updateChat({ ...chat, x: chatNode.position.x, y: chatNode.position.y });
        }
      };
      for (const node of dragged) {
        if (node.type === "thread") {
          const point = positionsRef.current[node.id] ?? node.position;
          changes[node.id] = point;
          saveLinkedChat(node.id);
          // In the section grouping, dropping a card on another section files it
          // there, unless its own frame moved with it.
          const frameDragged = dragged.some((other) => other.type === "frame" && other.data.groupKey === groups.get(node.id)?.key);
          if (grouping === "section" && !frameDragged) {
            const center = { x: point.x + CARD_W / 2, y: point.y + CARD_H / 2 };
            const own = groups.get(node.id)?.key;
            const target = framesAtDragStart.current.find(
              ({ group, bounds }) =>
                group.key !== own &&
                center.x >= bounds.x &&
                center.x <= bounds.x + bounds.width &&
                center.y >= bounds.y &&
                center.y <= bounds.y + bounds.height,
            );
            if (target !== undefined) void moveToSection(node.id, target.group.sectionId, true);
          }
        }
        if (node.type === "frame") {
          for (const id of membersOf(node.data.groupKey)) {
            const point = positionsRef.current[id];
            if (point !== undefined) changes[id] = point;
            saveLinkedChat(id);
          }
        }
        if (node.type === "chat" && node.data.chat.linked) {
          const point = positionsRef.current[node.data.chat.threadId];
          if (point !== undefined) changes[node.data.chat.threadId] = point;
        }
        if (node.type === "note") updateNote({ ...node.data.note, x: node.position.x, y: node.position.y });
        if (node.type === "chat") updateChat({ ...node.data.chat, x: node.position.x, y: node.position.y });
      }
      if (Object.keys(changes).length > 0) save(changes);
    },
    [membersOf, save, updateNote, updateChat, record, grouping, groups, moveToSection, linkedChat],
  );

  const edges = useMemo<Edge[]>(() => {
    const visible = new Set(threads.map((thread) => thread.id));
    const result: Edge[] = [];
    // A child with its parent on the canvas is a row in the parent's card, so
    // there's no parent edge to draw. Forks join the cards that hold them.
    for (const thread of threads) {
      if (thread.sourceThreadId !== null && visible.has(thread.sourceThreadId) && thread.sourceThreadId !== thread.parentThreadId) {
        const source = rootOf(thread.sourceThreadId);
        const target = rootOf(thread.id);
        if (source === target) continue;
        result.push({
          id: `fork:${thread.id}`,
          source,
          target,
          type: "smoothstep",
          label: thread.originKind === "fork" ? "fork" : "handoff",
          labelStyle: { fontSize: 11 },
          style: { strokeDasharray: "6 4", strokeWidth: 1.5 },
        });
      }
    }
    for (const chat of compact ? [] : chats) {
      if (!visible.has(chat.threadId)) continue;
      result.push({
        id: `pin:${chat.threadId}`,
        type: "tether",
        source: rootOf(chat.threadId),
        target: `chat:${chat.threadId}`,
        style: {
          stroke: `var(--status-${buckets.get(chat.threadId) ?? "idle"})`,
          strokeDasharray: "5 4",
          strokeWidth: 1.5,
          opacity: chat.threadId === focusedChat ? 1 : 0.6,
        },
      });
    }
    return result;
  }, [threads, buckets, chats, focusedChat, compact, rootOf]);

  const counts = useMemo(() => {
    const result = new Map<Bucket, number>(BUCKETS.map((bucket) => [bucket, 0]));
    for (const bucket of buckets.values()) result.set(bucket, (result.get(bucket) ?? 0) + 1);
    return result;
  }, [buckets]);

  const selected = threads.find((thread) => thread.id === selectedId) ?? null;

  // Pins of archived or deleted threads stay saved but aren't drawn, so they
  // don't count toward the limit.
  const shownPinCount = useMemo(() => chats.filter((chat) => threadsById.has(chat.threadId)).length, [chats, threadsById]);

  useEffect(() => {
    if (selectedId !== null && chats.some((chat) => chat.threadId === selectedId)) setFocusedChat(selectedId);
  }, [selectedId, chats]);

  // Triage: the threads that need you, one at a time.
  const [triage, setTriage] = useState<{ queue: string[]; index: number } | null>(null);
  const [triageFocus, setTriageFocus] = useState(0);

  // Viewport is per browser: restore it, or fit everything on first visit.
  const viewportKey = `${pluginId}:viewport`;
  const initialViewport = useMemo<Viewport | undefined>(() => {
    const raw = localStorage.getItem(viewportKey);
    return raw === null ? undefined : (JSON.parse(raw) as Viewport);
  }, [viewportKey]);
  const fitted = useRef(initialViewport !== undefined);
  useEffect(() => {
    if (fitted.current || nodes.length === 0) return;
    fitted.current = true;
    requestAnimationFrame(() => flow.fitView({ padding: 0.15, maxZoom: 1 }));
  }, [nodes, flow]);

  const fitAll = useCallback(() => flow.fitView({ padding: 0.15, maxZoom: 1, duration: 300 }), [flow]);

  /** The card a thread is drawn in: its own, or its top-level ancestor's for a child. */
  const cardRect = useCallback(
    (id: string): Rect | null => {
      const root = rootOf(id);
      const point = positionsRef.current[root];
      return point === undefined ? null : { ...point, width: CARD_W, height: cardHeight(root) };
    },
    [rootOf, cardHeight],
  );

  /** Pans just enough to show the card, keeping the zoom unless it's too far out to read. */
  const reveal = useCallback(
    (id: string, always = false) => {
      const rect = cardRect(id);
      const wrapper = wrapperRef.current?.getBoundingClientRect();
      if (rect === null || wrapper === undefined) return;
      const zoom = flow.getZoom();
      const topLeft = flow.flowToScreenPosition({ x: rect.x, y: rect.y });
      const bottomRight = flow.flowToScreenPosition({ x: rect.x + rect.width, y: rect.y + rect.height });
      const margin = 48;
      const inView =
        topLeft.x >= wrapper.left + margin &&
        topLeft.y >= wrapper.top + margin &&
        bottomRight.x <= wrapper.right - margin &&
        bottomRight.y <= wrapper.bottom - margin;
      if (inView && !always && zoom >= 0.5) return;
      flow.setCenter(rect.x + rect.width / 2, rect.y + rect.height / 2, {
        zoom: Math.max(zoom, always ? 0.8 : 0.5),
        duration: 250,
      });
    },
    [flow, cardRect],
  );

  const focusThread = useCallback(
    (id: string) => {
      setSelectedId(id);
      reveal(id, true);
    },
    [reveal],
  );

  /** Pans to a pinned chat, keeping the zoom when it's readable. */
  const revealChat = useCallback(
    (chat: PinnedChat) => {
      const height = chat.minimized ? CHAT_HEADER_H : chat.height;
      flow.setCenter(chat.x + chat.width / 2, chat.y + height / 2, {
        zoom: Math.max(flow.getZoom(), 0.6),
        duration: 250,
      });
    },
    [flow],
  );

  /** Restores a pinned chat if minimized, focuses it, and pans to it. */
  const showChat = useCallback(
    (chat: PinnedChat) => {
      const shown = chat.minimized ? { ...chat, minimized: false } : chat;
      if (chat.minimized) updateChat(shown);
      setFocusedChat(chat.threadId);
      revealChat(shown);
    },
    [updateChat, revealChat],
  );

  /** Pins a thread's chat beside its card, or unpins it. */
  const togglePin = useCallback(
    (id: string) => {
      if (chats.some((chat) => chat.threadId === id)) {
        unpinChat(id);
        return;
      }
      if (shownPinCount >= maxPinned) {
        toast.error(`${maxPinned} chats are pinned in this grouping, the most allowed. Unpin one, or raise the limit in the Canvas plugin settings.`);
        return;
      }
      const card = cardRect(id);
      const chat: PinnedChat = {
        threadId: id,
        x: (card?.x ?? 0) + CARD_W + 56,
        y: card?.y ?? 0,
        width: CHAT_W,
        height: CHAT_H,
        minimized: false,
        linked: false,
      };
      record();
      setChats((current) => [...current, chat]);
      setFocusedChat(id);
      rpc.call("chat_upsert", { origin: CLIENT_ID, grouping, chat }).catch(failed("pin the chat"));
      revealChat(chat);
    },
    [chats, shownPinCount, maxPinned, cardRect, record, setChats, rpc, grouping, unpinChat, revealChat],
  );

  /**
   * A child row in a parent's card opens the child's chat: as a floating
   * window beside the parent (a pinned chat), or the drawer on a phone.
   */
  const openChild = useCallback(
    (id: string) => {
      setSelectedId(id);
      if (compact) {
        setInspectorOpen(true);
        return;
      }
      const chat = chats.find((candidate) => candidate.threadId === id);
      if (chat === undefined) togglePin(id);
      else showChat(chat);
    },
    [compact, chats, togglePin, showChat],
  );

  /** Card rects for navigation; dimmed (filtered-out) cards are skipped unless asked for. */
  const navItems = useCallback(
    (ids: readonly string[], includeDimmed = false): NavItem[] => {
      const byId = new Map(nodesRef.current.map((node) => [node.id, node]));
      return ids.flatMap((id) => {
        const rect = cardRect(id);
        const node = byId.get(id);
        const dimmed = node?.type === "thread" && node.data.dimmed;
        return rect === null || (dimmed && !includeDimmed) ? [] : [{ id, rect }];
      });
    },
    [cardRect],
  );

  /** hjkl within the selected card's frame; Shift moves between frames. */
  const navigate2d = useCallback(
    (direction: Direction, acrossFrames: boolean) => {
      const wrapper = wrapperRef.current?.getBoundingClientRect();
      const viewCenter =
        wrapper === undefined
          ? { x: 0, y: 0 }
          : flow.screenToFlowPosition({ x: wrapper.left + wrapper.width / 2, y: wrapper.top + wrapper.height / 2 });
      const current = selectedId === null ? null : cardRect(selectedId);
      if (current === null || selectedId === null) {
        const first = nearestTo(viewCenter, navItems(topLevel.map((thread) => thread.id)));
        if (first !== null) focusThread(first);
        return;
      }
      const ownKey = groups.get(rootOf(selectedId))?.key;
      if (!acrossFrames) {
        const next = nearestInDirection(current, navItems(membersOf(ownKey ?? NO_GROUP)), direction);
        if (next !== null) {
          setSelectedId(next);
          reveal(next);
        }
        return;
      }
      const own = frames.find((frame) => frame.group.key === ownKey);
      const targetKey = nearestInDirection(
        own?.bounds ?? current,
        frames.filter((frame) => frame.group.key !== ownKey).map((frame) => ({ id: frame.group.key, rect: frame.bounds })),
        direction,
      );
      if (targetKey === null) return;
      const centerPoint = { x: current.x + CARD_W / 2, y: current.y + CARD_H / 2 };
      const candidates = navItems(membersOf(targetKey));
      const next = nearestTo(centerPoint, candidates.length > 0 ? candidates : navItems(membersOf(targetKey), true));
      if (next !== null) {
        setSelectedId(next);
        reveal(next);
      }
    },
    [flow, selectedId, cardRect, navItems, topLevel, rootOf, focusThread, groups, membersOf, frames, reveal],
  );

  const addNote = useCallback(
    (at?: Point) => {
      const center = at ?? flow.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
      const note: Note = {
        id: Math.random().toString(36).slice(2, 12),
        x: center.x - 110,
        y: center.y - 70,
        width: 220,
        height: 140,
        text: "",
        color: "yellow",
      };
      record();
      setNotes((current) => [...current, note]);
      rpc.call("note_upsert", { origin: CLIENT_ID, grouping, note }).catch(failed("save the note"));
    },
    [flow, rpc, setNotes, record, grouping],
  );

  const autoArrange = useCallback(() => {
    record();
    const next = Object.fromEntries(autoLayout(layoutThreads, arrangeOptions));
    setPositions(next);
    save(next, true);
    requestAnimationFrame(fitAll);
  }, [layoutThreads, save, fitAll, record, arrangeOptions]);

  /** Rearranges one frame's cards in place with the configured layout. */
  const arrangeFrame = useCallback(
    (groupKey: string) => {
      const members = layoutThreads.filter((thread) => thread.group === groupKey);
      if (members.length === 0) return;
      record();
      const next = Object.fromEntries(
        arrangeGroup(members, new Map(Object.entries(positionsRef.current)), arrangeOptions),
      );
      setPositions((previous) => ({ ...previous, ...next }));
      save(next);
    },
    [layoutThreads, arrangeOptions, record, save],
  );

  // These three change with most thread updates; reading them through a ref
  // keeps `actions` stable so the memoized nodes don't all re-render.
  const latest = useRef({ togglePin, openChild, arrangeFrame });
  latest.current = { togglePin, openChild, arrangeFrame };
  const actions = useMemo<CanvasActions>(
    () => ({
      select: setSelectedId,
      open: (id, split) => navigate.toThread(id, { split }),
      newThreadIn: (frame) => {
        if (frame.grouping === "project" && frame.projectId !== null) {
          navigate.toCompose({ projectId: frame.projectId, focusPrompt: true });
        } else if (frame.grouping === "section") {
          navigate.toCompose({ placement: { sectionId: frame.sectionId, pinned: false }, focusPrompt: true });
        } else if (frame.grouping === "machine" && frame.groupKey !== NO_GROUP) {
          navigate.toCompose({ hostId: frame.groupKey, focusPrompt: true });
        } else navigate.toCompose({ focusPrompt: true });
      },
      setFrameColor: (frameKey, color) => {
        record();
        setLayout((current) =>
          current === null ? current : { ...current, frameColors: { ...current.frameColors, [frameKey]: color } },
        );
        rpc.call("frame_color_set", { origin: CLIENT_ID, frameKey, color }).catch(failed("save the frame color"));
      },
      renameSection: (id, name) => {
        sdk.threadSections.update({ id, name }).catch(failed("rename the section"));
      },
      deleteSection: (id) => {
        sdk.threadSections.delete({ id }).catch(failed("delete the section"));
      },
      updateNote,
      updateChat,
      unpinChat,
      focusChat: (threadId) => {
        setFocusedChat(threadId);
        setSelectedId(threadId);
      },
      releaseFocus,
      togglePin: (id) => latest.current.togglePin(id),
      toggleFold,
      openChild: (id) => latest.current.openChild(id),
      arrangeFrame: (groupKey) => latest.current.arrangeFrame(groupKey),
      deleteNote: (id) => {
        record();
        setNotes((current) => current.filter((note) => note.id !== id));
        rpc.call("note_delete", { origin: CLIENT_ID, grouping, id }).catch(failed("delete the note"));
      },
    }),
    [navigate, rpc, sdk, setLayout, setNotes, record, grouping, releaseFocus, toggleFold, updateNote, updateChat, unpinChat],
  );

  const changeGrouping = useCallback(
    (next: Grouping) => {
      if (next === grouping) return;
      setGrouping(next);
      // Positions differ per grouping; refit once the new arrangement renders.
      setTimeout(() => {
        if (selectedId !== null) reveal(selectedId, true);
        else fitAll();
      }, 50);
    },
    [grouping, setGrouping, selectedId, reveal, fitAll],
  );

  // Needs-you queue for the `n` key: oldest attention first.
  const attentionQueue = useMemo(
    () =>
      threads
        .filter((thread) => buckets.get(thread.id) === "needs-you" || buckets.get(thread.id) === "error")
        .sort((a, b) => a.latestAttentionAt - b.latestAttentionAt),
    [threads, buckets],
  );

  const startTriage = useCallback(() => {
    const queue = attentionQueue.map((thread) => thread.id);
    if (queue.length === 0) {
      toast("Nothing needs you right now");
      return;
    }
    setOverlay(null);
    setInspectorOpen(false);
    setTriage({ queue, index: 0 });
  }, [attentionQueue]);

  /** Steps through the queue, preferring threads that still need you. */
  const stepTriage = useCallback(
    (delta: number) => {
      setTriage((current) => {
        if (current === null) return current;
        const { queue, index } = current;
        for (let step = 1; step <= queue.length; step += 1) {
          const next = (index + delta * step + queue.length * step) % queue.length;
          if (needsAttention(buckets.get(queue[next]!))) return { queue, index: next };
        }
        return { queue, index: (index + delta + queue.length) % queue.length };
      });
    },
    [buckets],
  );

  // Pan the canvas behind triage to the current thread.
  const triageThread = triage?.queue[triage.index] ?? null;
  useEffect(() => {
    if (triageThread !== null) focusThread(triageThread);
  }, [triageThread, focusThread]);

  // Once the current thread is answered, move on, or finish when none are left.
  const triageCurrentDone = triageThread !== null && !needsAttention(buckets.get(triageThread));
  useEffect(() => {
    if (!triageCurrentDone || triage === null) return;
    const timer = setTimeout(() => {
      if (triage.queue.some((id) => needsAttention(buckets.get(id)))) stepTriage(1);
      else {
        setTriage(null);
        toast.success("All caught up");
      }
    }, 900);
    return () => clearTimeout(timer);
  }, [triageCurrentDone, triage, buckets, stepTriage]);

  const threadItems = useMemo<PickerItem[]>(
    () =>
      threads.map((thread) => {
        const bucket = buckets.get(thread.id) ?? "idle";
        const group = groups.get(thread.id);
        return {
          id: thread.id,
          title: thread.displayTitle,
          detail: [group?.name, thread.environment?.branchName].filter(Boolean).join(" · "),
          keywords: [projectNames.get(thread.projectId), thread.providerId, BUCKET_LABEL[bucket], thread.id].join(" "),
          dot: `var(--status-${bucket})`,
          // Threads that need you float up when the query is empty.
          recency: thread.latestAttentionAt + (bucket === "needs-you" ? 1e13 : 0),
        };
      }),
    [threads, buckets, groups, projectNames],
  );
  const sectionItems = useMemo<PickerItem[]>(
    () => [
      { id: NO_GROUP, title: "No section", icon: "Rows3", recency: -1 },
      ...sidebar.sections.map((section) => ({ id: section.id, title: section.name, icon: "Rows3" as const, recency: section.updatedAt })),
    ],
    [sidebar.sections],
  );

  const createSection = useCallback(
    async (name: string, threadId?: string) => {
      setOverlay(null);
      try {
        const section = await sdk.threadSections.create({ name });
        if (threadId !== undefined) await moveToSection(threadId, section.id, false);
        else toast.success(`Created section ${section.name}`);
      } catch (error) {
        failed("create the section")(error);
      }
    },
    [sdk, moveToSection],
  );

  // Keyboard. The window listener runs in the capture phase so ⌘K reaches the
  // canvas before bb's own thread picker; the chat panel keeps bb's keys.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const inInspector = target?.closest("[data-bb-canvas-chat]") != null;
      const typing = target !== null && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();

      // Shift+Esc leaves the chat panel for the canvas.
      if (inInspector && event.key === "Escape" && event.shiftKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        releaseFocus();
        return;
      }
      if (triage !== null) {
        if (typing || inInspector || mod || event.altKey) return;
        if (event.key === "Escape") setTriage(null);
        else if (key === "n") stepTriage(event.shiftKey ? -1 : 1);
        else if (key === "o") navigate.toThread(triage.queue[triage.index]!);
        else if (key === "r") setTriageFocus((value) => value + 1);
        else if (key === "t") setTriage(null);
        else return;
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (mod && !event.shiftKey && !event.altKey && key === "k" && !inInspector) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setOverlay((current) => (current?.kind === "goto" ? null : { kind: "goto" }));
        return;
      }
      // The user's archive binding archives the selected thread, which is also
      // the one whose chat has focus, from anywhere on the canvas.
      if (archiveShortcut !== null && matchesShortcut(event, archiveShortcut) && overlay === null) {
        event.preventDefault();
        event.stopImmediatePropagation();
        archiveSelected.current?.();
        return;
      }
      // The shortcut list has no input of its own to catch keys; Esc or ? closes it.
      if (overlay?.kind === "help" && (event.key === "Escape" || event.key === "?")) {
        event.preventDefault();
        setOverlay(null);
        return;
      }
      if (overlay !== null || typing || inInspector) {
        if (event.key === "Escape" && target === searchRef.current) {
          setQuery("");
          target?.blur();
        }
        return;
      }
      if (mod && !event.altKey && (key === "z" || (key === "y" && !event.metaKey))) {
        event.preventDefault();
        restore(key === "y" || event.shiftKey ? "redo" : "undo");
        return;
      }
      if (mod || event.altKey) return;

      const direction = DIRECTION_KEYS[key];
      if (direction !== undefined) navigate2d(direction, event.shiftKey || /^[HJKL]$/.test(event.key));
      else if (event.key === "Escape") {
        if (inspectorOpen) setInspectorOpen(false);
        else {
          setSelectedId(null);
          setNodes((previous) => (previous.some((node) => node.selected) ? previous.map((node) => (node.selected ? { ...node, selected: false } : node)) : previous));
        }
      } else if (event.key === "/") searchRef.current?.focus();
      else if (event.key === "?") setOverlay({ kind: "help" });
      else if (key === "g") setOverlay({ kind: "goto" });
      else if (event.key === " " && selectedId !== null) {
        const chat = chats.find((candidate) => candidate.threadId === selectedId);
        if (chat === undefined) setInspectorOpen((open) => !open);
        else showChat(chat);
      } else if (key === "r" && selectedId !== null) {
        const chat = chats.find((candidate) => candidate.threadId === selectedId);
        if (chat !== undefined) {
          showChat(chat);
          setChatFocusRequests((current) => ({ ...current, [selectedId]: (current[selectedId] ?? 0) + 1 }));
        } else {
          setInspectorOpen(true);
          setChatFocus((value) => value + 1);
        }
      } else if (key === "p" && selectedId !== null) togglePin(selectedId);
      else if (event.key === "-" && selectedId !== null) {
        const chat = chats.find((candidate) => candidate.threadId === selectedId);
        if (chat !== undefined) updateChat({ ...chat, minimized: !chat.minimized });
      } else if (event.key === "Tab") {
        const pinned = chats.filter((chat) => threadsById.has(chat.threadId));
        if (pinned.length === 0) return;
        const index = pinned.findIndex((chat) => chat.threadId === focusedChat);
        const next = pinned[(index + (event.shiftKey ? -1 : 1) + pinned.length) % pinned.length]!;
        setFocusedChat(next.threadId);
        setSelectedId(next.threadId);
        revealChat(next);
      } else if (key === "t") startTriage(); else if (event.key === "Enter" && selectedId !== null) navigate.toThread(selectedId, { split: event.shiftKey });
      else if (key === "m" && selectedId !== null) setOverlay({ kind: "move", threadId: selectedId });
      else if (key === "z" && selectedId !== null) {
        if (forest.rowsOf.has(rootOf(selectedId))) toggleFold(rootOf(selectedId));
      } else if (key === "a" && selectedId !== null) {
        const groupKey = groups.get(selectedId)?.key;
        if (groupKey !== undefined) arrangeFrame(groupKey);
      }
      else if (key === "n" && attentionQueue.length > 0) {
        const index = attentionQueue.findIndex((thread) => thread.id === selectedId);
        const step = event.shiftKey ? -1 : 1;
        const next = index === -1 ? (step === 1 ? 0 : attentionQueue.length - 1) : index + step;
        focusThread(attentionQueue[(next + attentionQueue.length) % attentionQueue.length]!.id);
      } else if (key === "c" && selectedId !== null) reveal(selectedId, true);
      else if (key === "f") fitAll();
      else if (event.key === "1" || event.key === "2" || event.key === "3") changeGrouping(GROUPINGS[Number(event.key) - 1]!);
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [
    overlay,
    selectedId,
    inspectorOpen,
    attentionQueue,
    focusThread,
    navigate,
    navigate2d,
    restore,
    reveal,
    fitAll,
    changeGrouping,
    releaseFocus,
    archiveShortcut,
    groups,
    arrangeFrame,
    forest,
    rootOf,
    toggleFold,
    triage,
    stepTriage,
    startTriage,
    chats,
    focusedChat,
    threadsById,
    togglePin,
    updateChat,
    showChat,
    revealChat,
  ]);

  // Only when there is nothing to draw yet; a refresh with cached data stays quiet.
  const loading = layout === null || (sidebar.status === "loading" && threads.length === 0);
  const moving = overlay?.kind === "move" ? threads.find((thread) => thread.id === overlay.threadId) : undefined;

  return (
    <CanvasActionsContext.Provider value={actions}>
      <div className="flex h-full min-h-0 w-full flex-1">
        <div
          ref={wrapperRef}
          tabIndex={-1}
          className="relative min-w-0 flex-1 outline-none"
          onClickCapture={(event) => {
            if (!boxJustEnded.current) return;
            boxJustEnded.current = false;
            event.stopPropagation();
          }}
          onDoubleClick={(event) => {
            // React Flow has no pane double-click callback.
            if (!(event.target as HTMLElement).classList.contains("react-flow__pane")) return;
            addNote(flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
          }}
        >
          <ReactFlow<CanvasNode, Edge>
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onNodeDragStart={onNodeDragStart}
            onNodeDragStop={onNodeDragStop}
            onSelectionEnd={onSelectionEnd}
            onNodeClick={(event, node) => {
              if (node.type !== "thread") return;
              setSelectedId(node.id);
              // Option-click pins or unpins without opening the chat panel.
              if (event.altKey) togglePin(node.id);
              else setInspectorOpen(true);
            }}
            onPaneClick={() => setSelectedId(null)}
            onMoveEnd={(_event, viewport) => localStorage.setItem(viewportKey, JSON.stringify(viewport))}
            defaultViewport={initialViewport}
            zoomOnDoubleClick={false}
            nodesConnectable={false}
            // Shift+drag on the pane draws a selection box; a plain drag pans.
            selectionOnDrag={false}
            selectionKeyCode="Shift"
            selectionMode={SelectionMode.Partial}
            // Elevating would lift a selected frame above its cards.
            elevateNodesOnSelect={false}
            disableKeyboardA11y
            // Not onlyRenderVisibleElements: it unmounts pinned chats that leave
            // the screen, and bb's chat reloads and re-lays out when it comes
            // back. Panning only moves the viewport transform, so keeping every
            // node mounted costs little per frame.
            panOnScroll
            minZoom={0.08}
            maxZoom={2}
            proOptions={{ hideAttribution: true }}
            deleteKeyCode={null}
            className="bb-canvas"
            colorMode={hostDark ? "dark" : "light"}
          >
            <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
            <Controls showInteractive={false} position="bottom-left" />
{compact ? null : (
            <MiniMap
              pannable
              zoomable
              position="bottom-right"
              nodeStrokeWidth={2}
              nodeClassName={(node) => {
                const canvasNode = node as CanvasNode;
                if (canvasNode.type === "frame") return "bb-canvas-mini-frame";
                if (canvasNode.type === "note") return "bb-canvas-mini-note";
                if (canvasNode.type === "chat") return "bb-canvas-mini-chat";
                return `bb-canvas-mini-${canvasNode.data.bucket}`;
              }}
            />
            )}
            {compact ? (
              // Phone-sized screens: just the picker and triage; the full toolbar doesn't fit.
              <Panel position="top-left" className="!m-2 flex gap-1.5">
                <ToolButton
                  variant="outline"
                  size="sm"
                  className="h-9 gap-1.5 bg-background/95 px-3 shadow-sm"
                  onClick={() => setOverlay({ kind: "goto" })}
                  aria-label="Go to a thread"
                >
                  <Icon name="Search" className="size-4" />
                  Go to
                </ToolButton>
                {attentionQueue.length > 0 ? (
                  <ToolButton
                    variant="outline"
                    size="sm"
                    className="h-9 gap-1.5 bg-background/95 px-3 shadow-sm"
                    onClick={startTriage}
                    aria-label="Triage the threads that need you"
                  >
                    <span className="size-2 rounded-full" style={{ background: "var(--status-needs-you)" }} />
                    {attentionQueue.length}
                  </ToolButton>
                ) : null}
              </Panel>
            ) : (
            <Panel position="top-left" className="!m-3">
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background/95 p-1.5 shadow-sm backdrop-blur">
                <ToolButton
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 px-2.5 text-muted-foreground"
                  onClick={() => setOverlay({ kind: "goto" })}
                  title="Go to a thread on the canvas (⌘K or g)"
                >
                  <Icon name="Search" className="size-3.5" />
                  Go to
                  <kbd className="ml-1 rounded border border-border px-1 font-mono text-[10px]">⌘K</kbd>
                </ToolButton>
                <div className="relative">
                  <Input
                    ref={searchRef}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") return;
                      const first = threads.find((thread) =>
                        matches(thread, groups.get(thread.id)?.name ?? "", query.trim()),
                      );
                      if (first !== undefined) {
                        focusThread(first.id);
                        event.currentTarget.blur();
                      }
                    }}
                    placeholder="Filter  /"
                    aria-label="Filter threads"
                    className="h-8 w-36 text-sm"
                  />
                </div>
                <div className="flex items-center rounded-md border border-border p-0.5" role="radiogroup" aria-label="Group by">
                  {GROUPINGS.map((option, index) => (
                    <button
                      key={option}
                      type="button"
                      role="radio"
                      aria-checked={grouping === option}
                      title={`Group by ${GROUPING_LABEL[option].toLowerCase()} (${index + 1})`}
                      onClick={() => changeGrouping(option)}
                      className={cn(
                        "h-6 rounded px-2 text-xs text-muted-foreground hover:text-foreground",
                        grouping === option && "bg-state-active text-foreground",
                      )}
                    >
                      {GROUPING_LABEL[option]}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1">
                  {BUCKETS.map((bucket) => {
                    const count = counts.get(bucket) ?? 0;
                    if (count === 0 && bucket !== "needs-you" && bucket !== "working") return null;
                    const off = hidden.has(bucket);
                    return (
                      <button
                        key={bucket}
                        type="button"
                        aria-pressed={!off}
                        title={`Click to ${off ? "show" : "dim"} ${BUCKET_LABEL[bucket].toLowerCase()} threads; Option-click to show only these`}
                        onClick={(event) => {
                          setHidden((current) => {
                            if (event.altKey) {
                              const only = new Set(BUCKETS.filter((other) => other !== bucket));
                              const already = [...only].every((other) => current.has(other)) && !current.has(bucket);
                              return already ? new Set() : only;
                            }
                            const next = new Set(current);
                            if (next.has(bucket)) next.delete(bucket);
                            else next.add(bucket);
                            return next;
                          });
                        }}
                        className={cn(
                          "flex h-7 items-center gap-1.5 rounded-md px-2 text-xs hover:bg-state-hover",
                          off && "opacity-40",
                        )}
                      >
                        <span className="size-2 rounded-full" style={{ background: `var(--status-${bucket})` }} />
                        <span className="tabular-nums">{count}</span>
                        <span className="text-muted-foreground">{BUCKET_LABEL[bucket].toLowerCase()}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center gap-0.5 border-l border-border pl-1.5">
                  {grouping === "section" ? (
                    <ToolButton variant="ghost" size="sm" className="h-7 px-2" onClick={() => setOverlay({ kind: "new-section" })} title="New section">
                      <Icon name="FolderInput" className="size-3.5" />
                    </ToolButton>
                  ) : null}
                  <ToolButton
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2"
                    aria-pressed={showArchived}
                    onClick={() => setShowArchived((value) => !value)}
                    title="Show archived threads"
                  >
                    <Icon name="Archive" className="size-3.5" />
                  </ToolButton>
                  <ToolButton variant="ghost" size="sm" className="h-7 px-2" onClick={() => addNote()} title="New sticky note (or double-click the canvas)">
                    <Icon name="StickyNote" className="size-3.5" />
                  </ToolButton>
                  <ToolButton
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2"
                    disabled={history.undo.length === 0}
                    onClick={() => restore("undo")}
                    title="Undo layout change (⌘Z)"
                    aria-label="Undo"
                  >
                    <Icon name="Undo2" className="size-3.5" />
                  </ToolButton>
                  <ToolButton
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2"
                    disabled={history.redo.length === 0}
                    onClick={() => restore("redo")}
                    title="Redo layout change (⇧⌘Z)"
                    aria-label="Redo"
                  >
                    <Icon name="Redo2" className="size-3.5" />
                  </ToolButton>
                  <ToolButton variant="ghost" size="sm" className="h-7 px-2" onClick={autoArrange} title="Rearrange everything (layout set in the plugin's settings)">
                    <Icon name="LayoutGrid" className="size-3.5" />
                  </ToolButton>
                  <ToolButton variant="ghost" size="sm" className="h-7 px-2" onClick={fitAll} title="Fit everything (f)">
                    <Icon name="Maximize" className="size-3.5" />
                  </ToolButton>
                  <ToolButton variant="ghost" size="sm" className="h-7 px-2" onClick={() => setOverlay({ kind: "help" })} title="Keyboard shortcuts (?)">
                    <Icon name="Keyboard" className="size-3.5" />
                  </ToolButton>
                  <ToolButton
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 px-2"
                    disabled={attentionQueue.length === 0}
                    onClick={startTriage}
                    title="Triage the threads that need you (t)"
                  >
                    <Icon name="ListChecks" className="size-3.5" />
                    {attentionQueue.length > 0 ? <span className="tabular-nums">{attentionQueue.length}</span> : null}
                  </ToolButton>
                  <ToolButton size="sm" className="ml-1 h-7 gap-1 px-2.5" onClick={() => navigate.toCompose({ focusPrompt: true })}>
                    <Icon name="Plus" className="size-3.5" />
                    New thread
                  </ToolButton>
                </div>
              </div>
            </Panel>
            )}
            {attentionQueue.length > 0 && !compact ? (
              <Panel position="top-right" className="!m-3">
                <div className="w-64 rounded-lg border border-border bg-background/95 shadow-sm backdrop-blur">
                  <div className="flex items-center justify-between px-3 pb-1 pt-2 text-xs font-medium text-muted-foreground">
                    <span>Needs you</span>
                    <button type="button" onClick={startTriage} className="rounded px-1.5 py-0.5 hover:bg-state-hover hover:text-foreground" title="Triage them one at a time (t)">
                      Triage <kbd className="ml-0.5 rounded border border-border px-1 font-mono text-[10px]">t</kbd>
                    </button>
                  </div>
                  <ul className="max-h-64 overflow-y-auto pb-1">
                    {attentionQueue.map((thread) => (
                      <li key={thread.id}>
                        <button
                          type="button"
                          onClick={() => focusThread(thread.id)}
                          className={cn(
                            "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-state-hover",
                            thread.id === selectedId && "bg-state-active",
                          )}
                        >
                          <span className="size-2 shrink-0 rounded-full" style={{ background: `var(--status-${buckets.get(thread.id) ?? "idle"})` }} />
                          <span className="min-w-0 flex-1 truncate">{thread.displayTitle}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </Panel>
            ) : null}
            {loading ? (
              <Panel position="top-center" className="!mt-16 text-sm text-muted-foreground">
                Loading threads…
              </Panel>
            ) : threads.length === 0 ? (
              <Panel position="top-center" className="!mt-16 text-sm text-muted-foreground">
                No threads yet. Start one with New thread.
              </Panel>
            ) : null}
          </ReactFlow>
          {overlay?.kind === "goto" ? (
            <Picker
              title="Go to thread"
              placeholder="Jump to a thread on the canvas…"
              items={threadItems}
              onClose={() => setOverlay(null)}
              onPick={(item) => {
                setOverlay(null);
                focusThread(item.id);
              }}
            />
          ) : null}
          {overlay?.kind === "move" && moving !== undefined ? (
            <Picker
              title="Move to section"
              placeholder={`Move "${moving.displayTitle}" to…`}
              items={sectionItems}
              onClose={() => setOverlay(null)}
              onPick={(item) => {
                setOverlay(null);
                void moveToSection(moving.id, item.id === NO_GROUP ? null : item.id, false);
              }}
              create={{ label: (name) => `New section "${name}"`, run: (name) => void createSection(name, moving.id) }}
            />
          ) : null}
          {overlay?.kind === "new-section" ? (
            <Picker
              title="New section"
              placeholder="Section name…"
              items={[]}
              onClose={() => setOverlay(null)}
              onPick={() => setOverlay(null)}
              create={{ label: (name) => `Create section "${name}"`, run: (name) => void createSection(name) }}
            />
          ) : null}
          {triage !== null ? (
            <Triage
              queue={triage.queue}
              index={triage.index}
              threads={threadsById}
              buckets={buckets}
              groupName={(id) => groups.get(id)?.name ?? ""}
              focusRequest={triageFocus}
              onStep={stepTriage}
              onLeave={() => setTriage(null)}
              onOpen={(id) => navigate.toThread(id)}
              onReleaseFocus={releaseFocus}
            />
          ) : null}
          {overlay?.kind === "help" ? (
            <ShortcutHelp
              archiveLabel={archiveShortcut === null ? null : shortcutLabel(archiveShortcut)}
              onClose={() => setOverlay(null)}
            />
          ) : null}
          {selected === null ? null : <ArchiveRunner thread={selected} runRef={archiveSelected} />}
        </div>
        {selected === null || !inspectorOpen || (!compact && chats.some((chat) => chat.threadId === selected.id && !chat.minimized)) ? null : (
          <Inspector
            thread={selected}
            compact={compact}
            focusRequest={chatFocus}
            onClose={() => setInspectorOpen(false)}
            onPin={() => togglePin(selected.id)}
            onReleaseFocus={releaseFocus}
          />
        )}
      </div>
    </CanvasActionsContext.Provider>
  );
}

export function CanvasPage() {
  useOpenUrlRequests();
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}
