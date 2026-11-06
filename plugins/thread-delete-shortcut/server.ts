import type { BbPluginApi } from "@get-bb/plugin-sdk";

const RENDERER_ID = "confirm-delete";

type DeletePrompt = {
  threadTitle: string;
  hasChildren: boolean;
};

export default async function plugin(bb: BbPluginApi) {
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
          { signal: context.signal },
        );

        if (answer.outcome !== "submitted" || answer.value !== true) {
          return { exitCode: 0, stdout: "Deletion cancelled." };
        }

        await bb.sdk.threads.delete({
          threadId,
          childThreadsConfirmed: true,
        });
        return { exitCode: 0, stdout: `Deleted thread ${threadId}.` };
      } catch (error) {
        return {
          exitCode: 1,
          stderr: error instanceof Error ? error.message : String(error),
        };
      }
    },
  });
}
