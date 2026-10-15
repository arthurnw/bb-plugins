import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useStore } from "@xyflow/react";
import { ThreadChat, type PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { cn } from "@/lib/utils";
import { useReleaseChatFocus } from "./chatFocus.ts";
import { Icon } from "./icons.tsx";
import type { Point } from "./layout.ts";
import type { Bucket } from "./status.ts";

/** A pinned chat window, in pixels relative to the canvas area. */
export interface PinnedWindow {
  threadId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  minimized: boolean;
}

export const WINDOW_W = 380;
export const WINDOW_H = 440;
const MIN_W = 280;
const MIN_H = 200;
const HEADER_H = 36;

export interface Area {
  width: number;
  height: number;
}

export function clampWindow(window: PinnedWindow, area: Area): PinnedWindow {
  const width = Math.min(Math.max(window.width, MIN_W), Math.max(MIN_W, area.width - 16));
  const height = Math.min(Math.max(window.height, MIN_H), Math.max(MIN_H, area.height - 16));
  return {
    ...window,
    width,
    height,
    x: Math.min(Math.max(window.x, 8 - width + 80), area.width - 80),
    y: Math.min(Math.max(window.y, 8), area.height - HEADER_H),
  };
}

/** Where a new window goes: down the right side, stepping left as they pile up. */
export function nextWindowSpot(existing: readonly PinnedWindow[], area: Area): Point {
  const open = existing.filter((window) => !window.minimized).length;
  return {
    x: Math.max(8, area.width - WINDOW_W - 24 - open * 32),
    y: 72 + open * 32,
  };
}

/** Drag `onMove` deltas from a pointer down until release. */
function track(event: ReactPointerEvent, onMove: (dx: number, dy: number) => void, onEnd: () => void) {
  event.preventDefault();
  const startX = event.clientX;
  const startY = event.clientY;
  const move = (next: PointerEvent) => onMove(next.clientX - startX, next.clientY - startY);
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    onEnd();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

function ChatWindow({
  pinned,
  thread,
  bucket,
  focused,
  stack,
  focusRequest,
  area,
  onChange,
  onFocus,
  onUnpin,
  onOpen,
  onReleaseFocus,
}: {
  pinned: PinnedWindow;
  thread: PluginSidebarThread;
  bucket: Bucket;
  focused: boolean;
  stack: number;
  focusRequest: number;
  area: Area;
  onChange(next: PinnedWindow, done: boolean): void;
  onFocus(): void;
  onUnpin(): void;
  onOpen(): void;
  onReleaseFocus(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useReleaseChatFocus(ref, thread.id, focusRequest, onReleaseFocus);
  const live = useRef(pinned);
  live.current = pinned;

  const drag = (event: ReactPointerEvent, mode: "move" | "resize") => {
    if (event.button !== 0) return;
    onFocus();
    const start = live.current;
    let latest = start;
    track(
      event,
      (dx, dy) => {
        latest = clampWindow(
          mode === "move"
            ? { ...start, x: start.x + dx, y: start.y + dy }
            : { ...start, width: start.width + dx, height: start.height + dy },
          area,
        );
        onChange(latest, false);
      },
      () => onChange(latest, true),
    );
  };

  return (
    <div
      ref={ref}
      data-bb-canvas-chat=""
      onPointerDownCapture={onFocus}
      style={{ left: pinned.x, top: pinned.y, width: pinned.width, height: pinned.height, zIndex: 10 + stack }}
      className={cn(
        "absolute flex flex-col overflow-hidden rounded-xl border bg-background",
        focused ? "border-ring shadow-2xl" : "border-border shadow-lg",
      )}
    >
      <div
        style={{ height: HEADER_H }}
        className={cn(
          "flex shrink-0 cursor-grab items-center gap-2 border-b border-border pl-3 pr-1.5 active:cursor-grabbing",
          !focused && "bg-muted/40 text-muted-foreground",
        )}
        onPointerDown={(event) => drag(event, "move")}
      >
        <span className="size-2 shrink-0 rounded-full" style={{ background: `var(--status-${bucket})` }} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium" title={thread.displayTitle}>
          {thread.displayTitle}
        </span>
        {[
          { icon: "Minus" as const, label: "Minimize (-)", run: () => onChange({ ...pinned, minimized: true }, true) },
          { icon: "ArrowUpRight" as const, label: "Open thread", run: onOpen },
          { icon: "PinOff" as const, label: "Unpin (p)", run: onUnpin },
        ].map((button) => (
          <button
            key={button.label}
            type="button"
            aria-label={button.label}
            title={button.label}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={button.run}
            className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-state-hover hover:text-foreground"
          >
            <Icon name={button.icon} className="size-3.5" />
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        <ThreadChat threadId={thread.id} variant="compact" focusRequest={focusRequest} />
      </div>
      <div
        aria-hidden
        onPointerDown={(event) => drag(event, "resize")}
        className="absolute bottom-0 right-0 size-4 cursor-nwse-resize"
      >
        <span className="absolute bottom-1 right-1 size-2 border-b-2 border-r-2 border-muted-foreground/40" />
      </div>
    </div>
  );
}

/**
 * Pinned chat windows floating over the canvas, each joined to its card by a
 * line; minimized ones sit as pills along the bottom edge.
 */
export function PinnedWindows({
  windows,
  threads,
  buckets,
  focusedId,
  focusRequests,
  area,
  anchorOf,
  onChange,
  onFocus,
  onUnpin,
  onOpen,
  onReleaseFocus,
}: {
  windows: readonly PinnedWindow[];
  threads: ReadonlyMap<string, PluginSidebarThread>;
  buckets: ReadonlyMap<string, Bucket>;
  focusedId: string | null;
  focusRequests: Readonly<Record<string, number>>;
  area: Area;
  /** The card's right-edge midpoint in canvas-area pixels, or null when off the canvas. */
  anchorOf(threadId: string): Point | null;
  onChange(next: PinnedWindow, done: boolean): void;
  onFocus(threadId: string): void;
  onUnpin(threadId: string): void;
  onOpen(threadId: string): void;
  onReleaseFocus(): void;
}) {
  // Redraw the lines whenever the canvas pans or zooms.
  useStore((state) => state.transform);
  const open = windows.filter((window) => !window.minimized && threads.has(window.threadId));
  const minimized = windows.filter((window) => window.minimized && threads.has(window.threadId));
  // The focused window draws last, on top.
  const order = [...open].sort((a, b) => Number(a.threadId === focusedId) - Number(b.threadId === focusedId));

  return (
    <>
      <svg className="pointer-events-none absolute inset-0 z-[9] size-full overflow-visible">
        {open.map((window) => {
          const anchor = anchorOf(window.threadId);
          if (anchor === null) return null;
          // Attach to whichever side of the window faces the card.
          const toLeft = anchor.x < window.x + window.width / 2;
          const end = { x: toLeft ? window.x : window.x + window.width, y: window.y + HEADER_H / 2 };
          const mid = (anchor.x + end.x) / 2;
          const color = `var(--status-${buckets.get(window.threadId) ?? "idle"})`;
          return (
            <g key={window.threadId} opacity={window.threadId === focusedId ? 1 : 0.55}>
              <path
                d={`M${anchor.x},${anchor.y} C${mid},${anchor.y} ${mid},${end.y} ${end.x},${end.y}`}
                fill="none"
                stroke={color}
                strokeWidth={1.5}
                strokeDasharray="5 4"
              />
              <circle cx={anchor.x} cy={anchor.y} r={3.5} fill={color} />
            </g>
          );
        })}
      </svg>
      {order.map((window) => (
        <ChatWindow
          key={window.threadId}
          pinned={window}
          thread={threads.get(window.threadId)!}
          bucket={buckets.get(window.threadId) ?? "idle"}
          focused={window.threadId === focusedId}
          stack={window.threadId === focusedId ? open.length : order.indexOf(window)}
          focusRequest={focusRequests[window.threadId] ?? 0}
          area={area}
          onChange={onChange}
          onFocus={() => onFocus(window.threadId)}
          onUnpin={() => onUnpin(window.threadId)}
          onOpen={() => onOpen(window.threadId)}
          onReleaseFocus={onReleaseFocus}
        />
      ))}
      {minimized.length > 0 ? (
        <div className="absolute bottom-3 left-1/2 z-20 flex max-w-[60%] -translate-x-1/2 flex-wrap justify-center gap-1.5">
          {minimized.map((window) => {
            const thread = threads.get(window.threadId)!;
            return (
              <button
                key={window.threadId}
                type="button"
                title={`Restore ${thread.displayTitle}`}
                onClick={() => {
                  onChange({ ...window, minimized: false }, true);
                  onFocus(window.threadId);
                }}
                className="flex max-w-56 items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-xs shadow-md hover:bg-state-hover"
              >
                <span className="size-2 shrink-0 rounded-full" style={{ background: `var(--status-${buckets.get(window.threadId) ?? "idle"})` }} />
                <span className="truncate">{thread.displayTitle}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </>
  );
}
