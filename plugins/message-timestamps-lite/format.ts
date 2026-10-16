const DAY_MS = 86_400_000;

function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** `12:43 PM`, `Yesterday 12:43 PM`, `Aug 12, 12:43 PM`, or `Aug 12, 2025, 12:43 PM`. */
export function formatSentAt(timestamp: number, now = new Date()): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";

  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const day = startOfLocalDay(date);
  const today = startOfLocalDay(now);
  if (day === today) return time;
  if (day === today - DAY_MS) return `Yesterday ${time}`;

  const datePart = date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
  return `${datePart}, ${time}`;
}

export type ParsedRowId = { threadId: string; role: "user" | "assistant"; seq: number | null };

/**
 * Message rows look like `thr_abc:user-seed:212` or
 * `thr_abc:assistant:kind:assistant|turn:...`; other rows return null. Only
 * user row ids end in their event sequence.
 */
export function parseMessageRowId(id: string): ParsedRowId | null {
  const parts = id.split(":");
  const threadId = parts[0];
  const kind = parts[1];
  if (parts.length < 3 || !threadId?.startsWith("thr_") || !kind) return null;
  if (kind === "assistant") return { threadId, role: "assistant", seq: null };
  if (!kind.startsWith("user")) return null;
  const seq = Number(parts[parts.length - 1]);
  return { threadId, role: "user", seq: Number.isInteger(seq) ? seq : null };
}
