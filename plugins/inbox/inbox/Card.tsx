import { useEffect, useState, type MouseEvent } from "react";
import { toast } from "sonner";
import { useBbNavigate, useSdk, type PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { cn } from "@/lib/utils";
import { useDetails, type Details } from "./details.ts";
import { Icon, type IconName } from "./icons.tsx";
import type { Ask, Resolution } from "./interaction.ts";
import { useNow } from "./motion.tsx";
import { ago, clock, duration, type Status } from "./status.ts";

export type Layout = "board" | "list";

export interface CardAction {
  id: string;
  label: string;
  icon: IconName | null;
  variant: keyof typeof BUTTON_VARIANT;
  /** The key that runs it on the selected card. */
  shortcut: string | null;
  /** Answers what the agent is waiting on. */
  answers: boolean;
  run(event?: { split: boolean }): void;
}

export interface CardMeta {
  provider: string;
  project: string | null;
  parentTitle: string | null;
}

const BUTTON_VARIANT = {
  default: "bg-foreground text-background hover:bg-foreground/90",
  outline: "border border-input bg-transparent hover:bg-state-hover hover:text-foreground",
  ghost: "hover:bg-state-hover hover:text-foreground",
};

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

function useActions(thread: PluginSidebarThread, status: Status, ask: Ask | null, onAnswered: () => void) {
  const sdk = useSdk();
  const navigate = useBbNavigate();
  const [busy, setBusy] = useState<string | null>(null);

  const perform = (id: string, label: string, work: () => Promise<unknown>, after?: () => void) => () => {
    if (busy !== null) return;
    setBusy(id);
    work().then(
      () => {
        setBusy(null);
        after?.();
      },
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

  const actions: CardAction[] = [];
  const answer = (id: string, label: string, icon: IconName | null, variant: CardAction["variant"], shortcut: string | null, resolution: Resolution) =>
    actions.push({ id, label, icon, variant, shortcut, answers: true, run: perform(id, label, resolve(resolution), onAnswered) });

  if (status === "waiting" && ask?.kind === "approval") {
    answer("reject", "Reject", null, "outline", "x", ask.reject);
    answer("approve", "Approve", null, "default", "a", ask.approve);
  }
  if (status === "waiting" && ask?.kind === "choice") {
    ask.options.forEach((option, index) =>
      answer(`choice-${index}`, option.label, null, index === 0 ? "default" : "outline", index < 9 ? String(index + 1) : null, option.resolution),
    );
  }
  const simple = (id: string, label: string, icon: IconName, variant: CardAction["variant"], shortcut: string, work: () => Promise<unknown>) =>
    actions.push({ id, label, icon, variant, shortcut, answers: false, run: perform(id, label, work) });
  if (status === "failed" && thread.status === "error") {
    simple("retry", "Retry", "RotateCcw", "default", "r", () => sdk.threads.retry({ threadId: thread.id }));
  }
  if (status === "running") simple("stop", "Stop", "CircleStop", "outline", "s", () => sdk.threads.stop({ threadId: thread.id }));
  if (thread.isUnread && status !== "waiting" && status !== "running") {
    simple("read", "Mark read", "CheckCheck", "ghost", "e", () => sdk.threads.markRead({ threadId: thread.id }));
  }
  const answeredInThread = status === "waiting" && ask?.kind !== "approval" && ask?.kind !== "choice";
  actions.push({
    id: "open",
    label: answeredInThread ? "Answer" : "Open",
    icon: "ArrowUpRight",
    variant: actions.some((action) => action.variant === "default") ? "outline" : "default",
    shortcut: "o",
    answers: false,
    run: (event) => navigate.toThread(thread.id, { split: event?.split ?? false }),
  });
  return { actions, busy };
}

/** The one-line summary under the title. */
function description(status: Status, details: Details | null): { text: string; tone: "normal" | "error" } | null {
  if (details === null) return null;
  const { summary, ask } = details;
  if (status === "waiting" && ask !== null) return { text: ask.detail ? `${ask.title}: ${ask.detail}` : ask.title, tone: "normal" };
  if (status === "running" && summary.latest !== null) return { text: summary.latest, tone: "normal" };
  if (summary.message !== null) return { text: summary.message, tone: summary.messageTone };
  return summary.latest === null ? null : { text: summary.latest, tone: "normal" };
}

function StatusLine({ status, details, layout, now, liveNow, thread }: {
  status: Status;
  details: Details | null;
  layout: Layout;
  now: number;
  liveNow: number;
  thread: PluginSidebarThread;
}) {
  const summary = details?.summary ?? null;
  const ran = summary?.startedAt != null && summary.endedAt !== null ? duration(summary.endedAt - summary.startedAt) : null;
  const since = ago(thread.latestAttentionAt, now);
  switch (status) {
    case "waiting":
      return (
        <>
          <Icon name="TriangleAlert" className="bb-inbox-tone size-3.5 shrink-0" />
          <span className="truncate">Waiting for you</span>
        </>
      );
    case "failed":
      return (
        <>
          <Icon name="CircleAlert" className="bb-inbox-tone size-3.5 shrink-0" />
          <span className="truncate">Failed{layout === "list" ? ` · ${since}` : ""}</span>
        </>
      );
    case "running": {
      const elapsed = summary?.startedAt != null ? clock(liveNow - summary.startedAt) : "…";
      return (
        <>
          <span className="bb-inbox-spinner size-3 shrink-0 rounded-full" aria-hidden />
          <span className="truncate tabular-nums">{layout === "list" ? `Running · ${elapsed}` : elapsed}</span>
        </>
      );
    }
    default: {
      const label =
        layout === "board" ? since : [status === "done" && ran !== null ? `Done in ${ran}` : status === "done" ? "Done" : "Idle", since].join(" · ");
      return (
        <>
          <span className="bb-inbox-tone-bg size-2 shrink-0 rounded-full" aria-hidden />
          <span className="truncate">{label}</span>
        </>
      );
    }
  }
}

export function Card({
  thread,
  status,
  meta,
  layout,
  open,
  selected,
  now,
  onToggle,
  onSelect,
  onAnswered,
  registerActions,
}: {
  thread: PluginSidebarThread;
  status: Status;
  meta: CardMeta;
  layout: Layout;
  open: boolean;
  selected: boolean;
  now: number;
  onToggle(): void;
  onSelect(): void;
  onAnswered(): void;
  registerActions(threadId: string, actions: CardAction[] | null): void;
}) {
  const { details, error } = useDetails(thread, status, open);
  const ask = details?.ask ?? null;
  const summary = details?.summary ?? null;
  const { actions, busy } = useActions(thread, status, ask, onAnswered);
  const liveNow = useNow(1000, status === "running");

  useEffect(() => {
    registerActions(thread.id, actions);
    return () => registerActions(thread.id, null);
  });

  const blurb = description(status, details);
  // The pending step is the request shown above it; don't list it twice.
  const steps = (summary?.steps ?? []).filter((step) => !(ask !== null && step.tone === "pending"));
  const branch = thread.environment?.branchName ?? null;
  const context = [meta.provider, meta.project, branch].filter(Boolean).join(" · ");

  const onRun = (action: CardAction) => (event: MouseEvent) => {
    event.stopPropagation();
    action.run({ split: event.shiftKey || event.metaKey });
  };

  return (
    <li
      data-flip-id={thread.id}
      data-status={status}
      className={cn(
        "rounded-lg border border-border/70 bg-card shadow-[0_1px_2px_rgb(0_0_0/0.04)] transition-shadow",
        selected && "border-foreground/30 ring-1 ring-foreground/20",
      )}
    >
      <div
        role="button"
        tabIndex={-1}
        aria-expanded={open}
        onClick={() => {
          onSelect();
          onToggle();
        }}
        className="cursor-pointer px-3 pb-2.5 pt-2.5"
      >
        <div className="flex items-start gap-2">
          <Icon name="Sparkle" className="bb-inbox-tone mt-[3px] size-3.5 shrink-0" />
          <span className={cn("min-w-0 flex-1 text-sm leading-5", thread.isUnread ? "font-semibold" : "font-medium", layout === "board" ? "line-clamp-2" : "truncate")}>
            {thread.displayTitle}
          </span>
        </div>
        <p
          className={cn(
            "mt-1 pl-[1.375rem] text-[13px] leading-5",
            blurb?.tone === "error" ? "bb-inbox-error" : "text-muted-foreground",
            layout === "board" ? "line-clamp-2" : "truncate",
          )}
        >
          {blurb?.text ?? (meta.parentTitle !== null ? `↳ ${meta.parentTitle}` : context) ?? "\u00a0"}
        </p>
        <div className="mt-2 flex items-center gap-2 pl-[1.375rem] text-xs text-muted-foreground">
          <span className="flex min-w-0 flex-1 items-center gap-1.5">
            <StatusLine status={status} details={details} layout={layout} now={now} liveNow={liveNow} thread={thread} />
          </span>
          {summary?.sourceCount ? (
            <span className="inline-flex shrink-0 items-center gap-1 tabular-nums" title="Files read and searches">
              <Icon name="Search" className="size-3" />
              {summary.sourceCount}
            </span>
          ) : null}
          {summary?.sourceCount && summary.toolCount ? <span className="h-3 w-px shrink-0 bg-border" aria-hidden /> : null}
          {summary?.toolCount ? (
            <span className="inline-flex shrink-0 items-center gap-1 tabular-nums" title="Tool calls">
              <Icon name="Wrench" className="size-3" />
              {summary.toolCount}
            </span>
          ) : null}
        </div>
      </div>
      <div className="bb-inbox-fold" data-open={open} aria-hidden={!open} inert={!open}>
        <div>
          <div className="mx-3 space-y-2.5 border-t border-border/70 pb-3 pt-2.5">
            <div className="truncate text-xs text-muted-foreground">
              {meta.parentTitle !== null ? `↳ ${meta.parentTitle} · ` : ""}
              {context}
            </div>
            {ask?.detail ? (
              <pre className="bb-inbox-ask max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-md px-2.5 py-2 font-mono text-xs">
                {ask.detail}
              </pre>
            ) : null}
            {steps.length > 0 ? (
              <ol className="bb-inbox-steps relative space-y-2 pl-3.5">
                {steps.map((step, index) => (
                  <li key={step.id} className="relative flex items-baseline gap-3 text-xs leading-4">
                    <span
                      data-tone={index === steps.length - 1 && step.tone === "normal" ? "last" : step.tone}
                      className="bb-inbox-step-dot absolute -left-[calc(0.875rem+1.5px)] top-[5px] size-1 rounded-full"
                      aria-hidden
                    />
                    <span
                      className={cn(
                        "min-w-0 flex-1 break-words",
                        layout === "list" && "truncate",
                        step.code && "font-mono",
                        step.tone === "error" ? "bb-inbox-error" : "text-foreground/85",
                      )}
                      title={step.label}
                    >
                      {layout === "board" && step.label.length > 90 ? `${step.label.slice(0, 89)}…` : step.label}
                    </span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{ago(step.time, now)}</span>
                  </li>
                ))}
              </ol>
            ) : null}
            {details === null && error === null ? <div className="text-xs text-muted-foreground">Loading the latest steps…</div> : null}
            {error !== null ? <div className="bb-inbox-error text-xs">Couldn't load steps: {error}</div> : null}
            <div className="flex flex-wrap items-center justify-end gap-1.5 pt-0.5">
              {actions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  disabled={busy !== null}
                  onClick={onRun(action)}
                  aria-keyshortcuts={action.shortcut ?? undefined}
                  className={cn(
                    "inline-flex h-7 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md px-2.5 text-xs font-medium transition-colors duration-150 hover:duration-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
                    BUTTON_VARIANT[action.variant],
                  )}
                >
                  {action.icon !== null ? <Icon name={action.icon} className="size-3.5" /> : null}
                  {busy === action.id ? `${action.label}…` : action.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </li>
  );
}
