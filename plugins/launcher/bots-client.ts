// Bots live in the Bots plugin; the Launcher reads them over RPC. A missing or
// disabled Bots plugin answers 404, which shows as "no bots".
import { useSdk } from "@get-bb/plugin-sdk/app";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { z } from "zod";
import { BOTS_PLUGIN_ID, type Bot } from "@arthurnw/bb-shared/bots";
import { botsRpcContract } from "@arthurnw/bb-shared/bots/schema";
import { BOTS_CHANGED_EVENT } from "@arthurnw/bb-shared/events";

type Contract = typeof botsRpcContract;
type Sdk = ReturnType<typeof useSdk>;

function call<M extends "listBots" | "threadBots">(sdk: Sdk, method: M): Promise<z.output<Contract[M]["output"]>> {
  return sdk.plugins.callRpc({ pluginId: BOTS_PLUGIN_ID, method, input: {}, outputSchema: botsRpcContract[method].output as z.ZodType }) as Promise<z.output<Contract[M]["output"]>>;
}

/** Bots and thread bindings, each read fresh. Rejects when Bots is unavailable. */
export function useBotsRpc() {
  const sdk = useSdk();
  return useMemo(() => ({
    listBots: () => call(sdk, "listBots"),
    threadBots: () => call(sdk, "threadBots"),
  }), [sdk]);
}

let bots: readonly Bot[] | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => bots;
const publish = (next: readonly Bot[]) => { bots = next; listeners.forEach((listener) => listener()); };

/** Every bot, kept current by `BotsSync`; null until the first read, empty without Bots. */
export const useBots = () => useSyncExternalStore(subscribe, snapshot, snapshot);

/** Keeps `useBots` current; mount once in an always-present surface. */
export function BotsSync() {
  const rpc = useBotsRpc();
  useEffect(() => {
    const load = () => { rpc.listBots().then(({ bots: list }) => publish(list), () => publish([])); };
    load();
    window.addEventListener(BOTS_CHANGED_EVENT, load);
    window.addEventListener("focus", load);
    return () => { window.removeEventListener(BOTS_CHANGED_EVENT, load); window.removeEventListener("focus", load); };
  }, [rpc]);
  return null;
}
