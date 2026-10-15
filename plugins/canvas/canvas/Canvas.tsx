import type * as React from "react";
import type { VariantProps } from "class-variance-authority";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
  type Edge,
  type NodeChange,
  type Viewport,
} from "@xyflow/react";
import { toast } from "sonner";
import {
  ThreadChat,
  experimental_usePluginId as usePluginId,
  experimental_useSidebarThreads as useSidebarThreads,
  useBbNavigate,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Icon } from "./icons.tsx";
import type { FrameColor, Layout, Note, rpcContract } from "../server";
import { CanvasActionsContext, type CanvasActions } from "./context";
import { CARD_H, CARD_W, autoLayout, frameBounds, placeNew, type Point } from "./layout.ts";
import { nodeTypes, type CanvasNode } from "./nodes";
import { BUCKETS, BUCKET_LABEL, bucketOf, type Bucket } from "./status.ts";

const CLIENT_ID = Math.random().toString(36).slice(2, 10);
const UNDO_LIMIT = 50;
const EMPTY_LAYOUT: Layout = { positions: {}, notes: [], frameColors: {} };

/** The stored arrangement, refetched when another window changes it. */
function useStoredLayout() {
  const rpc = useRpc<typeof rpcContract>();
  const [layout, setLayout] = useState<Layout | null>(null);
  const refetch = useCallback(() => {
    rpc.call("layout_get").then(setLayout, (error: unknown) => {
      toast.error(`Canvas layout failed to load: ${error instanceof Error ? error.message : String(error)}`);
      setLayout((current) => current ?? EMPTY_LAYOUT);
    });
  }, [rpc]);
  useEffect(refetch, [refetch]);
  useRealtime("layout-changed", (payload) => {
    const origin = (payload as { origin?: string } | null)?.origin;
    if (origin !== CLIENT_ID) refetch();
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

function matches(thread: PluginSidebarThread, projectName: string, query: string): boolean {
  if (query === "") return true;
  const haystack = [
    thread.displayTitle,
    projectName,
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

function Inspector({ thread, onClose }: { thread: PluginSidebarThread; onClose(): void }) {
  const navigate = useBbNavigate();
  return (
    <aside className="flex h-full w-[min(480px,45%)] shrink-0 flex-col border-l border-border bg-background">
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border px-3">
        <span className="min-w-0 flex-1 truncate text-sm font-medium" title={thread.displayTitle}>
          {thread.displayTitle}
        </span>
        <ToolButton variant="ghost" size="icon" className="size-7" title="Open in a split" aria-label="Open in a split" onClick={() => navigate.toThread(thread.id, { split: true })}>
          <Icon name="Columns2" className="size-4" />
        </ToolButton>
        <ToolButton variant="ghost" size="icon" className="size-7" title="Open thread" aria-label="Open thread" onClick={() => navigate.toThread(thread.id)}>
          <Icon name="ArrowUpRight" className="size-4" />
        </ToolButton>
        <ToolButton variant="ghost" size="icon" className="size-7" title="Close (Esc)" aria-label="Close" onClick={onClose}>
          <Icon name="X" className="size-4" />
        </ToolButton>
      </div>
      <div className="min-h-0 flex-1">
        <ThreadChat key={thread.id} threadId={thread.id} variant="compact" />
      </div>
    </aside>
  );
}

function CanvasInner() {
  const pluginId = usePluginId();
  const navigate = useBbNavigate();
  const flow = useReactFlow<CanvasNode, Edge>();
  const [showArchived, setShowArchived] = useState(false);
  const sidebar = useSidebarThreads(
    showArchived ? { experimental_lifecycles: ["active", "archived"] } : undefined,
  );
  const { rpc, layout, setLayout } = useStoredLayout();
  const now = useNow(30_000);
  const [query, setQuery] = useState("");
  const [hidden, setHidden] = useState<ReadonlySet<Bucket>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const threads = useMemo(
    () => sidebar.threads.filter((thread) => !thread.isHidden && (showArchived || !thread.isArchived)),
    [sidebar.threads, showArchived],
  );
  const projectNames = useMemo(
    () => new Map(sidebar.projects.map((project) => [project.id, project.isPersonal ? "Personal" : project.name])),
    [sidebar.projects],
  );
  const buckets = useMemo(() => new Map(threads.map((thread) => [thread.id, bucketOf(thread)])), [threads]);

  // Live positions: stored ones, plus computed spots for threads never placed.
  const [positions, setPositions] = useState<Record<string, Point>>({});
  const positionsRef = useRef(positions);
  positionsRef.current = positions;
  const notes = layout?.notes ?? EMPTY_LAYOUT.notes;
  const notesRef = useRef(notes);
  notesRef.current = notes;
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
      rpc.call("layout_set", { origin: CLIENT_ID, layout: target }).catch((error: unknown) => {
        toast.error(`Could not save the layout: ${error instanceof Error ? error.message : String(error)}`);
      });
    },
    [history, rpc, setLayout],
  );

  // Local edits go into `layout` first so later re-derivations see them; the
  // server's echo to this window is skipped.
  const setNotes = useCallback(
    (change: (notes: Note[]) => Note[]) =>
      setLayout((current) => (current === null ? current : { ...current, notes: change(current.notes) })),
    [setLayout],
  );


  const save = useCallback(
    (changes: Record<string, Point>, replace = false) => {
      setLayout((current) =>
        current === null
          ? current
          : { ...current, positions: replace ? changes : { ...current.positions, ...changes } },
      );
      rpc.call("positions_set", { origin: CLIENT_ID, positions: changes, replace }).catch((error: unknown) => {
        toast.error(`Could not save the layout: ${error instanceof Error ? error.message : String(error)}`);
      });
    },
    [rpc],
  );

  useEffect(() => {
    if (layout === null || dragging.current) return;
    const stored = new Map(
      Object.entries(layout.positions).filter(([id]) => threads.some((thread) => thread.id === id)),
    );
    const noteRects = layout.notes.map((note) => ({ x: note.x, y: note.y, width: note.width, height: note.height }));
    const placed =
      stored.size === 0 && layout.notes.length === 0 ? autoLayout(threads) : placeNew(threads, stored, noteRects);
    setPositions(Object.fromEntries(placed));
    const fresh = [...placed].filter(([id]) => !stored.has(id));
    if (fresh.length > 0 && sidebar.status === "ready") save(Object.fromEntries(fresh));
  }, [layout, threads, sidebar.status, save]);

  const actions = useMemo<CanvasActions>(
    () => ({
      select: (id) => setSelectedId(id),
      open: (id, split) => navigate.toThread(id, { split }),
      newThread: (projectId) => navigate.toCompose({ projectId, focusPrompt: true }),
      setFrameColor: (projectId: string, color: FrameColor) => {
        record();
        setLayout((current) =>
          current === null ? current : { ...current, frameColors: { ...current.frameColors, [projectId]: color } },
        );
        rpc.call("frame_color_set", { origin: CLIENT_ID, projectId, color }).catch(() => undefined);
      },
      updateNote: (note) => {
        record();
        setNotes((current) => current.map((existing) => (existing.id === note.id ? note : existing)));
        rpc.call("note_upsert", { origin: CLIENT_ID, note }).catch((error: unknown) => {
          toast.error(`Could not save the note: ${error instanceof Error ? error.message : String(error)}`);
        });
      },
      deleteNote: (id) => {
        record();
        setNotes((current) => current.filter((note) => note.id !== id));
        rpc.call("note_delete", { origin: CLIENT_ID, id }).catch(() => undefined);
      },
    }),
    [navigate, rpc, setLayout, setNotes, record],
  );

  // Nodes derived from threads, positions, and notes.
  const derived = useMemo<CanvasNode[]>(() => {
    const lowered = query.trim();
    const childCounts = new Map<string, number>();
    for (const thread of threads) {
      if (thread.parentThreadId !== null) {
        childCounts.set(thread.parentThreadId, (childCounts.get(thread.parentThreadId) ?? 0) + 1);
      }
    }
    const result: CanvasNode[] = [];
    const byProject = new Map<string, PluginSidebarThread[]>();
    for (const thread of threads) {
      byProject.set(thread.projectId, [...(byProject.get(thread.projectId) ?? []), thread]);
    }
    for (const [projectId, list] of byProject) {
      const bounds = frameBounds(list.flatMap((thread) => positions[thread.id] ?? []));
      if (bounds === null) continue;
      result.push({
        id: `frame:${projectId}`,
        type: "frame",
        position: { x: bounds.x, y: bounds.y },
        zIndex: -1,
        selectable: false,
        data: {
          projectId,
          name: projectNames.get(projectId) ?? projectId,
          count: list.length,
          attention: list.filter((thread) => buckets.get(thread.id) === "needs-you").length,
          color: layout?.frameColors[projectId] ?? "none",
          width: bounds.width,
          height: bounds.height,
        },
      });
    }
    for (const thread of threads) {
      const position = positions[thread.id];
      if (position === undefined) continue;
      const bucket = buckets.get(thread.id) ?? "idle";
      result.push({
        id: thread.id,
        type: "thread",
        position,
        width: CARD_W,
        height: CARD_H,
        data: {
          thread,
          bucket,
          now,
          childCount: childCounts.get(thread.id) ?? 0,
          dimmed: hidden.has(bucket) || !matches(thread, projectNames.get(thread.projectId) ?? "", lowered),
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
    return result;
  }, [threads, positions, notes, projectNames, buckets, hidden, query, now, layout?.frameColors]);

  // React Flow owns transient state (measured size, selection, drag); merge
  // it into each rebuild.
  const [nodes, setNodes] = useState<CanvasNode[]>([]);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  useEffect(() => {
    setNodes((previous) => {
      const byId = new Map(previous.map((node) => [node.id, node]));
      return derived.map((node) => {
        const old = byId.get(node.id);
        if (old === undefined) return { ...node, selected: node.id === selectedId };
        return {
          ...node,
          measured: old.measured,
          selected: node.type === "thread" ? node.id === selectedId : old.selected,
          dragging: old.dragging,
          position: old.dragging ? old.position : node.position,
        } as CanvasNode;
      });
    });
  }, [derived, selectedId]);

  const membersOf = useCallback(
    (projectId: string) => threads.filter((thread) => thread.projectId === projectId).map((thread) => thread.id),
    [threads],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<CanvasNode>[]) => {
      const current = new Map(nodesRef.current.map((node) => [node.id, node]));
      const moved: Record<string, Point> = {};
      for (const change of changes) {
        if (change.type !== "position" || change.position === undefined) continue;
        const node = current.get(change.id);
        if (node?.type === "thread") moved[change.id] = change.position;
        if (node?.type === "frame") {
          const dx = change.position.x - node.position.x;
          const dy = change.position.y - node.position.y;
          for (const id of membersOf(node.data.projectId)) {
            const point = moved[id] ?? positionsRef.current[id];
            if (point !== undefined) moved[id] = { x: point.x + dx, y: point.y + dy };
          }
        }
      }
      if (Object.keys(moved).length > 0) setPositions((previous) => ({ ...previous, ...moved }));
      setNodes((previous) => applyNodeChanges(changes, previous));
    },
    [membersOf],
  );

  const onNodeDragStart = useCallback(() => {
    dragging.current = true;
  }, []);
  const onNodeDragStop = useCallback(
    (_event: unknown, _node: CanvasNode, dragged: CanvasNode[]) => {
      dragging.current = false;
      record();
      const changes: Record<string, Point> = {};
      for (const node of dragged) {
        if (node.type === "thread") changes[node.id] = positionsRef.current[node.id] ?? node.position;
        if (node.type === "frame") {
          for (const id of membersOf(node.data.projectId)) {
            const point = positionsRef.current[id];
            if (point !== undefined) changes[id] = point;
          }
        }
        if (node.type === "note") actions.updateNote({ ...node.data.note, x: node.position.x, y: node.position.y });
      }
      if (Object.keys(changes).length > 0) save(changes);
    },
    [membersOf, save, actions, record],
  );

  const edges = useMemo<Edge[]>(() => {
    const visible = new Set(threads.map((thread) => thread.id));
    const result: Edge[] = [];
    for (const thread of threads) {
      const working = buckets.get(thread.id) === "working";
      if (thread.parentThreadId !== null && visible.has(thread.parentThreadId)) {
        result.push({
          id: `parent:${thread.id}`,
          source: thread.parentThreadId,
          target: thread.id,
          type: "smoothstep",
          animated: working,
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
          style: { strokeWidth: 1.5 },
        });
      }
      if (thread.sourceThreadId !== null && visible.has(thread.sourceThreadId) && thread.sourceThreadId !== thread.parentThreadId) {
        result.push({
          id: `fork:${thread.id}`,
          source: thread.sourceThreadId,
          target: thread.id,
          type: "smoothstep",
          label: thread.originKind === "fork" ? "fork" : "handoff",
          labelStyle: { fontSize: 11 },
          style: { strokeDasharray: "6 4", strokeWidth: 1.5 },
        });
      }
    }
    return result;
  }, [threads, buckets]);

  const counts = useMemo(() => {
    const result = new Map<Bucket, number>(BUCKETS.map((bucket) => [bucket, 0]));
    for (const bucket of buckets.values()) result.set(bucket, (result.get(bucket) ?? 0) + 1);
    return result;
  }, [buckets]);

  const selected = threads.find((thread) => thread.id === selectedId) ?? null;

  // Viewport is per browser: restore it, or fit everything on first visit.
  const viewportKey = `${pluginId}:viewport`;
  const initialViewport = useMemo<Viewport | undefined>(() => {
    try {
      const raw = localStorage.getItem(viewportKey);
      return raw === null ? undefined : (JSON.parse(raw) as Viewport);
    } catch {
      return undefined;
    }
  }, [viewportKey]);
  const fitted = useRef(initialViewport !== undefined);
  useEffect(() => {
    if (fitted.current || nodes.length === 0 || nodes.some((node) => node.measured === undefined)) return;
    fitted.current = true;
    requestAnimationFrame(() => flow.fitView({ padding: 0.15, maxZoom: 1 }));
  }, [nodes, flow]);

  const focusThread = useCallback(
    (id: string) => {
      const point = positionsRef.current[id];
      setSelectedId(id);
      if (point !== undefined) {
        flow.setCenter(point.x + CARD_W / 2, point.y + CARD_H / 2, { zoom: Math.max(flow.getZoom(), 0.8), duration: 300 });
      }
    },
    [flow],
  );

  const addNote = useCallback(
    (at?: Point) => {
      const center =
        at ??
        flow.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
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
      rpc.call("note_upsert", { origin: CLIENT_ID, note }).catch((error: unknown) => {
        toast.error(`Could not save the note: ${error instanceof Error ? error.message : String(error)}`);
      });
    },
    [flow, rpc, setNotes, record],
  );

  const autoArrange = useCallback(() => {
    record();
    const next = Object.fromEntries(autoLayout(threads));
    setPositions(next);
    save(next, true);
    requestAnimationFrame(() => flow.fitView({ padding: 0.15, maxZoom: 1, duration: 300 }));
  }, [threads, save, flow, record]);

  // Needs-you queue for the `n` key: oldest attention first.
  const attentionQueue = useMemo(
    () =>
      threads
        .filter((thread) => buckets.get(thread.id) === "needs-you" || buckets.get(thread.id) === "error")
        .sort((a, b) => a.latestAttentionAt - b.latestAttentionAt),
    [threads, buckets],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target !== null && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) {
        if (event.key === "Escape" && target === searchRef.current) {
          setQuery("");
          target.blur();
        }
        return;
      }
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (mod && !event.altKey && (key === "z" || (key === "y" && !event.metaKey))) {
        event.preventDefault();
        restore(key === "y" || event.shiftKey ? "redo" : "undo");
        return;
      }
      if (mod || event.altKey) return;
      if (event.key === "Escape") setSelectedId(null);
      else if (event.key === "/") {
        event.preventDefault();
        searchRef.current?.focus();
      } else if (event.key === "Enter" && selectedId !== null) navigate.toThread(selectedId);
      else if (event.key === "n" && attentionQueue.length > 0) {
        const index = attentionQueue.findIndex((thread) => thread.id === selectedId);
        focusThread(attentionQueue[(index + 1) % attentionQueue.length]!.id);
      } else if (event.key === "f") flow.fitView({ padding: 0.15, maxZoom: 1, duration: 300 });
      else return;
      event.preventDefault();
    };
    // Scoped to the canvas page; React Flow's own keys stay on its pane.
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, attentionQueue, focusThread, navigate, flow, restore]);

  const loading = sidebar.status === "loading" || layout === null;

  return (
    <CanvasActionsContext.Provider value={actions}>
      <div className="flex h-full min-h-0 w-full flex-1">
        <div
          className="relative min-w-0 flex-1"
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
            onNodesChange={onNodesChange}
            onNodeDragStart={onNodeDragStart}
            onNodeDragStop={onNodeDragStop}
            onNodeClick={(_event, node) => {
              if (node.type === "thread") setSelectedId(node.id);
            }}
            onPaneClick={() => setSelectedId(null)}
            onMoveEnd={(_event, viewport) => {
              try {
                localStorage.setItem(viewportKey, JSON.stringify(viewport));
              } catch {
                // Storage full or blocked; the viewport just won't persist.
              }
            }}
            defaultViewport={initialViewport}
            zoomOnDoubleClick={false}
            nodesConnectable={false}
            selectionOnDrag={false}
            panOnScroll
            minZoom={0.08}
            maxZoom={2}
            proOptions={{ hideAttribution: true }}
            deleteKeyCode={null}
            className="bb-canvas"
          >
            <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
            <Controls showInteractive={false} position="bottom-left" />
            <MiniMap
              pannable
              zoomable
              position="bottom-right"
              nodeStrokeWidth={2}
              nodeClassName={(node) => {
                const canvasNode = node as CanvasNode;
                if (canvasNode.type === "frame") return "bb-canvas-mini-frame";
                if (canvasNode.type === "note") return "bb-canvas-mini-note";
                return `bb-canvas-mini-${canvasNode.data.bucket}`;
              }}
            />
            <Panel position="top-left" className="!m-3">
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background/95 p-1.5 shadow-sm backdrop-blur">
                <div className="relative">
                  <Icon name="Search" className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    ref={searchRef}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") return;
                      const first = threads.find((thread) =>
                        matches(thread, projectNames.get(thread.projectId) ?? "", query.trim()),
                      );
                      if (first !== undefined) focusThread(first.id);
                    }}
                    placeholder="Filter threads  /"
                    aria-label="Filter threads"
                    className="h-8 w-52 pl-7 text-sm"
                  />
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
                  <ToolButton variant="ghost" size="sm" className="h-7 px-2" onClick={autoArrange} title="Rearrange automatically">
                    <Icon name="LayoutGrid" className="size-3.5" />
                  </ToolButton>
                  <ToolButton
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2"
                    onClick={() => flow.fitView({ padding: 0.15, maxZoom: 1, duration: 300 })}
                    title="Fit everything (f)"
                  >
                    <Icon name="Maximize" className="size-3.5" />
                  </ToolButton>
                  <ToolButton size="sm" className="ml-1 h-7 gap-1 px-2.5" onClick={() => navigate.toCompose({ focusPrompt: true })}>
                    <Icon name="Plus" className="size-3.5" />
                    New thread
                  </ToolButton>
                </div>
              </div>
            </Panel>
            {attentionQueue.length > 0 ? (
              <Panel position="top-right" className="!m-3">
                <div className="w-64 rounded-lg border border-border bg-background/95 shadow-sm backdrop-blur">
                  <div className="flex items-center justify-between px-3 pb-1 pt-2 text-xs font-medium text-muted-foreground">
                    <span>Needs you</span>
                    <kbd className="rounded border border-border px-1 font-mono text-[10px]">n</kbd>
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
        </div>
        {selected === null ? null : <Inspector thread={selected} onClose={() => setSelectedId(null)} />}
      </div>
    </CanvasActionsContext.Provider>
  );
}

export function CanvasPage() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}
