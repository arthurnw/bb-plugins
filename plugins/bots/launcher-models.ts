import { useSdk } from "@get-bb/plugin-sdk/app";
import { useEffect, useState } from "react";
import { z } from "zod";
import type { ModelState } from "@arthurnw/bb-shared/selection";

const stateSchema = z.custom<ModelState>();

/**
 * The Launcher plugin as Bots sees it. "absent" means its RPC answered 404, so
 * it is not installed or is disabled; any other failure still counts as
 * installed, with no model state. Presets and the Named worktree and Existing
 * branch environments come from the Launcher; Bots works without them.
 */
export type LauncherStatus =
  | { status: "loading" | "absent" }
  | { status: "present"; models: ModelState | null };

export const isNotFound = (error: unknown) =>
  (error as { status?: number } | null)?.status === 404 || /\b404\b/.test(error instanceof Error ? error.message : String(error));

/** Reads the Launcher's state, or maps its failure; pure so tests can simulate a missing Launcher. */
export async function readLauncher(read: () => Promise<ModelState>): Promise<LauncherStatus> {
  try { return { status: "present", models: await read() }; }
  catch (error) { return isNotFound(error) ? { status: "absent" } : { status: "present", models: null }; }
}

let last: LauncherStatus = { status: "loading" };

/** Rereads when the window regains focus, because the Launcher can be enabled or disabled at any time. */
export function useLauncher(): LauncherStatus {
  const sdk = useSdk();
  const [state, setState] = useState<LauncherStatus>(last);
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void readLauncher(() => sdk.plugins.callRpc({ pluginId: "launcher", method: "getModelState", input: {}, outputSchema: stateSchema })).then((next) => {
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
