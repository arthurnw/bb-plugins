// Pure grouping and ordering for the "All" thread list, which mirrors bb's
// built-in list. Bots play no part in grouping here.
import type { ThreadListPrefs } from "./thread-list-prefs.ts";

export interface AllThread {
  id: string;
  parentThreadId: string | null;
  sectionId: string | null;
  isPinned: boolean;
  pinnedAt: number | null;
  pinSortKey: string | null;
  isHidden: boolean;
  isArchived: boolean;
  status: string;
  displayTitle: string;
  createdAt: number;
  latestAttentionAt: number;
}

export interface AllNode<T> { thread: T; children: AllNode<T>[] }
export type AllGroupKind = "pinned" | "section" | "threads";
export interface AllGroup<T> { key: string; kind: AllGroupKind; title: string; sectionId: string | null; roots: AllNode<T>[] }

export type AllPrefs = Pick<ThreadListPrefs, "threadLifecycles" | "chronologicalSort" | "sortDirection" | "manualSectionOrder">;
export interface OrganizeInput<T> {
  threads: readonly T[];
  prefs: AllPrefs;
  sections: readonly { id: string; name: string }[];
}

type Compare<T> = (a: T, b: T) => number;
const byString = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const byCreated = <T extends AllThread>(a: T, b: T) => b.createdAt - a.createdAt || byString(a.id, b.id);
const byAttention = <T extends AllThread>(a: T, b: T) => b.latestAttentionAt - a.latestAttentionAt || byCreated(a, b);
const running = (thread: AllThread) => thread.status === "active";

/**
 * bb's "updated" order: running threads first (newest created first), then the
 * rest by when they last finished a turn or asked for input.
 */
export function byUpdated<T extends AllThread>(a: T, b: T): number {
  if (running(a) !== running(b)) return running(a) ? -1 : 1;
  return running(a) ? byCreated(a, b) : byAttention(a, b);
}

/**
 * The comparator for a sort field and direction. `default` keeps each field's
 * natural direction (newest first for dates, A to Z for titles); `none` sorts
 * as `updated`. Running threads stay above the rest in either direction.
 */
export function compareThreads<T extends AllThread>(sort: AllPrefs["chronologicalSort"], direction: AllPrefs["sortDirection"]): Compare<T> {
  const field = sort === "none" ? "updated" : sort;
  const natural = field === "alpha" ? "ascending" : "descending";
  const sign = direction === "default" || direction === natural ? 1 : -1;
  if (field === "alpha") return (a, b) => sign * (a.displayTitle.localeCompare(b.displayTitle) || a.id.localeCompare(b.id));
  if (field === "created") return (a, b) => sign * byCreated(a, b);
  return (a, b) => running(a) !== running(b) ? byUpdated(a, b) : sign * byUpdated(a, b);
}

/** Pinned order: manual pin keys when both have one, else most recently pinned first. */
export function byPin<T extends AllThread>(a: T, b: T): number {
  if (a.pinSortKey !== null && b.pinSortKey !== null) {
    const keyed = byString(a.pinSortKey, b.pinSortKey);
    if (keyed !== 0) return keyed;
  }
  return (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0) || byCreated(a, b);
}

/** Trees over `threads`: a thread whose parent is not in the set is a root. Siblings sort by `compare`. */
export function buildTree<T extends AllThread>(threads: readonly T[], compare: Compare<T>): AllNode<T>[] {
  const ids = new Set(threads.map((thread) => thread.id));
  const children = new Map<string, T[]>();
  for (const thread of threads) {
    const parent = thread.parentThreadId;
    if (parent !== null && ids.has(parent)) children.set(parent, [...(children.get(parent) ?? []), thread]);
  }
  const visited = new Set<string>();
  const node = (thread: T, ancestors: ReadonlySet<string>): AllNode<T> => {
    visited.add(thread.id);
    const path = new Set(ancestors).add(thread.id);
    const kids = (children.get(thread.id) ?? []).filter((kid) => !path.has(kid.id) && !visited.has(kid.id)).sort(compare);
    return { thread, children: kids.map((kid) => node(kid, path)) };
  };
  const roots: AllNode<T>[] = [];
  for (const thread of threads) {
    if ((thread.parentThreadId === null || !ids.has(thread.parentThreadId)) && !visited.has(thread.id)) roots.push(node(thread, new Set()));
  }
  // Threads in a parent cycle have no root; each unvisited one starts its own tree.
  for (const thread of threads) if (!visited.has(thread.id)) roots.push(node(thread, new Set()));
  return roots.sort((a, b) => compare(a.thread, b.thread));
}

