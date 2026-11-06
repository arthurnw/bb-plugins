import { useCallback, useEffect, useRef, useState } from "react";
import { useSdk } from "@get-bb/plugin-sdk/app";
import { z } from "zod";
import { setAnimationFetcher } from "@arthurnw/bb-shared/avatars";
import { BOTS_PLUGIN_ID } from "@arthurnw/bb-shared/bots";
import { BOTS_CHANGED_EVENT, openHandoff } from "@arthurnw/bb-shared/events";
import type { LauncherBots } from "./bots.ts";

// Only the fields the canvas draws; the bots carry more.
const botsSchema = z.object({
  bots: z.array(z.object({
    id: z.string(),
    name: z.string(),
    emoji: z.string(),
    avatar: z.string().nullable(),
    // Older Bots versions don't send it.
    avatarAnimation: z.string().nullable().default(null),
  })),
});
const animationSchema = z.object({ animation: z.string().nullable() });
const threadBotsSchema = z.object({ threads: z.record(z.string(), z.string()) });

const isNotFound = (error: unknown) =>
  (error as { status?: number } | null)?.status === 404 || /\b404\b/.test(error instanceof Error ? error.message : String(error));

/** The last read, so coming back to the canvas draws the bot grouping at once. */
let last: LauncherBots = { status: "loading" };

/**
 * The bots and thread bindings from the Bots plugin, or "unavailable" when it
 * isn't installed or running. Rereads when Bots reports a
 * change, when the window regains focus, and when `threadIds` changes (a new
 * thread's binding can land just after the thread appears).
 */
export function useLauncherBots(threadIds: string): LauncherBots {
  const sdk = useSdk();
  const [state, setState] = useState<LauncherBots>(last);
  const generation = useRef(0);
  const load = useCallback(() => {
    const current = ++generation.current;
    const call = <T,>(method: string, outputSchema: z.ZodType<T>) =>
      sdk.plugins.callRpc({ pluginId: BOTS_PLUGIN_ID, method, input: {}, outputSchema });
    Promise.all([call("listBots", botsSchema), call("threadBots", threadBotsSchema)]).then(
      ([{ bots }, { threads }]): LauncherBots => ({ status: "ready", bots, threadBots: threads }),
      // A missing or disabled Launcher answers 404; keep the last read through other failures.
      (error: unknown): LauncherBots =>
        last.status === "ready" && !isNotFound(error) ? last : { status: "unavailable" },
    ).then((next) => {
      if (current !== generation.current) return;
      last = next;
      setState(next);
    });
  }, [sdk]);
  useEffect(() => {
    load();
    // The binding is usually written by then; this catches the ones that aren't.
    const timer = setTimeout(load, 2000);
    return () => clearTimeout(timer);
  }, [load, threadIds]);
  // Each plugin bundles its own copy of the avatar code, so Canvas sets its own fetcher.
  useEffect(
    () =>
      setAnimationFetcher((botId) =>
        sdk.plugins
          .callRpc({ pluginId: BOTS_PLUGIN_ID, method: "getBotAvatarAnimation", input: { botId }, outputSchema: animationSchema })
          .then((result) => result.animation),
      ),
    [sdk],
  );
  useEffect(() => {
    window.addEventListener(BOTS_CHANGED_EVENT, load);
    window.addEventListener("focus", load);
    return () => {
      window.removeEventListener(BOTS_CHANGED_EVENT, load);
      window.removeEventListener("focus", load);
    };
  }, [load]);
  return state;
}

/**
 * Gives a thread to a bot, or takes its bot away with `null`. A thread that has
 * not started is reassigned in place; a started one keeps its session's
 * instructions, so this opens a handoff composer instead. Resolves to which
 * happened.
 */
export async function sendThreadToBot(
  sdk: ReturnType<typeof useSdk>,
  thread: { id: string; projectId: string; status: string },
  botId: string | null,
): Promise<"assigned" | "handoff"> {
  if (thread.status !== "pending") {
    if (!openHandoff({ threadId: thread.id, projectId: thread.projectId, botId })) throw new Error("No composer is available for the handoff.");
    return "handoff";
  }
  await sdk.plugins.callRpc({
    pluginId: BOTS_PLUGIN_ID,
    method: botId ? "assignThread" : "detachThread",
    input: botId ? { threadId: thread.id, botId } : { threadId: thread.id },
    outputSchema: z.object({}).passthrough(),
  });
  return "assigned";
}
