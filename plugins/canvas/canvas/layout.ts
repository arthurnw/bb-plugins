// Pure placement logic for the canvas: automatic arrangement, placing new
// threads next to their relatives, and group frame bounds.
import type { ArrangeStyle } from "./shared.ts";

export interface Point {
  x: number;
  y: number;
}
export interface Rect extends Point {
  width: number;
  height: number;
}

/** The thread fields layout reads. */
export interface LayoutThread {
  id: string;
  /** The frame the thread belongs to under the current grouping. */
  group: string;
  parentThreadId: string | null;
  sourceThreadId: string | null;
  createdAt: number;
  latestAttentionAt: number;
  /** Card height when not CARD_H: a parent card listing its child threads. */
  height?: number;
}

export const CARD_W = 300;
export const CARD_H = 116;
const GAP_X = 56;
const GAP_Y = 20;
const FRAME_PAD = 24;
export const FRAME_HEADER = 44;
const FRAME_GAP = 96;
const ROW_MAX_WIDTH = 2600;

/** Parent links within one group, falling back to the fork source. */
function relativeOf(thread: LayoutThread, ids: ReadonlySet<string>): string | null {
  if (thread.parentThreadId !== null && ids.has(thread.parentThreadId)) return thread.parentThreadId;
  if (thread.sourceThreadId !== null && ids.has(thread.sourceThreadId)) return thread.sourceThreadId;
  return null;
}

export interface ArrangeOptions {
  style: ArrangeStyle;
  /** Max columns for gridColumns, max rows for gridRows. */
  gridSize: number;
}

export const DEFAULT_ARRANGE: ArrangeOptions = { style: "tree", gridSize: 3 };

/** Gap between cards in the flat styles, which draw no tree edges between neighbors. */
const FLAT_GAP_X = 24;

/** Cards are a fixed width; a parent card grows taller to list its children. */
const heightOf = (thread: LayoutThread | undefined) => thread?.height ?? CARD_H;

interface Block {
  positions: Map<string, Point>;
  width: number;
  height: number;
}

/** Turns grid cells into positions, sizing each row to its tallest card. */
function placeCells(
  cells: ReadonlyMap<string, { col: number; row: number }>,
  heights: ReadonlyMap<string, number>,
  columnWidth: number,
): Block {
  const rowHeights: number[] = [];
  let cols = 1;
  for (const [id, { col, row }] of cells) {
    cols = Math.max(cols, col + 1);
    rowHeights[row] = Math.max(rowHeights[row] ?? 0, heights.get(id) ?? CARD_H);
  }
  const rowTops: number[] = [];
  let y = 0;
  for (let row = 0; row < rowHeights.length; row += 1) {
    rowTops[row] = y;
    y += (rowHeights[row] ?? 0) + GAP_Y;
  }
  const positions = new Map<string, Point>();
  for (const [id, { col, row }] of cells) positions.set(id, { x: col * columnWidth, y: rowTops[row] ?? 0 });
  return {
    positions,
    width: cols * columnWidth - (columnWidth - CARD_W),
    height: Math.max(CARD_H, y - GAP_Y),
  };
}

/**
 * Lays one group's threads out, relative to the block's top-left. The tree
 * grows right and down: a thread's first child sits beside it, later
 * children stack below. The flat styles keep the tree's reading order, so
 * children still follow their parents.
 */
function layoutGroup(threads: readonly LayoutThread[], options: ArrangeOptions = DEFAULT_ARRANGE): Block {
  const heights = new Map(threads.map((thread) => [thread.id, heightOf(thread)]));
  const tree = treeCells(threads);
  if (options.style === "tree") return placeCells(tree, heights, CARD_W + GAP_X);
  const order = [...tree.keys()];
  const size = options.gridSize;
  const cell = (index: number): { col: number; row: number } => {
    switch (options.style) {
      case "row":
        return { col: index, row: 0 };
      case "gridColumns":
        return { col: index % size, row: Math.floor(index / size) };
      case "gridRows":
        return { col: Math.floor(index / size), row: index % size };
      default:
        return { col: 0, row: index };
    }
  };
  return placeCells(new Map(order.map((id, index) => [id, cell(index)])), heights, CARD_W + FLAT_GAP_X);
}

