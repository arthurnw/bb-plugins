// Pure placement and ordering rules for the Launcher thread list.

export type GroupKey = `bot:${string}` | `section:${string}`;
export type PlacementKey = GroupKey | "pinned" | "threads";

/**
 * The manual order of bot and section groups. Saved keys that still exist keep
 * their place; new bots and then new sections follow in their own order.
 */
export function groupKeys(saved: readonly string[], botIds: readonly string[], sectionIds: readonly string[]): GroupKey[] {
  const defaults: GroupKey[] = [...botIds.map((id) => `bot:${id}` as const), ...sectionIds.map((id) => `section:${id}` as const)];
  const live = new Set<string>(defaults);
  const kept = saved.filter((key, i): key is GroupKey => live.has(key) && saved.indexOf(key) === i);
  const seen = new Set<string>(kept);
  return [...kept, ...defaults.filter((key) => !seen.has(key))];
}

/**
 * Where a thread shows. Pinned threads show only under Pinned, like bb's list.
 * A thread with a bot and a section shows under both.
 */
export function placeThread(thread: { pinned: boolean; botId: string | null; sectionId: string | null }): PlacementKey[] {
  if (thread.pinned) return ["pinned"];
  const keys: PlacementKey[] = [];
  if (thread.botId) keys.push(`bot:${thread.botId}`);
  if (thread.sectionId) keys.push(`section:${thread.sectionId}`);
  return keys.length > 0 ? keys : ["threads"];
}

/** True when making `parentId` the parent of `threadId` would put a thread under its own descendant. */
export function wouldCycle(threadId: string, parentId: string, parentOf: (id: string) => string | null): boolean {
  const seen = new Set<string>();
  for (let id: string | null = parentId; id !== null && !seen.has(id); id = parentOf(id)) {
    if (id === threadId) return true;
    seen.add(id);
  }
  return false;
}

/** Moves `key` to just before `target` (or to the end when `target` is not in the list). */
export function moveBefore<K extends string>(keys: readonly K[], key: K, target: K): K[] {
  if (key === target) return [...keys];
  const rest = keys.filter((item) => item !== key);
  const index = rest.indexOf(target);
  rest.splice(index === -1 ? rest.length : index, 0, key);
  return rest;
}

export interface ListThread { id: string; parentThreadId: string | null; pinned: boolean; botId: string | null; sectionId: string | null }

/**
 * Group membership for every visible thread. A child stays nested under its
 * parent wherever the parent shows; a child with a bot also shows (with its
 * own children) under that bot. A thread whose parent is not visible is a root.
 */
export function groupThreads<T extends ListThread>(threads: readonly T[]): Map<PlacementKey, T[]> {
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  const children = new Map<string, T[]>();
  for (const thread of threads) {
    if (thread.parentThreadId && byId.has(thread.parentThreadId)) children.set(thread.parentThreadId, [...(children.get(thread.parentThreadId) ?? []), thread]);
  }
  const groups = new Map<PlacementKey, Set<T>>();
  const add = (key: PlacementKey, thread: T, seen = new Set<string>()) => {
    if (seen.has(thread.id)) return;
    seen.add(thread.id);
    const members = groups.get(key) ?? new Set<T>();
    groups.set(key, members);
    members.add(thread);
    for (const child of children.get(thread.id) ?? []) add(key, child, seen);
  };
  for (const thread of threads) {
    const isRoot = !thread.parentThreadId || !byId.has(thread.parentThreadId);
    const keys: PlacementKey[] = isRoot ? placeThread(thread)
      : thread.pinned ? ["pinned"]
      : thread.botId ? [`bot:${thread.botId}`] : [];
    for (const key of keys) add(key, thread);
  }
  return new Map([...groups].map(([key, members]) => [key, [...members]]));
}

export type FeedSort = "updated" | "attention" | "created";

/** The stored choice, else the built-in list's chronological sort ("created" or, for anything else, "updated"). */
export function feedSort(stored: string | null, builtIn: string): FeedSort {
  if (stored === "updated" || stored === "attention" || stored === "created") return stored;
  return builtIn === "created" ? "created" : "updated";
}

/** Newest first by the chosen time. `attention` is when the thread last finished a turn or asked for input. */
export function sortFeed<T extends { createdAt: number; updatedAt: number; latestAttentionAt: number }>(threads: readonly T[], sort: FeedSort): T[] {
  const at = (thread: T) => sort === "created" ? thread.createdAt : sort === "attention" ? thread.latestAttentionAt : thread.updatedAt;
  return [...threads].sort((a, b) => at(b) - at(a));
}
