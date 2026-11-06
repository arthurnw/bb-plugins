// bb's built-in thread list (plugin "thread-list") owns these preferences.
// Its RPC is not a public contract, so each key parses on its own and falls
// back to bb's default when its value does not match.
import { useSdk } from "@get-bb/plugin-sdk/app";
import { useEffect, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { z } from "zod";

const keys = z.array(z.string());
const SCHEMAS = {
  showProviderIcons: z.boolean(),
  showRowMetadata: z.boolean(),
  threadLifecycles: z.array(z.enum(["active", "archived"])).min(1).max(2),
  organizationMode: z.enum(["project", "chronological", "machine"]),
  environmentGrouping: z.union([z.literal("auto"), z.boolean()]),
  groupByReadStatus: z.boolean(),
  chronologicalSort: z.enum(["updated", "created", "alpha", "none"]),
  sortDirection: z.enum(["default", "ascending", "descending"]),
  sectionOrder: keys,
  manualSectionOrder: keys,
  machineSectionOrder: keys,
  hiddenGroups: keys,
  rowActions: z.array(z.string()).max(3),
  collapsedSections: keys,
  collapsedProjects: keys,
  collapsedThreads: keys,
  collapsedEnvironments: keys,
  collapsedThreadSections: keys,
  collapsedMachines: keys,
} as const;

export type PrefKey = keyof typeof SCHEMAS;
export type ThreadListPrefs = { [K in PrefKey]: z.infer<(typeof SCHEMAS)[K]> };

/** bb's documented defaults. */
export const DEFAULT_PREFS: ThreadListPrefs = {
  showProviderIcons: true,
  showRowMetadata: false,
  threadLifecycles: ["active"],
  organizationMode: "chronological",
  environmentGrouping: "auto",
  groupByReadStatus: false,
  chronologicalSort: "updated",
  sortDirection: "default",
  sectionOrder: ["pinned", "projects", "threads"],
  manualSectionOrder: ["pinned", "sections", "threads"],
  machineSectionOrder: ["pinned", "machines", "threads"],
  hiddenGroups: [],
  rowActions: ["bb--core/archive"],
  collapsedSections: [],
  collapsedProjects: [],
  collapsedThreads: [],
  collapsedEnvironments: [],
  collapsedThreadSections: [],
  collapsedMachines: [],
};

/** Parses `listPreferences` output key by key; a bad or missing key gets its default. */
export function parsePrefs(raw: unknown): ThreadListPrefs {
  const record = raw !== null && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const result = { ...DEFAULT_PREFS } as Record<PrefKey, unknown>;
  for (const key of Object.keys(SCHEMAS) as PrefKey[]) {
    const parsed = SCHEMAS[key].safeParse(record[key]);
    if (parsed.success) result[key] = parsed.data;
  }
  return result as ThreadListPrefs;
}

type Sdk = ReturnType<typeof useSdk>;
type Status = "loading" | "ready" | "error";
let snapshot: { prefs: ThreadListPrefs; status: Status } = { prefs: DEFAULT_PREFS, status: "loading" };
const listeners = new Set<() => void>();
let currentSdk: Sdk | null = null;
// Bumped by every local write, so a read that started before it cannot undo it.
let writes = 0;

const emit = (next: typeof snapshot) => { snapshot = next; for (const listener of listeners) listener(); };
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

function load() {
  const sdk = currentSdk;
  if (!sdk) return;
  const startedAt = writes;
  sdk.plugins.callRpc({ pluginId: "thread-list", method: "listPreferences", input: null, outputSchema: z.object({ preferences: z.unknown() }) }).then(
    ({ preferences }) => { if (writes === startedAt) emit({ prefs: parsePrefs(preferences), status: "ready" }); },
    () => { if (snapshot.status === "loading") emit({ ...snapshot, status: "error" }); });
}

function set<K extends PrefKey>(key: K, value: ThreadListPrefs[K]) {
  writes += 1;
  emit({ ...snapshot, prefs: { ...snapshot.prefs, [key]: value } });
  const sdk = currentSdk;
  if (!sdk) return;
  sdk.plugins.callRpc({ pluginId: "thread-list", method: "setPreference", input: { key, value, origin: "bots" }, outputSchema: z.object({ key: z.string(), value: z.unknown() }) }).then(
    // bb may normalize the value (for example, dropping duplicates).
    (result) => { const parsed = SCHEMAS[key].safeParse(result.value); if (parsed.success) emit({ ...snapshot, prefs: { ...snapshot.prefs, [key]: parsed.data } }); },
    (error) => { toast.error(`Could not save the thread list setting: ${errorText(error)}`); writes += 1; load(); });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) window.addEventListener("focus", load);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("focus", load);
  };
}

/**
 * The built-in thread list's preferences, shared by every caller. Re-read on
 * mount and when the window regains focus: another plugin cannot subscribe to
 * the thread-list plugin's realtime channel.
 */
export function useThreadListPreferences() {
  const sdk = useSdk();
  currentSdk = sdk;
  const state = useSyncExternalStore(subscribe, () => snapshot);
  useEffect(load, [sdk]);
  return { prefs: state.prefs, status: state.status, set, reload: load };
}
