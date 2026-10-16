// Groups bb's thread state into the inbox's status tags and filter tabs.

export type Status = "waiting" | "running" | "failed" | "done" | "idle";

export const STATUS_LABEL: Record<Status, string> = {
  waiting: "Needs you",
  running: "Running",
  failed: "Failed",
  done: "Done",
  idle: "Idle",
};

/** Rows sort by this rank first, so what needs you is always on top. */
const RANK: Record<Status, number> = { waiting: 0, failed: 1, running: 2, done: 3, idle: 4 };

export type Filter = "all" | "waiting" | "running" | "failed" | "done";

export const FILTERS: readonly { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "waiting", label: "Needs you" },
  { id: "running", label: "Running" },
  { id: "failed", label: "Failed" },
  { id: "done", label: "Done" },
];

export interface StatusFields {
  status: string;
  runtimeStatus: string;
  indicator: string;
  hasPendingInteraction: boolean;
  queuedWork: string;
}

const BUSY = new Set(["active", "starting", "pending", "stopping", "provisioning", "waiting-for-host"]);

export function statusOf(thread: StatusFields): Status {
  if (thread.hasPendingInteraction || thread.indicator === "waiting-for-input") return "waiting";
  if (thread.status === "error" || thread.indicator === "unread-error" || thread.queuedWork === "failed") {
    return "failed";
  }
  if (BUSY.has(thread.status) || BUSY.has(thread.runtimeStatus)) return "running";
  if (thread.indicator === "unread-success") return "done";
  return "idle";
}

export function matchesFilter(status: Status, filter: Filter): boolean {
  if (filter === "all") return true;
  if (filter === "done") return status === "done" || status === "idle";
  return status === filter;
}

export function compareRows(
  a: { status: Status; latestAttentionAt: number },
  b: { status: Status; latestAttentionAt: number },
): number {
  return RANK[a.status] - RANK[b.status] || b.latestAttentionAt - a.latestAttentionAt;
}

/** "0:42", "12:05", "1:02:09": a running clock. */
export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}

/** "42s", "4m 12s", "1h 3m": how long a finished turn took. */
export function duration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}m ${total % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** "now", "4m ago", "3h ago", "2d ago". */
export function ago(timestamp: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 45) return "now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
