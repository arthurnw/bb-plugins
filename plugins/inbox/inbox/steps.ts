// Reads a thread's latest turn out of bb's timeline rows: when it started and
// ended, how many tool calls it made, its last few steps, and its last message.
// Rows are read structurally, since bb adds row kinds over time.

export interface TimelineRowLike {
  id: string;
  kind: string;
  turnId?: string | null;
  startedAt: number;
  createdAt: number;
  completedAt?: number | null;
  status?: string | null;
  role?: string;
  text?: string;
  workKind?: string;
  systemKind?: string;
  title?: string;
  detail?: string | null;
  command?: string;
  toolName?: string;
  path?: string | null;
  query?: string;
  url?: string;
  queries?: string[];
  change?: { path?: string; kind?: string; diffStats?: { added: number; removed: number } | null };
  presentation?: { label?: { pending?: string; completed?: string }; title?: string; detail?: string };
  summaryCount?: number;
  sourceSeqStart?: number;
  sourceSeqEnd?: number;
  children?: TimelineRowLike[] | null;
}

export type StepTone = "normal" | "error" | "pending";

export interface Step {
  id: string;
  label: string;
  /** Shell commands render in a monospace face. */
  code: boolean;
  time: number;
  tone: StepTone;
}

export interface TurnSummary {
  turnId: string | null;
  startedAt: number | null;
  /** Null while the turn is still running. */
  endedAt: number | null;
  toolCount: number;
  steps: Step[];
  /** The agent's last message, or the last error, as plain text. */
  message: string | null;
  messageTone: "normal" | "error";
  /** A collapsed completed turn whose rows must be fetched separately. */
  collapsedTurn: { turnId: string; sourceSeqStart: number; sourceSeqEnd: number } | null;
}

const MAX_STEPS = 4;

const firstLine = (text: string) => text.trim().split("\n", 1)[0] ?? "";
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const basename = (path: string) => path.split("/").filter(Boolean).pop() ?? path;
/** "file-read" → "File read", for row kinds this file doesn't know yet. */
const humanize = (kind: string) => kind.charAt(0).toUpperCase() + kind.slice(1).replace(/[-_]/g, " ");

/** Strips the markdown that would read as noise in a one-line preview. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#+\s*/gm, "")
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function stepLabel(row: TimelineRowLike): { label: string; code: boolean } | null {
  if (row.kind === "conversation") {
    if (row.role !== "assistant" || !row.text) return null;
    return { label: clip(plainText(row.text), 120), code: false };
  }
  if (row.kind === "system") {
    if (row.systemKind === "error" || row.status === "error") return { label: row.title ?? "Error", code: false };
    return null;
  }
  if (row.kind !== "work") return null;
  const done = row.status !== "pending";
  const presented = done ? row.presentation?.label?.completed : row.presentation?.label?.pending;
  switch (row.workKind) {
    case "command":
      return row.command ? { label: clip(firstLine(row.command), 100), code: true } : null;
    case "file-change": {
      const path = row.change?.path;
      if (!path) break;
      const verb = row.change?.kind === "add" ? "Created" : row.change?.kind === "delete" ? "Deleted" : "Edited";
      const stats = row.change?.diffStats;
      const delta = stats ? ` +${stats.added} −${stats.removed}` : "";
      return { label: `${verb} ${basename(path)}${delta}`, code: false };
    }
    case "file-read":
      if (row.path) return { label: `Read ${basename(row.path)}`, code: false };
      break;
    case "web-search":
      if (row.queries?.[0]) return { label: `Searched the web for “${clip(row.queries[0], 80)}”`, code: false };
      break;
    case "web-fetch":
      if (row.url) return { label: `Fetched ${clip(row.url, 100)}`, code: false };
      break;
    case "search":
      if (row.query) return { label: `Searched for “${clip(row.query, 80)}”`, code: false };
      break;
    case "image-view":
      return { label: row.path ? `Viewed ${basename(row.path)}` : "Viewed an image", code: false };
    case "image-generation":
      return { label: "Generated an image", code: false };
    case "plan-steps":
      return { label: "Updated the plan", code: false };
    case "approval":
      return { label: "Asked for approval", code: false };
    case "question":
    case "form":
      return { label: "Asked you a question", code: false };
  }
  const subject = row.presentation?.title ?? row.presentation?.detail;
  if (presented) return { label: clip(subject ? `${presented} · ${subject}` : presented, 120), code: false };
  if (row.toolName) return { label: row.toolName, code: false };
  return row.workKind ? { label: humanize(row.workKind), code: false } : null;
}

