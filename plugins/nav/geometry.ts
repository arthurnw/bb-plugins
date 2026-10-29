export type Direction = "left" | "down" | "up" | "right";

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

// Splitters and borders make adjacent panes overlap or gap by a few pixels.
const EDGE_TOLERANCE = 8;

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
  let bestScore: number[] = [];

  boxes.forEach((box, index) => {
    const gap = {
      left: from.left - box.right,
      right: box.left - from.right,
      up: from.top - box.bottom,
      down: box.top - from.bottom,
    }[direction];
    if (gap < -EDGE_TOLERANCE) return;

    // Extents of both boxes on the perpendicular axis.
    const [a0, a1, b0, b1] = horizontal
      ? [from.top, from.bottom, box.top, box.bottom]
      : [from.left, from.right, box.left, box.right];
    const shared = Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
    const offset = shared > 0 ? 0 : Math.abs((a0 + a1) / 2 - (b0 + b1) / 2);

    const score = [shared > 0 ? 0 : 1, Math.max(0, gap) + offset, -shared];
    if (best === -1 || isLess(score, bestScore)) {
      best = index;
      bestScore = score;
    }
  });

  return best;
}

function isLess(a: number[], b: number[]) {
  const i = a.findIndex((value, j) => value !== b[j]);
  return i !== -1 && a[i]! < b[i]!;
}