/** Tree cells in reading order: depth is the column; each leaf ends a row. */
function treeCells(threads: readonly LayoutThread[]): Map<string, { col: number; row: number }> {
  const ids = new Set(threads.map((thread) => thread.id));
  const children = new Map<string, LayoutThread[]>();
  const roots: LayoutThread[] = [];
  for (const thread of threads) {
    const relative = relativeOf(thread, ids);
    if (relative === null || relative === thread.id) roots.push(thread);
    else children.set(relative, [...(children.get(relative) ?? []), thread]);
  }
  roots.sort((a, b) => b.latestAttentionAt - a.latestAttentionAt);
  for (const list of children.values()) list.sort((a, b) => a.createdAt - b.createdAt);

  const cells = new Map<string, { col: number; row: number }>();
  let row = 0;
  const visit = (thread: LayoutThread, depth: number) => {
    if (cells.has(thread.id)) return; // cycles in bad data
    cells.set(thread.id, { col: depth, row });
    const kids = children.get(thread.id) ?? [];
    if (kids.length === 0) {
      row += 1;
      return;
    }
    for (const kid of kids) visit(kid, depth + 1);
  };
  for (const root of roots) visit(root, 0);
  // Threads only reachable through a cycle.
  for (const thread of threads) if (!cells.has(thread.id)) visit(thread, 0);
  return cells;
}

/**
 * Arranges every thread from scratch: one block per group, most recently
 * active group first, wrapped into rows.
 */
export function autoLayout(
  threads: readonly LayoutThread[],
  options: ArrangeOptions = DEFAULT_ARRANGE,
): Map<string, Point> {
  const byGroup = new Map<string, LayoutThread[]>();
  for (const thread of threads) {
    byGroup.set(thread.group, [...(byGroup.get(thread.group) ?? []), thread]);
  }
  const latest = (list: readonly LayoutThread[]) =>
    Math.max(...list.map((thread) => thread.latestAttentionAt));
  const groups = [...byGroup.values()].sort((a, b) => latest(b) - latest(a));

  const result = new Map<string, Point>();
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  for (const list of groups) {
    const block = layoutGroup(list, options);
    const frameWidth = block.width + FRAME_PAD * 2;
    const frameHeight = block.height + FRAME_PAD * 2 + FRAME_HEADER;
    if (x > 0 && x + frameWidth > ROW_MAX_WIDTH) {
      x = 0;
      y += rowHeight + FRAME_GAP;
      rowHeight = 0;
    }
    for (const [id, point] of block.positions) {
      result.set(id, {
        x: x + FRAME_PAD + point.x,
        y: y + FRAME_PAD + FRAME_HEADER + point.y,
      });
    }
    x += frameWidth + FRAME_GAP;
    rowHeight = Math.max(rowHeight, frameHeight);
  }
  return result;
}

/**
 * Rearranges one group's threads in place: the block starts where the
 * group's top-left card is now, so the frame stays put while its gaps close.
 */
