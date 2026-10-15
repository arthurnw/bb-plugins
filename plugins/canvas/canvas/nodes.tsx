import { memo, useEffect, useRef, useState } from "react";
import { Handle, NodeResizer, Position, useStore, type Node, type NodeProps } from "@xyflow/react";
import {
  experimental_ProviderIcon as ProviderIcon,
  experimental_ThreadActionsContextMenu as ThreadActionsContextMenu,
  experimental_ThreadStatusGlyph as ThreadStatusGlyph,
  experimental_useProviders as useProviders,
  experimental_useSidebarThreadPullRequest as useSidebarThreadPullRequest,
  type PluginSidebarPullRequest,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { cn } from "@/lib/utils";
import { Icon, type IconName } from "./icons.tsx";
import type { Note } from "../server";
import { FRAME_COLORS, NOTE_COLORS, type FrameColor, type Grouping } from "./shared.ts";
import { ChatNode, type ChatFlowNode } from "./ChatNode.tsx";
import { useCanvasActions } from "./context";
import { CARD_H, CARD_W, FRAME_HEADER } from "./layout.ts";
import { BUCKET_LABEL, age, type Bucket } from "./status.ts";

/** Below this zoom cards switch to a large-title summary. */
const FAR_ZOOM = 0.5;
const useIsFar = () => useStore((state) => state.transform[2] < FAR_ZOOM);

export type ThreadNodeData = {
  thread: PluginSidebarThread;
  bucket: Bucket;
  dimmed: boolean;
  now: number;
  childCount: number;
};
export type FrameNodeData = {
  grouping: Grouping;
  groupKey: string;
  /** Key for the frame's color: `<grouping>:<group key>`. */
  frameKey: string;
  /** The project, in the project grouping. */
  projectId: string | null;
  /** The bb section, in the section grouping; null for threads outside every section. */
  sectionId: string | null;
  name: string;
  count: number;
  attention: number;
  color: FrameColor;
  width: number;
  height: number;
};
export type NoteNodeData = { note: Note };

export type ThreadFlowNode = Node<ThreadNodeData, "thread">;
export type FrameFlowNode = Node<FrameNodeData, "frame">;
export type NoteFlowNode = Node<NoteNodeData, "note">;
export type CanvasNode = ThreadFlowNode | FrameFlowNode | NoteFlowNode | ChatFlowNode;


function PullRequestBadge({ pullRequest }: { pullRequest: PluginSidebarPullRequest }) {
  const checks = pullRequest.experimental_checks.state;
  const tone =
    pullRequest.state === "merged"
      ? "text-violet-600 dark:text-violet-400"
      : pullRequest.state === "closed"
        ? "text-muted-foreground line-through"
        : checks === "failing"
          ? "text-red-600 dark:text-red-400"
          : checks === "pending"
            ? "text-amber-600 dark:text-amber-400"
            : checks === "passing"
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-muted-foreground";
  return (
    <a
      href={pullRequest.url}
      target="_blank"
      rel="noreferrer"
      title={`#${pullRequest.number} ${pullRequest.title} (${pullRequest.state}, checks ${checks})`}
      className={cn("nodrag inline-flex items-center gap-0.5 hover:underline", tone)}
      onClick={(event) => event.stopPropagation()}
    >
      <Icon name="GitPullRequest" className="size-3" />#{pullRequest.number}
      {pullRequest.state === "draft" ? <span className="text-muted-foreground"> draft</span> : null}
    </a>
  );
}

function PullRequest({ threadId }: { threadId: string }) {
  const { pullRequest } = useSidebarThreadPullRequest(threadId);
  return pullRequest === null ? null : <PullRequestBadge pullRequest={pullRequest} />;
}

function activityParts(thread: PluginSidebarThread): string[] {
  const { activity } = thread;
  const parts: string[] = [];
  if (activity.backgroundAgents > 0) parts.push(`${activity.backgroundAgents} subagent${activity.backgroundAgents > 1 ? "s" : ""}`);
  if (activity.backgroundCommands > 0) parts.push(`${activity.backgroundCommands} cmd`);
  if (activity.workflows > 0) parts.push("workflow");
  if (activity.goals > 0) parts.push("goal");
  if (activity.planMode > 0) parts.push("plan");
  if (thread.queuedWork === "waiting") parts.push("queued");
  return parts;
}

export const ThreadNode = memo(function ThreadNode({ data, selected }: NodeProps<ThreadFlowNode>) {
  const { thread, bucket, dimmed, now, childCount } = data;
  const actions = useCanvasActions();
  const far = useIsFar();
  const environment = thread.environment;
  const target = {
    id: thread.id,
    projectId: thread.projectId,
    parentThreadId: thread.parentThreadId,
    archivedAt: thread.archivedAt,
    pinnedAt: thread.pinnedAt,
    sectionId: thread.sectionId,
    isUnread: thread.isUnread,
    status: thread.status,
    environment:
      environment?.id != null ? { id: environment.id, path: environment.path } : null,
  };
  // Personal threads run in a folder named after the thread id; skip it.
  const folder = environment?.path?.split("/").filter(Boolean).at(-1);
  const location =
    environment?.branchName ?? environment?.name ?? (folder?.startsWith("thr_") ? null : folder) ?? null;
  const activity = activityParts(thread);
  const { providers } = useProviders();
  const provider = providers.find((entry) => entry.id === thread.providerId) ?? { id: thread.providerId };

  return (
    <ThreadActionsContextMenu thread={target}>
      <div
        style={{ width: CARD_W, height: CARD_H }}
        onDoubleClick={(event) => {
          event.stopPropagation();
          actions.open(thread.id, event.metaKey || event.ctrlKey);
        }}
        className={cn(
          "bb-canvas-card group relative flex flex-col overflow-hidden rounded-lg text-card-foreground shadow-sm transition-[opacity,box-shadow]",
          `status-${bucket}`,
          selected ? "ring-2 ring-ring" : "hover:shadow-md",
          dimmed && "opacity-30",
          thread.isArchived && "border-dashed opacity-60",
          far && "far",
        )}
      >
        <Handle type="target" position={Position.Left} isConnectable={false} className="!opacity-0" />
        <Handle type="source" position={Position.Right} isConnectable={false} className="!opacity-0" />
        {far ? (
          <div className="flex h-full items-center gap-3 px-4">
            <div className="line-clamp-3 min-w-0 flex-1 text-2xl font-semibold leading-tight">
              {thread.displayTitle}
            </div>
          </div>
        ) : (
          <div className="flex h-full flex-col gap-1.5 px-3 py-2.5">
            <div className="flex min-w-0 items-start gap-2">
              <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
                <ThreadStatusGlyph indicator={thread.indicator} archived={thread.isArchived} size="compact" />
              </span>
              <div
                className={cn(
                  "line-clamp-2 min-w-0 flex-1 text-sm leading-snug",
                  thread.isUnread ? "font-semibold" : "font-medium",
                )}
                title={thread.displayTitle}
              >
                {thread.displayTitle}
              </div>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground" title={new Date(thread.updatedAt).toLocaleString()}>
                {age(thread.updatedAt, now)}
              </span>
            </div>
            <div className="mt-auto flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
              <span className="flex size-3.5 shrink-0 items-center justify-center" title={thread.providerId}>
                <ProviderIcon providerKind="agent" provider={provider} className="size-3.5" />
              </span>
              {location === null ? null : (
                <span className="flex min-w-0 items-center gap-1" title={environment?.path ?? undefined}>
                  <Icon name={environment?.branchName ? "GitBranch" : "Folder"} className="size-3 shrink-0" />
                  <span className="truncate">{location}</span>
                </span>
              )}
              {environment?.isWorktree ? (
                <span className="shrink-0 rounded border border-border px-1 text-[10px] leading-4">worktree</span>
              ) : null}
              <span className="ml-auto flex shrink-0 items-center gap-2">
                <PullRequest threadId={thread.id} />
              </span>
            </div>
            <div className="flex min-w-0 items-center gap-2 text-xs">
              <span className="bb-canvas-status shrink-0 font-medium">
                {thread.indicatorLabel ?? BUCKET_LABEL[bucket]}
              </span>
              {activity.length > 0 ? (
                <span className="truncate text-muted-foreground">· {activity.join(" · ")}</span>
              ) : null}
              {childCount > 0 ? (
                <span className="ml-auto flex shrink-0 items-center gap-0.5 text-muted-foreground" title={`${childCount} child threads`}>
                  <Icon name="GitFork" className="size-3" />
                  {childCount}
                </span>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </ThreadActionsContextMenu>
  );
});

const FRAME_TINT: Record<FrameColor, string> = {
  none: "border-border bg-muted/30",
  blue: "border-sky-500/50 bg-sky-500/5",
  green: "border-emerald-500/50 bg-emerald-500/5",
  amber: "border-amber-500/50 bg-amber-500/5",
  rose: "border-rose-500/50 bg-rose-500/5",
  violet: "border-violet-500/50 bg-violet-500/5",
  cyan: "border-cyan-500/50 bg-cyan-500/5",
  slate: "border-slate-500/50 bg-slate-500/10",
};
const SWATCH: Record<FrameColor, string> = {
  none: "bg-muted",
  blue: "bg-sky-500",
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  rose: "bg-rose-500",
  violet: "bg-violet-500",
  cyan: "bg-cyan-500",
  slate: "bg-slate-500",
};

const GROUP_ICON: Record<Grouping, IconName> = {
  project: "FolderGit2",
  section: "Rows3",
  machine: "Monitor",
};

const headerButton =
  "flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-state-hover hover:text-foreground";

export const FrameNode = memo(function FrameNode({ data, selected }: NodeProps<FrameFlowNode>) {
  const actions = useCanvasActions();
  const far = useIsFar();
  const [picking, setPicking] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  useEffect(() => {
    if (!confirmingDelete) return;
    const timer = setTimeout(() => setConfirmingDelete(false), 3000);
    return () => clearTimeout(timer);
  }, [confirmingDelete]);
  const isSection = data.grouping === "section" && data.sectionId !== null;
  const canCreate = data.grouping !== "machine";

  return (
    <div
      style={{ width: data.width, height: data.height }}
      className={cn("rounded-xl border-2", FRAME_TINT[data.color], selected && "ring-2 ring-ring")}
    >
      <div
        style={{ height: FRAME_HEADER }}
        className="flex cursor-grab items-center gap-2 px-4 active:cursor-grabbing"
      >
        <Icon name={GROUP_ICON[data.grouping]} className={cn("shrink-0 text-muted-foreground", far ? "size-8" : "size-4")} />
        {renaming ? (
          <input
            autoFocus
            defaultValue={data.name}
            aria-label="Section name"
            className="nodrag min-w-0 flex-1 rounded border border-input bg-background px-1.5 py-0.5 text-sm font-semibold outline-none focus:ring-1 focus:ring-ring"
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Escape") setRenaming(false);
              if (event.key === "Enter") {
                const name = event.currentTarget.value.trim();
                if (name !== "" && name !== data.name && data.sectionId) actions.renameSection(data.sectionId, name);
                setRenaming(false);
              }
            }}
            onBlur={() => setRenaming(false)}
          />
        ) : (
          <span
            className={cn("truncate font-semibold", far ? "text-4xl" : "text-sm")}
            onDoubleClick={isSection ? () => setRenaming(true) : undefined}
          >
            {data.name}
          </span>
        )}
        {far || renaming ? null : (
          <>
            <span className="shrink-0 text-xs text-muted-foreground">
              {data.count} thread{data.count === 1 ? "" : "s"}
            </span>
            {data.attention > 0 ? (
              <span className="shrink-0 rounded-full bg-amber-500/20 px-1.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                {data.attention} need{data.attention === 1 ? "s" : ""} you
              </span>
            ) : null}
            <span className="nodrag ml-auto flex shrink-0 items-center gap-1">
              {isSection ? (
                <>
                  <button type="button" aria-label="Rename section" title="Rename section" className={headerButton} onClick={() => setRenaming(true)}>
                    <Icon name="Pencil" className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label={confirmingDelete ? "Click again to delete the section" : "Delete section"}
                    title={confirmingDelete ? "Click again to delete; its threads move to No section" : "Delete section"}
                    className={cn(headerButton, confirmingDelete && "bg-destructive/15 text-destructive hover:text-destructive")}
                    onClick={() => {
                      if (!confirmingDelete) setConfirmingDelete(true);
                      else if (data.sectionId) actions.deleteSection(data.sectionId);
                    }}
                  >
                    <Icon name="Trash2" className="size-3.5" />
                  </button>
                </>
              ) : null}
              <span className="relative">
                <button type="button" aria-label="Frame color" title="Frame color" className={headerButton} onClick={() => setPicking((open) => !open)}>
                  <Icon name="Palette" className="size-3.5" />
                </button>
                {picking ? (
                  <span className="absolute right-0 top-7 z-10 flex gap-1 rounded-md border border-border bg-popover p-1.5 shadow-md">
                    {FRAME_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        aria-label={color === "none" ? "No color" : color}
                        className={cn(
                          "size-5 rounded-full border border-border",
                          SWATCH[color],
                          data.color === color && "ring-2 ring-ring ring-offset-1 ring-offset-background",
                        )}
                        onClick={() => {
                          actions.setFrameColor(data.frameKey, color);
                          setPicking(false);
                        }}
                      />
                    ))}
                  </span>
                ) : null}
              </span>
              {canCreate ? (
                <button
                  type="button"
                  aria-label={`New thread in ${data.name}`}
                  title={`New thread in ${data.name}`}
                  className={headerButton}
                  onClick={() => actions.newThreadIn(data)}
                >
                  <Icon name="Plus" className="size-3.5" />
                </button>
              ) : null}
            </span>
          </>
        )}
      </div>
    </div>
  );
});

const NOTE_TINT: Record<Note["color"], string> = {
  yellow: "bg-yellow-200 text-yellow-950 dark:bg-yellow-900/80 dark:text-yellow-50",
  blue: "bg-sky-200 text-sky-950 dark:bg-sky-900/80 dark:text-sky-50",
  green: "bg-emerald-200 text-emerald-950 dark:bg-emerald-900/80 dark:text-emerald-50",
  pink: "bg-pink-200 text-pink-950 dark:bg-pink-900/80 dark:text-pink-50",
  purple: "bg-violet-200 text-violet-950 dark:bg-violet-900/80 dark:text-violet-50",
  gray: "bg-neutral-200 text-neutral-950 dark:bg-neutral-800 dark:text-neutral-50",
};
const NOTE_SWATCH: Record<Note["color"], string> = {
  yellow: "bg-yellow-300",
  blue: "bg-sky-300",
  green: "bg-emerald-300",
  pink: "bg-pink-300",
  purple: "bg-violet-300",
  gray: "bg-neutral-300",
};

export const NoteNode = memo(function NoteNode({ data, selected }: NodeProps<NoteFlowNode>) {
  const { note } = data;
  const actions = useCanvasActions();
  const [text, setText] = useState(note.text);
  const textRef = useRef(note.text);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) {
      setText(note.text);
      textRef.current = note.text;
    }
  }, [note.text]);
  // Save typing after a pause rather than on every key.
  useEffect(() => {
    if (text === note.text) return;
    const timer = setTimeout(() => actions.updateNote({ ...note, text }), 600);
    return () => clearTimeout(timer);
  }, [text, note, actions]);

  return (
    <div
      style={{ width: note.width, height: note.height }}
      className={cn("group flex flex-col rounded-md shadow-md", NOTE_TINT[note.color], selected && "ring-2 ring-ring")}
    >
      <NodeResizer
        isVisible={selected ?? false}
        minWidth={120}
        minHeight={80}
        lineClassName="!border-transparent"
        handleClassName="!size-2.5 !rounded-sm !border-ring !bg-background"
        onResizeEnd={(_event, params) =>
          actions.updateNote({
            ...note,
            text: textRef.current,
            x: params.x,
            y: params.y,
            width: params.width,
            height: params.height,
          })
        }
      />
      <div className="flex h-6 shrink-0 cursor-grab items-center gap-1 px-1.5 opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing">
        {NOTE_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={`Note color ${color}`}
            className={cn(
              "nodrag size-3 rounded-full border border-black/20",
              NOTE_SWATCH[color],
              note.color === color && "ring-1 ring-black/50 dark:ring-white/70",
            )}
            onClick={() => actions.updateNote({ ...note, text: textRef.current, color })}
          />
        ))}
        <button
          type="button"
          aria-label="Delete note"
          className="nodrag ml-auto flex size-5 items-center justify-center rounded opacity-60 hover:bg-black/10 hover:opacity-100"
          onClick={() => actions.deleteNote(note.id)}
        >
          <Icon name="X" className="size-3.5" />
        </button>
      </div>
      <textarea
        value={text}
        placeholder="Note"
        onFocus={() => {
          editing.current = true;
        }}
        onBlur={() => {
          editing.current = false;
          if (text !== note.text) actions.updateNote({ ...note, text });
        }}
        onChange={(event) => {
          setText(event.target.value);
          textRef.current = event.target.value;
        }}
        onKeyDown={(event) => event.stopPropagation()}
        className="nodrag nowheel min-h-0 flex-1 resize-none bg-transparent px-3 pb-2 text-sm leading-relaxed outline-none placeholder:text-current placeholder:opacity-40"
      />
    </div>
  );
});

export const nodeTypes = { thread: ThreadNode, frame: FrameNode, note: NoteNode, chat: ChatNode };
