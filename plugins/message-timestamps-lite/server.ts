import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { LAST_REPLY_CHANNEL, type LastReplySignal } from "./shared.ts";

type TimelineNode = {
  id?: string;
  kind?: string;
  role?: string;
  initiator?: string;
  createdAt?: number;
  children?: TimelineNode[] | null;
};

type MessageTime = { id: string; createdAt: number | null; inProgress?: boolean };

const cursorSchema = z.object({ anchorSeq: z.number(), anchorId: z.string() });

export const rpcContract = defineRpcContract({
  userMessageTimes: {
    input: z
      .object({
        threadId: z.string().min(1),
        before: cursorSchema.nullable().optional(),
      })
      .strict(),
    output: z.object({
      // createdAt is null for user-role rows the user did not send (messages
      // from other agents), so the client stops asking about them. inProgress
      // marks an agent reply that may still be streaming; ask again later.
      messages: z.array(
        z.object({
          id: z.string(),
          createdAt: z.number().nullable(),
          inProgress: z.boolean().optional(),
        }),
      ),
      olderCursor: cursorSchema.nullable(),
      maxSeq: z.number(),
    }),
  },
  lastReplyAt: {
    input: z.object({ threadId: z.string().min(1) }).strict(),
    output: z.object({ at: z.number().nullable() }),
  },
});

const lastReplyKey = (threadId: string) => `last-reply:${threadId}`;

function collectMessageRows(rows: TimelineNode[] | undefined, into: MessageTime[]): void {
  if (!rows) return;
  for (const row of rows) {
    if (row.kind === "conversation" && typeof row.id === "string") {
      const hasTime = typeof row.createdAt === "number";
      if (row.role === "user") {
        const sentByUser = row.initiator === "user" && hasTime;
        into.push({ id: row.id, createdAt: sentByUser ? row.createdAt! : null });
      } else if (row.role === "assistant") {
        // An assistant row's createdAt is its item/completed time.
        into.push({ id: row.id, createdAt: hasTime ? row.createdAt! : null });
      }
    }
    if (Array.isArray(row.children)) collectMessageRows(row.children, into);
  }
}

function latestAgentMessageAt(rows: TimelineNode[] | undefined): number | null {
  let at: number | null = null;
  for (const row of rows ?? []) {
    if (row.kind === "conversation" && row.role === "assistant" && typeof row.createdAt === "number") {
      at = Math.max(at ?? 0, row.createdAt);
    }
    if (Array.isArray(row.children)) {
      const nested = latestAgentMessageAt(row.children);
      if (nested != null) at = Math.max(at ?? 0, nested);
    }
  }
  return at;
}

const RUNNING_STATUSES = new Set(["active", "starting", "pending", "stopping"]);

export default function plugin(bb: BbPluginApi) {
  bb.rpc.register(rpcContract, {
    // One timeline page per call. The client asks for older pages only when
    // an older message scrolls into view.
    async userMessageTimes({ threadId, before }) {
      const timeline = await bb.sdk.threads.timeline({
        threadId,
        includeNestedRows: "true",
        ...(before
          ? { beforeAnchorSeq: String(before.anchorSeq), beforeAnchorId: before.anchorId }
          : {}),
      });
      const rows = timeline.rows as TimelineNode[];
      const messages: MessageTime[] = [];
      collectMessageRows(rows, messages);

      // Only the last row of the newest page can still be streaming.
      const last = rows[rows.length - 1];
      if (!before && last?.kind === "conversation" && last.role === "assistant") {
        const thread = await bb.sdk.threads.get({ threadId });
        if (RUNNING_STATUSES.has((thread as { status?: string }).status ?? "")) {
          const entry = messages.find((m) => m.id === last.id);
          if (entry) {
            entry.createdAt = null;
            entry.inProgress = true;
          }
        }
      }

      return {
        messages,
        olderCursor: timeline.timelinePage.olderCursor ?? null,
        maxSeq: timeline.maxSeq,
      };
    },

    async lastReplyAt({ threadId }) {
      const stored = await bb.storage.kv.get<number>(lastReplyKey(threadId));
      if (typeof stored === "number") return { at: stored };
      // Threads that went idle before install: use the newest agent message.
      // Its createdAt is its item/completed time.
      const timeline = await bb.sdk.threads.timeline({ threadId, includeNestedRows: "true" });
      return { at: latestAgentMessageAt(timeline.rows as TimelineNode[]) };
    },
  });

  // A turn ending is the agent's last reply. Failed turns are not replies.
  bb.events.on("thread.idle", async ({ thread }) => {
    const signal: LastReplySignal = { threadId: thread.id, at: Date.now() };
    await bb.storage.kv.set(lastReplyKey(thread.id), signal.at);
    bb.realtime.publish(LAST_REPLY_CHANNEL, signal);
  });
}
