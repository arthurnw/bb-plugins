import { useSdk } from "@get-bb/plugin-sdk/app";
import { useEffect, useState } from "react";
import { z } from "zod";
import type { ModelState } from "@arthurnw/bb-shared/selection";

const stateSchema = z.custom<ModelState>();

/**
 * The Launcher's model presets, names, and last selection, or null when the
 * Launcher is not installed (or has not answered). Bots reads them only to
 * show model names and to start a bot's model editor from a preset.
 */
export function useLauncherModelState(): ModelState | null {
  const sdk = useSdk();
  const [state, setState] = useState<ModelState | null>(null);
  useEffect(() => {
    let cancelled = false;
    sdk.plugins.callRpc({ pluginId: "launcher", method: "getModelState", input: {}, outputSchema: stateSchema }).then(
      (value) => { if (!cancelled) setState(value); }, () => {});
    return () => { cancelled = true; };
  }, [sdk]);
  return state;
}