function toneOf(row: TimelineRowLike): StepTone {
  if (row.status === "error" || row.systemKind === "error") return "error";
  if (row.status === "pending") return "pending";
  return "normal";
}

/** Rows of the turn, with a loaded turn row's children spliced in place. */
function flatten(rows: readonly TimelineRowLike[]): TimelineRowLike[] {
  return rows.flatMap((row) => (row.kind === "turn" && row.children ? flatten(row.children) : [row]));
}

/**
 * Summarizes the latest turn in `rows` (a `threads.timeline` page, or the
 * rows of a collapsed turn from `threads.timelineTurnSummaryDetails`).
 * `running` says whether the thread is still working on it.
 */
export function summarizeTurn(rows: readonly TimelineRowLike[], running: boolean): TurnSummary {
  const latestTurnId = [...rows].reverse().find((row) => row.turnId)?.turnId ?? null;
  const turnRows = latestTurnId === null ? [] : rows.filter((row) => row.turnId === latestTurnId);
  const collapsed = turnRows.find((row) => row.kind === "turn" && !row.children);
  const flat = flatten(turnRows).filter((row) => row.kind !== "turn");
  // A failed start leaves only thread-level error rows, with no turn.
  const tail = latestTurnId === null ? rows.filter((row) => row.kind === "system" && row.systemKind === "error") : flat;

  const starts = turnRows.map((row) => row.startedAt);
  const startedAt = starts.length > 0 ? Math.min(...starts) : null;
  const ends = turnRows.map((row) => row.completedAt ?? row.createdAt);
  const endedAt = running || ends.length === 0 ? null : Math.max(...ends);

  const steps: Step[] = [];
  for (const row of tail) {
    const label = stepLabel(row);
    if (label) steps.push({ id: row.id, ...label, time: row.completedAt ?? row.startedAt, tone: toneOf(row) });
  }

  const lastError = [...tail].reverse().find((row) => row.kind === "system" && toneOf(row) === "error");
  const lastAssistant = [...tail].reverse().find((row) => row.kind === "conversation" && row.role === "assistant");
  const errorIsLatest = lastError !== undefined && (lastAssistant === undefined || lastError.startedAt > lastAssistant.startedAt);
  const message = errorIsLatest
    ? (lastError.detail ?? lastError.title ?? null)
    : lastAssistant?.text
      ? plainText(lastAssistant.text)
      : null;

  const toolCount = flat.filter((row) => row.kind === "work").length || (collapsed?.summaryCount ?? 0);

  return {
    turnId: latestTurnId,
    startedAt,
    endedAt,
    toolCount,
    // The final message shows in full above the steps, so it is not repeated as one.
    steps: steps.filter((step) => step.id !== lastAssistant?.id).slice(-MAX_STEPS),
    message,
    messageTone: errorIsLatest ? "error" : "normal",
    collapsedTurn:
      collapsed && collapsed.sourceSeqStart !== undefined && collapsed.sourceSeqEnd !== undefined
        ? { turnId: collapsed.turnId!, sourceSeqStart: collapsed.sourceSeqStart, sourceSeqEnd: collapsed.sourceSeqEnd }
        : null,
  };
}

/** Merges the rows of a collapsed turn into the page summary. */
export function expandCollapsedTurn(
  page: readonly TimelineRowLike[],
  turnRows: readonly TimelineRowLike[],
  running: boolean,
): TurnSummary {
  const turnId = turnRows.find((row) => row.turnId)?.turnId;
  const withTurnId = turnRows.map((row) => ({ ...row, turnId: row.turnId ?? turnId ?? null }));
  const merged = page.flatMap((row) => (row.kind === "turn" && !row.children && row.turnId === turnId ? withTurnId : [row]));
  return summarizeTurn(merged, running);
}
