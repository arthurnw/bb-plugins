// Pure drop rules for the "All" list, following bb's built-in list: what a
// thread dropped on a row, a group, or a row's edge does, and how dragging one
// group header onto another reorders the top level.
import { itemThreads, topLevelOrder, type AllGroup, type AllItem, type AllPrefs, type AllThread } from "./all-model.ts";

export type DropAction =
  | { kind: "update"; threadId: string; parentThreadId?: string | null; sectionId?: string | null }
  | { kind: "pin"; threadId: string }
  | { kind: "unpin"; threadId: string }
  | { kind: "reorderPinned"; threadId: string; previousThreadId: string | null; nextThreadId: string | null };
export type DropPlan = { kind: "apply"; actions: DropAction[] } | { kind: "unchanged" } | { kind: "rejected"; reason: string };

interface Placement { groupKey: string; displayedParent: string | null; descendants: Set<string> }

/** Where each thread shows: its group, the row it shows under, and every row below it. */
export function placements<T extends AllThread>(groups: readonly AllGroup<T>[]): Map<string, Placement> {
  const result = new Map<string, Placement>();
  const visit = (items: readonly AllItem<T>[], groupKey: string, parent: string | null): string[] => {
    const seen: string[] = [];
    for (const item of items) {
      for (const node of itemThreads(item)) {
        const below = visit(node.children, groupKey, node.thread.id);
        result.set(node.thread.id, { groupKey, displayedParent: parent, descendants: new Set(below) });
        seen.push(node.thread.id, ...below);
      }
    }
    return seen;
  };
  for (const group of groups) visit(group.roots, group.key, null);
  return result;
}

const isPinned = (thread: AllThread) => thread.isPinned || thread.pinnedAt !== null;

export interface DropInput<T extends AllThread> {
  thread: T;
  /** `thread:<id>` to nest, a group key, or `edge:before:<id>` / `edge:after:<id>` for a row's top or bottom edge. */
  target: string;
  groups: readonly AllGroup<T>[];
  threadsById: ReadonlyMap<string, T>;
  mode: AllPrefs["organizationMode"];
  personalProjectId: string | null;
}

/**
 * The writes for dropping one thread:
 * - On a row: nest under it, unpinning the thread. In Custom it takes the
 *   group's section (or, in Pinned, the new parent's section).
 * - On a group: leave its parent and, in Custom, take the group's section
 *   (none for Threads). A project group (and Threads, the personal project's
 *   group) takes only that project's threads. Pinned pins it.
 * - On a row's edge: a pinned thread moves within Pinned; otherwise the same
 *   as dropping on the row's group.
 */
export function planDrop<T extends AllThread>({ thread, target, groups, threadsById, mode, personalProjectId }: DropInput<T>): DropPlan {
  const where = placements(groups);
  const mine = where.get(thread.id);
  const nested = mine?.displayedParent != null;
  const unpin: DropAction[] = isPinned(thread) ? [{ kind: "unpin", threadId: thread.id }] : [];
  const sectionOfGroup = (key: string): string | null | undefined => {
    if (mode !== "chronological") return undefined;
    if (key === "threads") return null;
    return key.startsWith("section:") ? key.slice("section:".length) : undefined;
  };

  if (target.startsWith("thread:")) {
    const parentId = target.slice("thread:".length);
    const parent = threadsById.get(parentId);
    const at = where.get(parentId);
    if (!parent || !at) return { kind: "unchanged" };
    if (parentId === thread.id || mine?.descendants.has(parentId) || ownAncestor(thread.id, parentId, threadsById)) return { kind: "rejected", reason: "A thread cannot go under its own child." };
    if (mine?.displayedParent === parentId) return { kind: "rejected", reason: "already-child" };
    const sectionId = mode !== "chronological" ? undefined : at.groupKey === "pinned" ? parent.sectionId : sectionOfGroup(at.groupKey);
    return { kind: "apply", actions: [...unpin, { kind: "update", threadId: thread.id, parentThreadId: parentId, ...(sectionId === undefined ? {} : { sectionId }) }] };
  }

  let groupKey = target;
  if (target.startsWith("edge:")) {
    const [, edge, rowId] = target.split(":") as [string, "before" | "after", string];
    const at = where.get(rowId);
    if (!at) return { kind: "unchanged" };
    if (at.groupKey === "pinned" && at.displayedParent === null && mine?.groupKey === "pinned" && !nested && isPinned(thread)) {
      return reorderPinned(thread.id, rowId, edge, groups);
    }
    groupKey = at.groupKey;
  }

  if (groupKey === "pinned") {
    const actions: DropAction[] = [];
    if (nested) actions.push({ kind: "update", threadId: thread.id, parentThreadId: null });
    if (!isPinned(thread)) actions.push({ kind: "pin", threadId: thread.id });
    return actions.length > 0 ? { kind: "apply", actions } : { kind: "unchanged" };
  }
  const projectOfGroup = groupKey.startsWith("project:") ? groupKey.slice("project:".length) : mode === "project" && groupKey === "threads" ? personalProjectId : undefined;
  if (projectOfGroup !== undefined && thread.projectId !== projectOfGroup) return { kind: "rejected", reason: "A thread cannot move to another project." };
  const sectionId = sectionOfGroup(groupKey);
  const updates: DropAction[] = nested
    ? [{ kind: "update", threadId: thread.id, parentThreadId: null, ...(sectionId === undefined ? {} : { sectionId }) }]
    : sectionId !== undefined && thread.sectionId !== sectionId ? [{ kind: "update", threadId: thread.id, sectionId }] : [];
  const actions = [...unpin, ...updates];
  return actions.length > 0 ? { kind: "apply", actions } : { kind: "unchanged" };
}

