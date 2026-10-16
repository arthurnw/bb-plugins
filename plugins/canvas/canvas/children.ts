// Child threads are folded into their parent's card instead of getting cards
// of their own. A child is any thread whose parent is also on the canvas;
// grandchildren nest under their parent's row.

export interface ForestThread {
  id: string;
  parentThreadId: string | null;
  createdAt: number;
}

export interface ChildRow {
  id: string;
  /** 1 for a direct child, 2 for a grandchild, … */
  depth: number;
}

export interface ChildForest {
  /** Each child's top-level ancestor: the thread whose card shows it. */
  rootOf: ReadonlyMap<string, string>;
  /** A top-level thread's descendants as rows, in tree order (oldest first). */
  rowsOf: ReadonlyMap<string, readonly ChildRow[]>;
}

export const CHILD_ROW_H = 24;
/** The fold line under the rows. */
const CHILD_FOOTER_H = 22;
const CHILD_LIST_PAD = 8;

/** Extra card height for an unfolded list of `rows` children. */
export function childListHeight(rows: number): number {
  return rows === 0 ? 0 : CHILD_LIST_PAD + rows * CHILD_ROW_H + CHILD_FOOTER_H;
}

export function childForest(threads: readonly ForestThread[]): ChildForest {
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  const kids = new Map<string, ForestThread[]>();
  for (const thread of threads) {
    if (thread.parentThreadId === null || !byId.has(thread.parentThreadId)) continue;
    kids.set(thread.parentThreadId, [...(kids.get(thread.parentThreadId) ?? []), thread]);
  }
  for (const list of kids.values()) list.sort((a, b) => a.createdAt - b.createdAt);

  // A thread is top-level when its parent isn't on the canvas. A parent cycle
  // in bad data has no such thread, so its lowest id stands in as the top.
  const isTopLevel = (thread: ForestThread): boolean => {
    const chain = [thread.id];
    let current = thread;
    while (current.parentThreadId !== null && byId.has(current.parentThreadId)) {
      const loopStart = chain.indexOf(current.parentThreadId);
      if (loopStart !== -1) {
        const loop = chain.slice(loopStart);
        return loop.includes(thread.id) && thread.id === [...loop].sort()[0];
      }
      chain.push(current.parentThreadId);
      current = byId.get(current.parentThreadId)!;
    }
    return current.id === thread.id;
  };

  const rootOf = new Map<string, string>();
  const rowsOf = new Map<string, ChildRow[]>();
  const visit = (rootId: string, parentId: string, depth: number, rows: ChildRow[], seen: Set<string>) => {
    for (const kid of kids.get(parentId) ?? []) {
      if (seen.has(kid.id)) continue;
      seen.add(kid.id);
      rootOf.set(kid.id, rootId);
      rows.push({ id: kid.id, depth });
      visit(rootId, kid.id, depth + 1, rows, seen);
    }
  };
  for (const thread of threads) {
    if (!isTopLevel(thread)) continue;
    const rows: ChildRow[] = [];
    visit(thread.id, thread.id, 1, rows, new Set([thread.id]));
    if (rows.length > 0) rowsOf.set(thread.id, rows);
  }
  return { rootOf, rowsOf };
}
