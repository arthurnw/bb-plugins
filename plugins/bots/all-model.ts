// Pure grouping and ordering for the "All" thread list, which mirrors bb's
// built-in list. Bots play no part in grouping here.
import type { ThreadListPrefs } from "./thread-list-prefs.ts";

export interface AllThread {
  id: string;
  projectId: string;
  parentThreadId: string | null;
  sectionId: string | null;
  isPinned: boolean;
  pinnedAt: number | null;
  pinSortKey: string | null;
  isHidden: boolean;
  isArchived: boolean;
  isUnread: boolean;
  status: string;
  displayTitle: string;
  createdAt: number;
  latestAttentionAt: number;
  environment: { id: string | null; name: string | null; branchName: string | null; path: string | null; isWorktree: boolean | null } | null;
  host: { id: string; name: string } | null;
}

export interface AllNode<T> { thread: T; children: AllItem<T>[] }
/** A thread row, or a worktree row holding sibling threads that share one worktree. */
export type AllItem<T> = { kind: "thread"; node: AllNode<T> } | { kind: "environment"; id: string; label: string; nodes: AllNode<T>[] };
export type AllGroupKind = "pinned" | "section" | "project" | "machine" | "threads";
/** `entityId` is the section, project, or machine id; null for Pinned and Threads. */
export interface AllGroup<T> { key: string; kind: AllGroupKind; title: string; entityId: string | null; roots: AllItem<T>[] }

export type AllPrefs = Pick<ThreadListPrefs, "threadLifecycles" | "organizationMode" | "environmentGrouping" | "groupByReadStatus"
  | "chronologicalSort" | "sortDirection" | "sectionOrder" | "manualSectionOrder" | "machineSectionOrder">;