/** Pinned threads and every descendant of one. */
export function effectivelyPinned<T extends AllThread>(threads: readonly T[]): Set<string> {
  const children = new Map<string, T[]>();
  for (const thread of threads) {
    if (thread.parentThreadId !== null) children.set(thread.parentThreadId, [...(children.get(thread.parentThreadId) ?? []), thread]);
  }
  const pinned = new Set<string>();
  const visit = (id: string) => {
    for (const kid of children.get(id) ?? []) {
      if (pinned.has(kid.id)) continue;
      pinned.add(kid.id);
      visit(kid.id);
    }
  };
  for (const thread of threads) {
    if (!isPinned(thread) || pinned.has(thread.id)) continue;
    pinned.add(thread.id);
    visit(thread.id);
  }
  return pinned;
}
const isPinned = (thread: AllThread) => thread.isPinned || thread.pinnedAt !== null;

/**
 * The top-level order from a stored order preference. `anchor` (such as
 * "sections") expands to every entity key in order; unknown keys drop out;
 * Pinned comes first and Threads last unless stored elsewhere; entities the
 * stored order misses go after the last placed entity, else before Threads.
 */
export function topLevelOrder(stored: readonly string[], entityKeys: readonly string[], anchor: string): string[] {
  const allowed = new Set(["pinned", ...entityKeys, "threads"]);
  const entities = new Set(entityKeys);
  const placed = new Set<string>();
  const order: string[] = [];
  let anchored = false;
  const place = (key: string) => { if (allowed.has(key) && !placed.has(key)) { placed.add(key); order.push(key); } };
  for (const key of stored) {
    if (key === anchor) { anchored = true; entityKeys.forEach(place); } else place(key);
  }
  if (!placed.has("pinned")) { order.unshift("pinned"); placed.add("pinned"); }
  const missing = entityKeys.filter((key) => !placed.has(key));
  if (missing.length > 0) {
    const lastEntity = order.reduce((last, key, index) => entities.has(key) ? index : last, -1);
    const threads = order.indexOf("threads");
    const at = lastEntity >= 0 ? lastEntity + 1 : threads >= 0 || anchored ? Math.max(threads, 0) : order.length;
    order.splice(at, 0, ...missing);
  }
  if (!placed.has("threads")) order.push("threads");
  return order;
}

const shown = (thread: AllThread, lifecycles: AllPrefs["threadLifecycles"]) =>
  !thread.isHidden && lifecycles.includes(thread.isArchived ? "archived" : "active");

/**
 * Groups for the Custom organization: Pinned (with every descendant of a
 * pinned thread), custom sections, and Threads, in `manualSectionOrder`. A
 * child stays under its parent; a root files under its own section. Pinned
 * shows only when it has threads; sections and Threads always show.
 */
export function organizeAll<T extends AllThread>({ threads, prefs, sections }: OrganizeInput<T>): AllGroup<T>[] {
  const visible = threads.filter((thread) => shown(thread, prefs.threadLifecycles));
  const compare = compareThreads<T>(prefs.chronologicalSort, prefs.sortDirection);
  const pinnedIds = effectivelyPinned(visible);
  // bb sorts nested pinned threads by its default order and pinned roots by pin order.
  const pinnedRoots = buildTree(visible.filter((thread) => pinnedIds.has(thread.id)), byUpdated).sort((a, b) => byPin(a.thread, b.thread));
  const sectionIds = new Set(sections.map((section) => section.id));
  const bySection = new Map<string, AllNode<T>[]>(sections.map((section) => [section.id, []]));
  const loose: AllNode<T>[] = [];
  for (const root of buildTree(visible.filter((thread) => !pinnedIds.has(thread.id)), compare)) {
    const sectionId = root.thread.sectionId;
    if (sectionId !== null && sectionIds.has(sectionId)) bySection.get(sectionId)!.push(root);
    else loose.push(root);
  }
  const groups = new Map<string, AllGroup<T>>();
  if (pinnedRoots.length > 0) groups.set("pinned", { key: "pinned", kind: "pinned", title: "Pinned", sectionId: null, roots: pinnedRoots });
  for (const section of sections) {
    groups.set(`section:${section.id}`, { key: `section:${section.id}`, kind: "section", title: section.name, sectionId: section.id, roots: bySection.get(section.id)! });
  }
  groups.set("threads", { key: "threads", kind: "threads", title: "Threads", sectionId: null, roots: loose });
  const order = topLevelOrder(prefs.manualSectionOrder, sections.map((section) => `section:${section.id}`), "sections");
  return order.flatMap((key) => groups.get(key) ?? []);
}
