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
  const onCanvas = new Set(threads.map((thread) => thread.id));
  const kids = new Map<string, ForestThread[]>();
  for (const thread of threads) {
    if (thread.parentThreadId === null || !onCanvas.has(thread.parentThreadId)) continue;
    kids.set(thread.parentThreadId, [...(kids.get(thread.parentThreadId) ?? []), thread]);
  }
  for (const list of kids.values()) list.sort((a, b) => a.createdAt - b.createdAt);

  const rootOf = new Map<string, string>();
  const rowsOf = new Map<string, ChildRow[]>();
  const visit = (rootId: string, parentId: string, depth: number, rows: ChildRow[]) => {
    for (const kid of kids.get(parentId) ?? []) {
      rootOf.set(kid.id, rootId);
      rows.push({ id: kid.id, depth });
      visit(rootId, kid.id, depth + 1, rows);
    }
  };
  // A thread is top-level when its parent isn't on the canvas.
  for (const thread of threads) {
    if (thread.parentThreadId !== null && onCanvas.has(thread.parentThreadId)) continue;
    const rows: ChildRow[] = [];
    visit(thread.id, thread.id, 1, rows);
    if (rows.length > 0) rowsOf.set(thread.id, rows);
  }
  return { rootOf, rowsOf };
}
