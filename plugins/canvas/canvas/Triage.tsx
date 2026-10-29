import { useRef } from "react";
import { ThreadChat, type PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { cn } from "@/lib/utils";
import { useReleaseChatFocus } from "./chatFocus.ts";
import { Icon } from "./icons.tsx";
import type { Bucket } from "./status.ts";

export const needsAttention = (bucket: Bucket | undefined) => bucket === "needs-you" || bucket === "error";

/**
 * Triage: threads that need you, one at a time in a window over the dimmed
 * canvas. The queue is fixed when triage starts, so answered threads stay in
 * the progress dots instead of shifting the order.
 */
export function Triage({
  queue,
  index,
  threads,
  buckets,
  groupName,
  focusRequest,
  onStep,
  onLeave,
  onOpen,
  onReleaseFocus,
}: {
  queue: readonly string[];
  index: number;
  threads: ReadonlyMap<string, PluginSidebarThread>;
  buckets: ReadonlyMap<string, Bucket>;
  groupName(threadId: string): string;
  focusRequest: number;
  onStep(delta: number): void;
  onLeave(): void;
  onOpen(threadId: string): void;
  onReleaseFocus(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const threadId = queue[index]!;
  const thread = threads.get(threadId);
  useReleaseChatFocus(ref, threadId, focusRequest, onReleaseFocus);
  const left = queue.filter((id) => needsAttention(buckets.get(id))).length;

  return (
    <div className="absolute inset-0 z-30 flex items-start justify-center bg-background/60 pt-[6vh] backdrop-blur-[1px]">
      <div
        ref={ref}
        data-bb-canvas-chat=""
        role="dialog"
        aria-label="Triage"
        className="flex h-[min(640px,84%)] w-[min(620px,92%)] flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl"
      >
        <div className="flex h-11 shrink-0 items-center gap-3 border-b border-border px-3">
          <span className="text-sm font-semibold">Triage</span>
          <span className="text-xs tabular-nums text-muted-foreground">
            {index + 1} of {queue.length} · {left} left
          </span>
          <span className="flex items-center gap-1" aria-hidden>
            {queue.map((id, position) => {
              const bucket = buckets.get(id);
              return (
                <span
                  key={id}
                  className={cn("size-2 rounded-full", position === index && "ring-2 ring-ring ring-offset-1 ring-offset-background")}
                  style={{ background: needsAttention(bucket) ? `var(--status-${bucket})` : "var(--status-done)" }}
                />
              );
            })}
          </span>
          <span className="ml-auto flex items-center gap-0.5">
            {[
              { icon: "ChevronLeft" as const, label: "Previous (⇧N)", run: () => onStep(-1), disabled: queue.length < 2 },
              { icon: "ChevronRight" as const, label: "Next (n)", run: () => onStep(1), disabled: queue.length < 2 },
              { icon: "ArrowUpRight" as const, label: "Open thread (o)", run: () => onOpen(threadId), disabled: false },
              { icon: "X" as const, label: "Leave triage (Esc)", run: onLeave, disabled: false },
            ].map((button) => (
              <button
                key={button.label}
                type="button"
                aria-label={button.label}
                title={button.label}
                disabled={button.disabled}
                onClick={button.run}
                className="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-state-hover hover:text-foreground disabled:opacity-40"
              >
                <Icon name={button.icon} className="size-4" />
              </button>
            ))}
          </span>
        </div>
        {thread === undefined ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">This thread is gone.</div>
        ) : (
          <>
            <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 text-sm">
              <span className="size-2 shrink-0 rounded-full" style={{ background: `var(--status-${buckets.get(threadId) ?? "idle"})` }} />
              <span className="shrink-0 text-muted-foreground">{groupName(threadId)}</span>
              <span className="min-w-0 truncate font-medium">{thread.displayTitle}</span>
            </div>
            <div className="min-h-0 flex-1">
              <ThreadChat key={threadId} threadId={threadId} variant="compact" focusRequest={focusRequest} />
            </div>
          </>
        )}
        <div className="flex shrink-0 items-center gap-3 border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
          <span>
            <kbd className="font-mono">r</kbd> reply
          </span>
          <span>
            <kbd className="font-mono">n</kbd> / <kbd className="font-mono">⇧N</kbd> next / previous
          </span>
          <span>
            <kbd className="font-mono">o</kbd> open
          </span>
          <span>
            <kbd className="font-mono">⇧Esc</kbd> leave the reply box
          </span>
          <span className="ml-auto">
            <kbd className="font-mono">Esc</kbd> leave
          </span>
        </div>
      </div>
    </div>
  );
}