export function arrangeGroup(
  threads: readonly LayoutThread[],
  current: ReadonlyMap<string, Point>,
  options: ArrangeOptions = DEFAULT_ARRANGE,
): Map<string, Point> {
  const placed = threads.flatMap((thread) => current.get(thread.id) ?? []);
  const origin = {
    x: placed.length === 0 ? 0 : Math.min(...placed.map((point) => point.x)),
    y: placed.length === 0 ? 0 : Math.min(...placed.map((point) => point.y)),
  };
  const block = layoutGroup(threads, options);
  return new Map([...block.positions].map(([id, point]) => [id, { x: origin.x + point.x, y: origin.y + point.y }]));
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** Moves `start` down until a card of `height` there no longer overlaps `taken`. */
function firstFree(start: Point, height: number, taken: readonly Rect[]): Point {
  const point = { ...start };
  for (let step = 0; step < 500; step += 1) {
    const rect = { ...point, width: CARD_W, height: height + GAP_Y };
    const hit = taken.find((other) => overlaps(rect, other));
    if (hit === undefined) return point;
    point.y = hit.y + hit.height + GAP_Y;
  }
  return point;
}

/**
 * Picks a spot for threads that have no stored position, given the ones that
 * do: right of their parent or fork source, else under the rest of their
 * group, else right of everything for a group's first thread.
 */
export function placeNew(
  threads: readonly LayoutThread[],
  placed: ReadonlyMap<string, Point>,
  obstacles: readonly Rect[] = [],
): Map<string, Point> {
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  const rectOf = (id: string, point: Point): Rect => ({ ...point, width: CARD_W, height: heightOf(byId.get(id)) });
  const positions = new Map(placed);
  const taken: Rect[] = [...obstacles, ...[...positions].map(([id, point]) => rectOf(id, point))];
  const ids = new Set(threads.map((thread) => thread.id));
  // Parents before children so a new child can sit beside a new parent.
  const pending = threads
    .filter((thread) => !positions.has(thread.id))
    .sort((a, b) => a.createdAt - b.createdAt);
  const groupOf = new Map(threads.map((thread) => [thread.id, thread.group]));

  for (const thread of pending) {
    const relative = relativeOf(thread, ids);
    // Only sit beside a relative in the same frame.
    const anchor =
      relative === null || groupOf.get(relative) !== thread.group ? undefined : positions.get(relative);
    let start: Point;
    if (anchor !== undefined) {
      start = { x: anchor.x + CARD_W + GAP_X, y: anchor.y };
    } else {
      const siblings = [...positions].filter(([id]) => groupOf.get(id) === thread.group);
      if (siblings.length > 0) {
        const left = Math.min(...siblings.map(([, point]) => point.x));
        const bottom = Math.max(...siblings.map(([id, point]) => point.y + heightOf(byId.get(id))));
        start = { x: left, y: bottom + GAP_Y };
      } else {
        const right = taken.length === 0 ? 0 : Math.max(...taken.map((rect) => rect.x + rect.width));
        const top = taken.length === 0 ? 0 : Math.min(...taken.map((rect) => rect.y));
        start = {
          x: taken.length === 0 ? 0 : right + FRAME_GAP + FRAME_PAD,
          y: top,
        };
      }
    }
    const point = firstFree(start, heightOf(thread), taken);
    positions.set(thread.id, point);
    taken.push(rectOf(thread.id, point));
  }
  return positions;
}

/** The frame drawn around a group's cards; a card's height defaults to CARD_H. */
export function frameBounds(cards: readonly (Point & { height?: number })[]): Rect | null {
  if (cards.length === 0) return null;
  const left = Math.min(...cards.map((card) => card.x));
  const top = Math.min(...cards.map((card) => card.y));
  const right = Math.max(...cards.map((card) => card.x + CARD_W));
  const bottom = Math.max(...cards.map((card) => card.y + (card.height ?? CARD_H)));
  return {
    x: left - FRAME_PAD,
    y: top - FRAME_PAD - FRAME_HEADER,
    width: right - left + FRAME_PAD * 2,
    height: bottom - top + FRAME_PAD * 2 + FRAME_HEADER,
  };
}

export type Side = "left" | "right" | "top" | "bottom";

/**
 * Where a line between two boxes should attach: the middles of the sides that
 * face each other. Uses left/right when the boxes are further apart
 * horizontally than vertically, top/bottom otherwise.
 */
export function facingSides(a: Rect, b: Rect): { from: Point & { side: Side }; to: Point & { side: Side } } {
  const ca = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
  const cb = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  const gapX = Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width));
  const gapY = Math.max(b.y - (a.y + a.height), a.y - (b.y + b.height));
  if (gapX >= gapY) {
    const bIsRight = cb.x >= ca.x;
    return {
      from: { side: bIsRight ? "right" : "left", x: bIsRight ? a.x + a.width : a.x, y: ca.y },
      to: { side: bIsRight ? "left" : "right", x: bIsRight ? b.x : b.x + b.width, y: cb.y },
    };
  }
  const bIsBelow = cb.y >= ca.y;
  return {
    from: { side: bIsBelow ? "bottom" : "top", x: ca.x, y: bIsBelow ? a.y + a.height : a.y },
    to: { side: bIsBelow ? "top" : "bottom", x: cb.x, y: bIsBelow ? b.y : b.y + b.height },
  };
}
