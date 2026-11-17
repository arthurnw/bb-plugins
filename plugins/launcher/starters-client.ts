// The Launcher's Starters for the app: one shared, current list.
import { useRpc } from "@get-bb/plugin-sdk/app";
import { useEffect, useSyncExternalStore } from "react";
import type { quickComposeRpcContract } from "./server";
import type { Starter } from "./starters";

export const STARTERS_CHANGED_EVENT = "bb-launcher:starters-changed";

let starters: readonly Starter[] | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => starters;
export const publishStarters = (next: readonly Starter[]) => {
  starters = next;
  listeners.forEach((listener) => listener());
  window.dispatchEvent(new Event(STARTERS_CHANGED_EVENT));
};

/** Every Starter, kept current by `StartersSync`; null until the first read. */
export const useStarters = () => useSyncExternalStore(subscribe, snapshot, snapshot);

/** Keeps `useStarters` current; mount once in an always-present surface. */
export function StartersSync() {
  const rpc = useRpc<typeof quickComposeRpcContract>();
  useEffect(() => {
    const load = () => { rpc.call("listStarters", {}).then(({ starters: list }) => { starters = list; listeners.forEach((listener) => listener()); }, () => {}); };
    load();
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, [rpc]);
  return null;
}