export interface OrganizeInput<T> {
  threads: readonly T[];
  prefs: AllPrefs;
  sections: readonly { id: string; name: string }[];
  projects: readonly { id: string; name: string; isPersonal: boolean }[];
  hosts: readonly { id: string; name: string }[];
  /** The open thread's unread state when it was opened, so reading it does not move it. */
  readOverride?: { threadId: string; isUnread: boolean } | null;
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

const threadItem = <T,>(node: AllNode<T>): AllItem<T> => ({ kind: "thread", node });
const firstThread = <T,>(item: AllItem<T>): T => item.kind === "thread" ? item.node.thread : item.nodes[0]!.thread;
export const itemThreads = <T,>(item: AllItem<T>): AllNode<T>[] => item.kind === "thread" ? [item.node] : item.nodes;

function environmentLabel(environment: NonNullable<AllThread["environment"]>): string {
  return environment.name ?? environment.branchName ?? environment.path?.split(/[\\/]/).filter(Boolean).at(-1) ?? "Worktree";
}

/**
 * Orders sibling nodes. With worktree grouping, two or more siblings in the
 * same worktree become one worktree row, except in the parent's own worktree.
 * `nodeOrder` sorts threads inside a worktree row; `itemOrder` sorts the rows.
 */
export function arrange<T extends AllThread>(nodes: readonly AllNode<T>[], itemOrder: Compare<T>, groupEnvironments: boolean, parentEnvironmentId: string | null = null, nodeOrder = itemOrder): AllItem<T>[] {
  if (!groupEnvironments) return [...nodes].sort((a, b) => itemOrder(a.thread, b.thread)).map(threadItem);
  const byEnvironment = new Map<string, AllNode<T>[]>();
  for (const node of nodes) {
    const environment = node.thread.environment;
    if (!environment?.id || environment.id === parentEnvironmentId || environment.isWorktree !== true) continue;
    byEnvironment.set(environment.id, [...(byEnvironment.get(environment.id) ?? []), node]);
  }
  const items: AllItem<T>[] = [];
  const grouped = new Set<string>();
  for (const [id, members] of byEnvironment) {
    if (members.length < 2) continue;
    grouped.add(id);
    members.sort((a, b) => nodeOrder(a.thread, b.thread));
    items.push({ kind: "environment", id, label: environmentLabel(members[0]!.thread.environment!), nodes: members });
  }
  for (const node of nodes) {
    const id = node.thread.environment?.id;
    if (!id || !grouped.has(id)) items.push(threadItem(node));
  }
  return items.sort((a, b) => itemOrder(firstThread(a), firstThread(b)));
}

/**
 * Trees over `threads`: a thread whose parent is not in the set is a root.
 * Returns the root nodes; children are arranged by `compare`.
 */
export function buildTree<T extends AllThread>(threads: readonly T[], compare: Compare<T>, groupEnvironments = false): AllNode<T>[] {
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
    const kids = (children.get(thread.id) ?? []).filter((kid) => !path.has(kid.id) && !visited.has(kid.id)).map((kid) => node(kid, path));
    return { thread, children: arrange(kids, compare, groupEnvironments, thread.environment?.id ?? null) };
  };
  const roots: AllNode<T>[] = [];
  for (const thread of threads) {
    if ((thread.parentThreadId === null || !ids.has(thread.parentThreadId)) && !visited.has(thread.id)) roots.push(node(thread, new Set()));
  }
  // Threads in a parent cycle have no root; each unvisited one starts its own tree.
  for (const thread of threads) if (!visited.has(thread.id)) roots.push(node(thread, new Set()));
  return roots;
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

/** bb counts only a root thread that is idle or failed and unread toward "By read status". */
const unreadRoot = (thread: AllThread) => thread.parentThreadId === null && (thread.status === "idle" || thread.status === "error") && thread.isUnread;

/** The project a thread files under: its root ancestor's. */
function projectResolver<T extends AllThread>(threads: readonly T[]) {
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  const cache = new Map<string, string>();
  return (thread: T): string => {
    const cached = cache.get(thread.id);
    if (cached !== undefined) return cached;
    const path = [thread];
    const seen = new Set([thread.id]);
    let current = thread;
    let found: string | undefined;
    while (current.parentThreadId !== null) {
      const parent = byId.get(current.parentThreadId);
      if (!parent || seen.has(parent.id)) break;
      found = cache.get(parent.id);
      if (found !== undefined) break;
      seen.add(parent.id);
      path.push(parent);
      current = parent;
    }
    const projectId = found ?? current.projectId;
    for (const item of path) cache.set(item.id, projectId);
    return projectId;
  };
}

export const NO_MACHINE = "no-machine";

/** Whether worktree rows are on: By read status turns them off; "auto" means every organization but Custom. */
export function groupsByEnvironment(prefs: Pick<AllPrefs, "groupByReadStatus" | "environmentGrouping" | "organizationMode">): boolean {
  if (prefs.groupByReadStatus) return false;
  return prefs.environmentGrouping === "auto" ? prefs.organizationMode !== "chronological" : prefs.environmentGrouping;
}

/** Writes for Groups → By environment: turning it on also turns off By read status, as in bb's menu. */
export function toggleEnvironmentGrouping(prefs: Pick<AllPrefs, "groupByReadStatus" | "environmentGrouping" | "organizationMode">): Partial<AllPrefs> {
  return groupsByEnvironment(prefs) ? { environmentGrouping: false } : { environmentGrouping: true, groupByReadStatus: false };
}

export const SORT_FIELDS = [
  { sort: "updated", label: "Updated at", natural: "descending" },
  { sort: "created", label: "Created at", natural: "descending" },
  { sort: "alpha", label: "Alphabetical", natural: "ascending" },
] as const;

/** The direction a sort field shows, resolving "default" to the field's natural direction. */
export function shownDirection(sort: AllPrefs["chronologicalSort"], direction: AllPrefs["sortDirection"]): "ascending" | "descending" {
  if (direction !== "default") return direction;
  return sort === "alpha" ? "ascending" : "descending";
}

/** Picking the current sort field flips its direction; picking another starts at that field's natural direction. */
export function pickSort(prefs: Pick<AllPrefs, "chronologicalSort" | "sortDirection">, sort: (typeof SORT_FIELDS)[number]["sort"]): Pick<AllPrefs, "chronologicalSort" | "sortDirection"> {
  const current = prefs.chronologicalSort === "none" ? "updated" : prefs.chronologicalSort;
  if (current !== sort) return { chronologicalSort: sort, sortDirection: SORT_FIELDS.find((field) => field.sort === sort)!.natural };
  return { chronologicalSort: sort, sortDirection: shownDirection(sort, prefs.sortDirection) === "ascending" ? "descending" : "ascending" };
}

/** Toggles Active or Archived; at least one stays selected. */
export function toggleLifecycle(current: AllPrefs["threadLifecycles"], lifecycle: "active" | "archived"): AllPrefs["threadLifecycles"] {
  if (!current.includes(lifecycle)) return [...current, lifecycle];
  return current.length > 1 ? current.filter((item) => item !== lifecycle) : current;
}

/** Splits groups into those shown and those moved into More. Pinned never hides; unknown keys are ignored. */
export function splitHidden<G extends { key: string }>(groups: readonly G[], hiddenGroups: readonly string[]): { shown: G[]; hidden: G[] } {
  const hidden = new Set(hiddenGroups);
  const isHidden = (group: G) => group.key !== "pinned" && hidden.has(group.key);
  return { shown: groups.filter((group) => !isHidden(group)), hidden: groups.filter(isHidden) };
}

/**
 * Groups in bb's order for the chosen organization:
 * - Custom: Pinned, custom sections, and Threads in `manualSectionOrder`. A
 *   root files under its own section; sections and Threads always show.
 * - By project: Pinned, one group per non-personal project (empty ones too) in
 *   `sectionOrder`, and Threads for the personal project. A thread follows its
 *   root ancestor's project.
 * - By machine: Pinned, one group per known machine (empty ones too), unknown
 *   machines by id, then No machine, in `machineSectionOrder`. Threads shows
 *   only when there is no machine group.
 * Pinned holds every pinned thread and its descendants and shows only when it
 * has threads. A child stays under its parent when both are in the group.
 */
export function organizeAll<T extends AllThread>({ threads, prefs, sections, projects, hosts, readOverride = null }: OrganizeInput<T>): AllGroup<T>[] {
  const visible = threads.filter((thread) => shown(thread, prefs.threadLifecycles));
  const mode = prefs.organizationMode;
  const groupEnvironments = groupsByEnvironment(prefs);
  const sorted = compareThreads<T>(prefs.chronologicalSort, prefs.sortDirection);
  const unread = (thread: T) => unreadRoot(readOverride?.threadId === thread.id ? { ...thread, isUnread: readOverride.isUnread } : thread);
  const compare: Compare<T> = prefs.groupByReadStatus ? (a, b) => Number(unread(b)) - Number(unread(a)) || sorted(a, b) : sorted;
  const rootsOf = (members: readonly T[]) => buildTree(members, compare, groupEnvironments);

  const pinnedIds = effectivelyPinned(visible);
  // bb sorts nested pinned threads by its default order and pinned rows by pin order.
  const pinnedRoots = arrange(buildTree(visible.filter((thread) => pinnedIds.has(thread.id)), byUpdated, groupEnvironments), byPin, groupEnvironments, null, byPin);
  const rest = visible.filter((thread) => !pinnedIds.has(thread.id));
  const groups = new Map<string, AllGroup<T>>();
  if (pinnedRoots.length > 0) groups.set("pinned", { key: "pinned", kind: "pinned", title: "Pinned", entityId: null, roots: pinnedRoots });
  const add = (kind: AllGroupKind, entityId: string, title: string, nodes: readonly AllNode<T>[]) => {
    const key = `${kind}:${entityId}`;
    groups.set(key, { key, kind, title, entityId, roots: arrange(nodes, compare, groupEnvironments) });
    return key;
  };
  const addThreads = (nodes: readonly AllNode<T>[]) => groups.set("threads", { key: "threads", kind: "threads", title: "Threads", entityId: null, roots: arrange(nodes, compare, groupEnvironments) });

  if (mode === "project") {
    const projectOf = projectResolver(visible);
    const named = projects.filter((project) => !project.isPersonal);
    const members = new Map<string, T[]>(named.map((project) => [project.id, []]));
    const loose: T[] = [];
    for (const thread of rest) {
      const bucket = members.get(projectOf(thread));
      if (bucket) bucket.push(thread);
      else loose.push(thread);
    }
    const keys = named.map((project) => add("project", project.id, project.name, rootsOf(members.get(project.id)!)));
    if (loose.length > 0 || named.length === 0) addThreads(rootsOf(loose));
    return topLevelOrder(prefs.sectionOrder, keys, "projects").flatMap((key) => groups.get(key) ?? []);
  }

  if (mode === "machine") {
    const members = new Map<string, T[]>();
    for (const thread of rest) {
      const id = thread.host?.id ?? NO_MACHINE;
      members.set(id, [...(members.get(id) ?? []), thread]);
    }
    const keys: string[] = [];
    for (const host of hosts) {
      keys.push(add("machine", host.id, host.name, rootsOf(members.get(host.id) ?? [])));
      members.delete(host.id);
    }
    const noMachine = members.get(NO_MACHINE);
    members.delete(NO_MACHINE);
    for (const id of [...members.keys()].sort((a, b) => a.localeCompare(b))) keys.push(add("machine", id, "Unknown machine", rootsOf(members.get(id)!)));
    if (noMachine) keys.push(add("machine", NO_MACHINE, "No machine", rootsOf(noMachine)));
    if (keys.length === 0) addThreads(rootsOf(rest));
    return topLevelOrder(prefs.machineSectionOrder, keys, "machines").flatMap((key) => groups.get(key) ?? []);
  }

  const sectionIds = new Set(sections.map((section) => section.id));
  const bySection = new Map<string, AllNode<T>[]>(sections.map((section) => [section.id, []]));
  const loose: AllNode<T>[] = [];
  for (const root of rootsOf(rest)) {
    const sectionId = root.thread.sectionId;
    if (sectionId !== null && sectionIds.has(sectionId)) bySection.get(sectionId)!.push(root);
    else loose.push(root);
  }
  const keys = sections.map((section) => add("section", section.id, section.name, bySection.get(section.id)!));
  addThreads(loose);
  return topLevelOrder(prefs.manualSectionOrder, keys, "sections").flatMap((key) => groups.get(key) ?? []);
}