function ownAncestor<T extends AllThread>(threadId: string, parentId: string, threadsById: ReadonlyMap<string, T>): boolean {
  const seen = new Set<string>();
  for (let id: string | null = parentId; id !== null && !seen.has(id); id = threadsById.get(id)?.parentThreadId ?? null) {
    if (id === threadId) return true;
    seen.add(id);
  }
  return false;
}

function reorderPinned<T extends AllThread>(threadId: string, rowId: string, edge: "before" | "after", groups: readonly AllGroup<T>[]): DropPlan {
  if (rowId === threadId) return { kind: "unchanged" };
  const pinned = groups.find((group) => group.key === "pinned");
  const order = (pinned?.roots ?? []).flatMap((item) => itemThreads(item).map((node) => node.thread.id)).filter((id) => id !== threadId);
  const at = order.indexOf(rowId) + (edge === "after" ? 1 : 0);
  const previousThreadId = order[at - 1] ?? null;
  const nextThreadId = order[at] ?? null;
  const current = (pinned?.roots ?? []).flatMap((item) => itemThreads(item).map((node) => node.thread.id));
  const index = current.indexOf(threadId);
  if ((current[index - 1] ?? null) === previousThreadId && (current[index + 1] ?? null) === nextThreadId) return { kind: "unchanged" };
  return { kind: "apply", actions: [{ kind: "reorderPinned", threadId, previousThreadId, nextThreadId }] };
}

export const ORDER_PREF = { chronological: "manualSectionOrder", project: "sectionOrder", machine: "machineSectionOrder" } as const;
const ANCHOR = { chronological: "sections", project: "projects", machine: "machines" } as const;
const ENTITY = { chronological: "section:", project: "project:", machine: "machine:" } as const;

/**
 * The new top-level order after dropping group `moved` on group `target`: it
 * takes the target's place, landing after it when moving down. Null when
 * nothing changes.
 */
export function reorderGroups(prefs: AllPrefs, groupKeys: readonly string[], moved: string, target: string): { key: (typeof ORDER_PREF)[keyof typeof ORDER_PREF]; value: string[] } | null {
  const mode = prefs.organizationMode;
  const key = ORDER_PREF[mode];
  const entities = groupKeys.filter((group) => group.startsWith(ENTITY[mode]));
  const order = topLevelOrder(prefs[key], entities, ANCHOR[mode]);
  const from = order.indexOf(moved);
  const to = order.indexOf(target);
  if (from === -1 || to === -1 || from === to) return null;
  const next = order.filter((item) => item !== moved);
  next.splice(next.indexOf(target) + (from < to ? 1 : 0), 0, moved);
  return { key, value: next };
}
