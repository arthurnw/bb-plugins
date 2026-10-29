import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { LAST_REPLY_CHANNEL, type LastReplySignal } from "./shared.ts";

type TimelineNode = {
  id: string;
  kind?: string;
  role?: string;
  initiator?: string;
  createdAt?: number;
  children?: TimelineNode[] | null;
};

const cursorSchema = z.object({ anchorSeq: z.number(), anchorId: z.string() });
const pageSchema = z.object({
  // createdAt is null for user-role rows the user did not send (messages from
  // other agents), so the client stops asking about them. inProgress marks an
  // agent reply that may still be streaming; ask again later.
  messages: z.array(
    z.object({ id: z.string(), createdAt: z.number().nullable(), inProgress: z.boolean().optional() }),
  ),
  olderCursor: cursorSchema.nullable(),
  maxSeq: z.number(),
});
export type Cursor = z.infer<typeof cursorSchema>;
export type Page = z.infer<typeof pageSchema>;

export const rpcContract = defineRpcContract({
  userMessageTimes: {
    input: z.object({ threadId: z.string(), before: cursorSchema.nullable().optional() }),
    output: pageSchema,
  },
  lastReplyAt: {
    input: z.object({ threadId: z.string() }),
    output: z.object({ at: z.number().nullable() }),
  },
});

const lastReplyKey = (threadId: string) => `last-reply:${threadId}`;

// Conversation rows in timeline order, including nested ones.
function* messageRows(rows: TimelineNode[]): Generator<TimelineNode> {
  for (const row of rows) {
    if (row.kind === "conversation" && (row.role === "user" || row.role === "assistant")) yield row;
    if (row.children) yield* messageRows(row.children);
  }
}

const RUNNING_STATUSES = new Set(["active", "starting", "pending", "stopping"]);

export default function plugin(bb: BbPluginApi) {
  const timelineRows = async (threadId: string, before?: Cursor | null) => {
    const timeline = await bb.sdk.threads.timeline({
      threadId,
      includeNestedRows: "true",
      ...(before ? { beforeAnchorSeq: String(before.anchorSeq), beforeAnchorId: before.anchorId } : {}),
    });
    return { timeline, rows: timeline.rows as TimelineNode[] };
  };

  bb.rpc.register(rpcContract, {
    // One timeline page per call. The client asks for older pages only when
    // an older message scrolls into view.
    async userMessageTimes({ threadId, before }) {
      const { timeline, rows } = await timelineRows(threadId, before);
      // An assistant row's createdAt is its item/completed time.
      const messages: Page["messages"] = Array.from(messageRows(rows), (row) => ({
        id: row.id,
        createdAt: row.role === "user" && row.initiator !== "user" ? null : (row.createdAt ?? null),
      }));

      // Only the last row of the newest page can still be streaming.
      const last = rows.at(-1);
      if (!before && last?.kind === "conversation" && last.role === "assistant") {
        const thread = await bb.sdk.threads.get({ threadId });
        if (RUNNING_STATUSES.has((thread as { status?: string }).status ?? "")) {
          const entry = messages.find((m) => m.id === last.id);
          if (entry) Object.assign(entry, { createdAt: null, inProgress: true });
        }
      }

      return { messages, olderCursor: timeline.timelinePage.olderCursor ?? null, maxSeq: timeline.maxSeq };
    },

    async lastReplyAt({ threadId }) {
      const stored = await bb.storage.kv.get<number>(lastReplyKey(threadId));
      if (stored != null) return { at: stored };
      // Threads that went idle before install: use the newest agent message.
      const { rows } = await timelineRows(threadId);
      let at: number | null = null;
      for (const row of messageRows(rows)) {
        if (row.role === "assistant" && row.createdAt != null) at = Math.max(at ?? 0, row.createdAt);
      }
      return { at };
    },
  });

  // A turn ending is the agent's last reply. Failed turns are not replies.
  bb.events.on("thread.idle", async ({ thread }) => {
    const signal: LastReplySignal = { threadId: thread.id, at: Date.now() };
    await bb.storage.kv.set(lastReplyKey(thread.id), signal.at);
    bb.realtime.publish(LAST_REPLY_CHANNEL, signal);
  });
}
