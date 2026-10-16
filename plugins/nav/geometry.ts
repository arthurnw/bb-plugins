export type Direction = "left" | "down" | "up" | "right";

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

// Splitters and borders make adjacent panes overlap or gap by a few pixels.
const EDGE_TOLERANCE = 8;

function overlap(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

/**
 * Picks the index of the box adjacent to `from` in `direction`, or -1.
 * Boxes overlapping `from` on the perpendicular axis win, nearest edge first,
 * then the largest overlap. Otherwise the nearest box in that direction wins.
 */
export function pickNeighbor(
  from: Box,
  boxes: readonly Box[],
  direction: Direction,
): number {
  const horizontal = direction === "left" || direction === "right";
  let best = -1;
  let bestScore: [number, number, number] | null = null;

  boxes.forEach((box, index) => {
    let gap: number;
    switch (direction) {
      case "left":
        gap = from.left - box.right;
        break;
      case "right":
        gap = box.left - from.right;
        break;
      case "up":
        gap = from.top - box.bottom;
        break;
      case "down":
        gap = box.top - from.bottom;
        break;
    }
    if (gap < -EDGE_TOLERANCE) return;

    const shared = horizontal
      ? overlap(from.top, from.bottom, box.top, box.bottom)
      : overlap(from.left, from.right, box.left, box.right);
    const fromMid = horizontal
      ? (from.top + from.bottom) / 2
      : (from.left + from.right) / 2;
    const boxMid = horizontal
      ? (box.top + box.bottom) / 2
      : (box.left + box.right) / 2;

    const score: [number, number, number] = [
      shared > 0 ? 0 : 1,
      Math.max(0, gap) + (shared > 0 ? 0 : Math.abs(fromMid - boxMid)),
      -shared,
    ];
    if (bestScore === null || compare(score, bestScore) < 0) {
      best = index;
      bestScore = score;
    }
  });

  return best;
}

function compare(a: readonly number[], b: readonly number[]) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i]! - b[i]!;
  }
  return 0;
}
