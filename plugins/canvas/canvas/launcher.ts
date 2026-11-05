import { useCallback, useEffect, useRef, useState } from "react";
import { useSdk } from "@get-bb/plugin-sdk/app";
import { z } from "zod";
import { BOTS_PLUGIN_ID } from "@arthurnw/bb-shared/bots";
import { BOTS_CHANGED_EVENT } from "@arthurnw/bb-shared/events";
import type { LauncherBots } from "./bots.ts";

// Only the fields the canvas draws; the Launcher's bots carry more.
const botsSchema = z.object({
  bots: z.array(z.object({ id: z.string(), name: z.string(), emoji: z.string(), avatar: z.string().nullable() })),
});
const threadBotsSchema = z.object({ threads: z.record(z.string(), z.string()) });

const isNotFound = (error: unknown) =>
  (error as { status?: number } | null)?.status === 404 || /\b404\b/.test(error instanceof Error ? error.message : String(error));

/** The last read, so coming back to the canvas draws the bot grouping at once. */
let last: LauncherBots = { status: "loading" };

/**
 * The Launcher's bots and thread bindings, or "unavailable" when the Launcher
 * plugin isn't installed or running. Rereads when the Launcher reports a
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
