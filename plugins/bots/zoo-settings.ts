// Per-device zoo settings and the floating card's placement, in localStorage.
// Other windows follow through the `storage` event.
import { useSyncExternalStore } from "react";
import { parseZooPlacement, parseZooSettings, type ZooPlacement, type ZooSettings } from "./zoo-layout";

const SETTINGS_KEY = "bb-bots:zoo";
const PLACEMENT_KEY = "bb-bots:zoo-placement";

const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: unknown) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked */ } };

let settings: ZooSettings = parseZooSettings(read(SETTINGS_KEY));
let placement: ZooPlacement = parseZooPlacement(read(PLACEMENT_KEY));
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

function onStorage(event: StorageEvent) {
  if (event.key === SETTINGS_KEY) settings = parseZooSettings(event.newValue);
  else if (event.key === PLACEMENT_KEY) placement = parseZooPlacement(event.newValue);
  else return;
  notify();
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) removeEventListener("storage", onStorage);
  };
}

export const useZooSettings = () => useSyncExternalStore(subscribe, () => settings, () => settings);
export const useZooPlacement = () => useSyncExternalStore(subscribe, () => placement, () => placement);
export const getZooPlacement = () => placement;

export function setZooSettings(patch: Partial<ZooSettings>) {
  settings = { ...settings, ...patch };
  write(SETTINGS_KEY, settings);
  notify();
}

export function setZooPlacement(patch: Partial<ZooPlacement>) {
  placement = { ...placement, ...patch };
  write(PLACEMENT_KEY, placement);
  notify();
}
