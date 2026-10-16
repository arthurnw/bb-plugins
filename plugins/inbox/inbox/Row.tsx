import { useEffect, useState, type MouseEvent } from "react";
import { toast } from "sonner";
import { ThreadTitle, useBbNavigate, useSdk, type PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useDetails } from "./details.ts";
import { Icon, type IconName } from "./icons.tsx";
import type { Ask, Resolution } from "./interaction.ts";
import { useNow } from "./motion.tsx";
import { STATUS_LABEL, ago, clock, duration, type Status } from "./status.ts";

export interface RowAction {
  id: string;
  label: string;
  icon: IconName;
  variant: "default" | "outline" | "ghost";
  /** The key that runs it on the selected row. */
  shortcut: string | null;
  run(event?: { split: boolean }): void;
}

export interface RowMeta {
  provider: string;
  project: string | null;
  parentTitle: string | null;
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

function useActions(thread: PluginSidebarThread, status: Status, ask: Ask | null) {
  const sdk = useSdk();
  const navigate = useBbNavigate();
  const [busy, setBusy] = useState<string | null>(null);

  const perform = (id: string, label: string, work: () => Promise<unknown>) => () => {
    if (busy !== null) return;
    setBusy(id);
    work().then(
      () => setBusy(null),
      (error: unknown) => {
        setBusy(null);
        toast.error(`${label} failed`, { description: errorText(error) });
      },
    );
  };
  const resolve = (resolution: Resolution) => () =>
    sdk.threads.interactions.resolve({
      threadId: thread.id,
      interactionId: ask!.id,
      resolution: resolution as Parameters<typeof sdk.threads.interactions.resolve>[0]["resolution"],
    });

  const actions: RowAction[] = [];
  if (status === "waiting" && ask?.kind === "approval") {
    actions.push(
      { id: "reject", label: "Reject", icon: "X", variant: "outline", shortcut: "x", run: perform("reject", "Reject", resolve(ask.reject)) },
      { id: "approve", label: "Approve", icon: "Check", variant: "default", shortcut: "a", run: perform("approve", "Approve", resolve(ask.approve)) },
    );
  }
  if (status === "waiting" && ask?.kind === "choice") {
    ask.options.forEach((option, index) => {
      actions.push({
        id: `choice-${index}`,
        label: option.label,
        icon: "Check",
        variant: index === 0 ? "default" : "outline",
        shortcut: index < 9 ? String(index + 1) : null,
        run: perform(`choice-${index}`, "Answer", resolve(option.resolution)),
      });
    });
  }
  if (status === "failed" && thread.status === "error") {
    actions.push({
      id: "retry",
      label: "Retry",
      icon: "RotateCcw",
      variant: "default",
      shortcut: "r",
      run: perform("retry", "Retry", () => sdk.threads.retry({ threadId: thread.id })),
    });
  }
  if (status === "running") {
    actions.push({
      id: "stop",
      label: "Stop",
      icon: "CircleStop",
      variant: "outline",
      shortcut: "s",
      run: perform("stop", "Stop", () => sdk.threads.stop({ threadId: thread.id })),
    });
  }
  if (thread.isUnread && status !== "waiting" && status !== "running") {
    actions.push({
      id: "read",
      label: "Mark read",
      icon: "CheckCheck",
      variant: "ghost",
      shortcut: "e",
      run: perform("read", "Mark read", () => sdk.threads.markRead({ threadId: thread.id })),
    });
  }
  actions.push({
    id: "open",
    label: status === "waiting" && ask?.kind !== "approval" && ask?.kind !== "choice" ? "Answer" : "Open",
    icon: "ArrowUpRight",
    variant: actions.some((action) => action.variant === "default") ? "outline" : "default",
    shortcut: "o",
    run: (event) => navigate.toThread(thread.id, { split: event?.split ?? false }),
  });
  return { actions, busy };
}

function Dot({ status }: { status: Status }) {
  return <span data-status={status} className="bb-inbox-dot size-2.5 shrink-0 rounded-full" aria-hidden />;
}

function Tag({ status }: { status: Status }) {
  return (
    <span data-status={status} className="bb-inbox-tag inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[11px] font-medium">
      {STATUS_LABEL[status]}
    </span>
  );
}

export function Row({
  thread,
  status,
  meta,
  open,
  selected,
  now,
  onToggle,
  onSelect,
  registerActions,
}: {
  thread: PluginSidebarThread;
  status: Status;
  meta: RowMeta;
  open: boolean;
  selected: boolean;
  now: number;
  onToggle(): void;
  onSelect(): void;
  registerActions(threadId: string, actions: RowAction[] | null): void;
}) {
  const { details, error } = useDetails(thread, status, open);
  const ask = details?.ask ?? null;
  const summary = details?.summary ?? null;
  const { actions, busy } = useActions(thread, status, ask);
  const liveNow = useNow(1000, status === "running" || (open && status === "waiting"));

  useEffect(() => {
    registerActions(thread.id, actions);
    return () => registerActions(thread.id, null);
  });

  const time =
    status !== "running"
      ? ago(thread.latestAttentionAt, now)
      : summary?.startedAt != null
        ? clock(liveNow - summary.startedAt)
        : "…";
  const branch = thread.environment?.branchName ?? null;
  const subtitle =
    status === "waiting" && ask !== null
      ? ask.title
      : [meta.provider, meta.project, branch].filter(Boolean).join(" · ");
  const ran =
    summary?.startedAt != null
      ? status === "running"
        ? `Running for ${duration(liveNow - summary.startedAt)}`
        : summary.endedAt !== null
          ? `Ran for ${duration(summary.endedAt - summary.startedAt)}`
          : null
      : null;

  const onRun = (action: RowAction) => (event: MouseEvent) => {
    event.stopPropagation();
    action.run({ split: event.shiftKey || event.metaKey });
  };

  return (
    <li
      data-flip-id={thread.id}
      data-selected={selected}
      className={cn(
        "relative border-b border-border last:border-b-0",
        open && "bg-muted/40",
        selected && "before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-ring",
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          onSelect();
          onToggle();
        }}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-state-hover focus-visible:outline-none"
      >
        <Dot status={status} />
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate text-sm", thread.isUnread ? "font-semibold" : "font-medium")}>
            <ThreadTitle threadId={thread.id} />
          </span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {meta.parentTitle !== null ? <span className="mr-1">↳ {meta.parentTitle} ·</span> : null}
            {subtitle}
          </span>
        </span>
        <Tag status={status} />
        <span className="w-16 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">{time}</span>
        <Icon
          name="ChevronDown"
          className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-300", open && "rotate-180")}
        />
      </button>
      <div className="bb-inbox-fold" data-open={open} aria-hidden={!open} inert={!open}>
        <div>
          <div className="space-y-3 px-4 pb-4 pl-[2.6rem]">
            {ask !== null ? (
              <div className="bb-inbox-ask rounded-md px-3 py-2 text-sm">
                <div className="font-medium">{ask.title}</div>
                {ask.detail !== null ? (
                  <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground">
                    {ask.detail}
                  </pre>
                ) : null}
              </div>
            ) : null}
            {summary?.message ? (
              <p
                className={cn(
                  "line-clamp-3 text-sm",
                  summary.messageTone === "error" ? "bb-inbox-error" : "text-muted-foreground",
                )}
              >
                {summary.message}
              </p>
            ) : null}
            {summary !== null && summary.steps.length > 0 ? (
              <ol className="bb-inbox-steps relative space-y-1.5 pl-4">
                {summary.steps.map((step) => (
                  <li key={step.id} className="relative flex items-baseline gap-3 text-xs">
                    <span
                      data-tone={step.tone}
                      className="bb-inbox-step-dot absolute -left-[calc(1rem+2.5px)] top-1.5 size-1.5 rounded-full"
                      aria-hidden
                    />
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate",
                        step.code && "font-mono",
                        step.tone === "error" ? "bb-inbox-error" : "text-foreground/80",
                      )}
                      title={step.label}
                    >
                      {step.label}
                    </span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{ago(step.time, now)}</span>
                  </li>
                ))}
              </ol>
            ) : null}
            {details === null && error === null && open ? (
              <div className="text-xs text-muted-foreground">Loading the latest steps…</div>
            ) : null}
            {error !== null ? <div className="bb-inbox-error text-xs">Couldn't load steps: {error}</div> : null}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-1">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {summary !== null && summary.toolCount > 0 ? (
                  <span className="inline-flex items-center gap-1">
                    <Icon name="Wrench" className="size-3" />
                    {summary.toolCount} tool {summary.toolCount === 1 ? "call" : "calls"}
                  </span>
                ) : null}
                {ran !== null ? <span className="tabular-nums">{ran}</span> : null}
                {branch !== null ? (
                  <span className="inline-flex min-w-0 items-center gap-1">
                    <Icon name="GitBranch" className="size-3 shrink-0" />
                    <span className="truncate">{branch}</span>
                  </span>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                {actions.map((action) => (
                  <Button
                    key={action.id}
                    size="sm"
                    variant={action.variant}
                    disabled={busy !== null}
                    onClick={onRun(action)}
                    aria-keyshortcuts={action.shortcut ?? undefined}
                  >
                    <Icon name={action.icon} className="size-3.5" />
                    {busy === action.id ? `${action.label}…` : action.label}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </li>
  );
}
