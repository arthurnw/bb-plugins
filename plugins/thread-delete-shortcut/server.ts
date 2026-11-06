import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

const RENDERER_ID = "confirm-delete";

type DeletePrompt = {
  threadTitle: string;
  hasChildren: boolean;
};

export const rpcContract = defineRpcContract({
  deleteCurrent: {
    input: z.object({ threadId: z.string().min(1) }),
    output: z.object({ deleted: z.boolean() }),
  },
});

async function deleteCurrent(
  bb: BbPluginApi,
  threadId: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const thread = await bb.sdk.threads.get({ threadId });
  const cascade = await bb.sdk.threads.experimental_listCascade({
    threadIds: [threadId],
    action: "delete",
  });
  const hasChildren = (cascade.threads[0]?.cascadeThreadIds.length ?? 0) > 1;
  const prompt: DeletePrompt = {
    threadTitle: thread.title ?? "Untitled thread",
    hasChildren,
  };

  const answer = await bb.ui.requestInput(
    {
      threadId,
      rendererId: RENDERER_ID,
      title: "Delete thread permanently?",
      payload: prompt,
      timeoutMs: 60_000,
    },
    { signal },
  );

  if (answer.outcome !== "submitted" || answer.value !== true) return false;

  await bb.sdk.threads.delete({
    threadId,
    childThreadsConfirmed: true,
  });
  return true;
}

export default async function plugin(bb: BbPluginApi) {
  bb.rpc.register(rpcContract, {
    deleteCurrent: async ({ threadId }, context) => ({
      deleted: await deleteCurrent(bb, threadId, context.experimental_signal),
    }),
  });

  bb.cli.register({
    name: "thread-delete-shortcut",
    summary: "Delete the focused thread after confirmation",
    commands: [
      {
        name: "delete-current",
        summary: "Ask for confirmation, then delete the focused thread",
        usage: "bb thread-delete-shortcut delete-current",
      },
    ],
    async run(argv, context) {
      const [command, option] = argv;
      if (command !== "delete-current" && command !== "--help") {
        return {
          exitCode: 2,
          stderr: "Usage: bb thread-delete-shortcut delete-current",
        };
      }
      if (command === "--help" || option === "--help") {
        return {
          exitCode: 0,
          stdout: "Usage: bb thread-delete-shortcut delete-current",
        };
      }

      const threadId = context.threadId;
      if (threadId === undefined) {
        return {
          exitCode: 1,
          stderr: "No focused thread. Run the command from an open BB thread.",
        };
      }

      try {
        const deleted = await deleteCurrent(bb, threadId, context.signal);
        return {
          exitCode: 0,
          stdout: deleted ? `Deleted thread ${threadId}.` : "Deletion cancelled.",
        };
      } catch (error) {
        return {
          exitCode: 1,
          stderr: error instanceof Error ? error.message : String(error),
        };
      }
    },
  });
}
