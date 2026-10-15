// Groups bb's thread state into the few buckets the canvas colors and filters by.

export type Bucket = "needs-you" | "working" | "error" | "done" | "idle";

export const BUCKETS: readonly Bucket[] = ["needs-you", "working", "error", "done", "idle"];

export const BUCKET_LABEL: Record<Bucket, string> = {
  "needs-you": "Needs you",
  working: "Working",
  error: "Error",
  done: "Done",
  idle: "Idle",
};

export interface StatusFields {
  status: string;
  runtimeStatus: string;
  indicator: string;
  hasPendingInteraction: boolean;
  queuedWork: string;
}

const BUSY = new Set(["active", "starting", "pending", "stopping", "provisioning", "waiting-for-host"]);

export function bucketOf(thread: StatusFields): Bucket {
  if (thread.hasPendingInteraction || thread.indicator === "waiting-for-input") return "needs-you";
  if (thread.status === "error" || thread.indicator === "unread-error" || thread.queuedWork === "failed") {
    return "error";
  }
  if (BUSY.has(thread.status) || BUSY.has(thread.runtimeStatus)) return "working";
  if (thread.indicator === "unread-success") return "done";
  return "idle";
}

/** "now", "4m", "3h", "2d" since `timestamp`. */
export function age(timestamp: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 45) return "now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}
