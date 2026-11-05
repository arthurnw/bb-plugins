import { useSdk } from "@get-bb/plugin-sdk/app";
import { useEffect, useState } from "react";
import { z } from "zod";
import type { ModelState } from "@arthurnw/bb-shared/selection";

const stateSchema = z.custom<ModelState>();

/**
 * The Launcher plugin as Bots sees it. "absent" means its RPC answered 404, so
 * it is not installed or is disabled. Presets and the Named worktree and Existing
 * branch environments come from the Launcher; Bots works without them.
 */
export type LauncherStatus =
  | { status: "loading" | "absent" }
  | { status: "present"; models: ModelState | null };

/** The server answers 404 for an unknown plugin and 503 ("not running (status: disabled)") for one that is disabled or stopped. */
export const isAbsent = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const status = (error as { status?: number } | null)?.status;
  return status === 404 || status === 503 || /\b(404|503)\b|not running|not found|disabled/i.test(message);
};

/**
 * Reads the Launcher's state, or maps its failure; pure so tests can simulate
 * a missing Launcher. A failure that does not say the plugin is gone (a
 * timeout, a 500) keeps the previous answer, and "absent" when there is none:
 * offering worktree environments that may not exist is worse than hiding them.
 */
export async function readLauncher(read: () => Promise<ModelState>, previous: LauncherStatus = { status: "absent" }): Promise<LauncherStatus> {
  try { return { status: "present", models: await read() }; }
  catch (error) {
    if (isAbsent(error)) return { status: "absent" };
    return previous.status === "loading" ? { status: "absent" } : previous;
  }
}

let last: LauncherStatus = { status: "loading" };

/** Rereads when the window regains focus, because the Launcher can be enabled or disabled at any time. */
export function useLauncher(): LauncherStatus {
  const sdk = useSdk();
  const [state, setState] = useState<LauncherStatus>(last);
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void readLauncher(() => sdk.plugins.callRpc({ pluginId: "launcher", method: "getModelState", input: {}, outputSchema: stateSchema }), last).then((next) => {
        if (cancelled) return;
        last = next;
        setState(next);
      });
    };
    load();
    window.addEventListener("focus", load);
    return () => { cancelled = true; window.removeEventListener("focus", load); };
  }, [sdk]);
  return state;
}

/** The Launcher's presets, names, and last selection, or null without the Launcher. */
export const useLauncherModelState = (): ModelState | null => {
  const launcher = useLauncher();
  return launcher.status === "present" ? launcher.models : null;
};
