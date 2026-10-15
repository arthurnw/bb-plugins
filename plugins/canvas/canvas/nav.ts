// Spatial keyboard navigation: pick the nearest item in a direction.
import type { Point, Rect } from "./layout.ts";

export type Direction = "left" | "down" | "up" | "right";

export const DIRECTION_KEYS: Record<string, Direction> = { h: "left", j: "down", k: "up", l: "right" };

export interface NavItem {
  id: string;
  rect: Rect;
}

const center = (rect: Rect): Point => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });

/** Gap between two ranges; 0 when they overlap. */
const gap = (startA: number, endA: number, startB: number, endB: number) =>
  Math.max(0, startB - endA, startA - endB);

/**
 * The item nearest `from` in `direction`. An item counts as in that direction
 * when its center is past `from`'s center on that axis. Distance is measured
 * edge to edge: the gap along the axis counts once, and the gap across it
 * (0 when the two overlap on that axis) counts double. Edges rather than
 * centers matter for tall or wide frames, whose centers sit far from a
 * neighbor that lines up with their top.
 */
export function nearestInDirection(from: Rect, items: readonly NavItem[], direction: Direction): string | null {
  const origin = center(from);
  const horizontal = direction === "left" || direction === "right";
  let best: { id: string; score: number; drift: number } | null = null;
  for (const item of items) {
    const point = center(item.rect);
    const ahead =
      direction === "left" ? origin.x - point.x : direction === "right" ? point.x - origin.x : direction === "up" ? origin.y - point.y : point.y - origin.y;
    if (ahead <= 1) continue;
    const { rect } = item;
    const along = horizontal
      ? gap(from.x, from.x + from.width, rect.x, rect.x + rect.width)
      : gap(from.y, from.y + from.height, rect.y, rect.y + rect.height);
    const across = horizontal
      ? gap(from.y, from.y + from.height, rect.y, rect.y + rect.height)
      : gap(from.x, from.x + from.width, rect.x, rect.x + rect.width);
    const score = along + across * 2;
    // Among equal scores, prefer the item most in line with `from`.
    const drift = horizontal ? Math.abs(point.y - origin.y) : Math.abs(point.x - origin.x);
    if (best === null || score < best.score || (score === best.score && drift < best.drift)) {
      best = { id: item.id, score, drift };
    }
  }
  return best?.id ?? null;
}

/** The item whose center is closest to `point`. */
export function nearestTo(point: Point, items: readonly NavItem[]): string | null {
  let best: { id: string; distance: number } | null = null;
  for (const item of items) {
    const itemCenter = center(item.rect);
    const distance = Math.hypot(itemCenter.x - point.x, itemCenter.y - point.y);
    if (best === null || distance < best.distance) best = { id: item.id, distance };
  }
  return best?.id ?? null;
}

/** Ranks picker rows: every query word must appear; title hits rank first, then recency. */
export function rankMatches<T>(
  items: readonly T[],
  query: string,
  fields: (item: T) => { title: string; rest: string; recency: number },
): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const scored: { item: T; score: number; recency: number }[] = [];
  for (const item of items) {
    const { title, rest, recency } = fields(item);
    const lowerTitle = title.toLowerCase();
    const haystack = `${lowerTitle} ${rest.toLowerCase()}`;
    if (!words.every((word) => haystack.includes(word))) continue;
    let score = 0;
    for (const word of words) {
      if (lowerTitle.startsWith(word)) score += 3;
      else if (lowerTitle.includes(` ${word}`)) score += 2;
      else if (lowerTitle.includes(word)) score += 1;
    }
    scored.push({ item, score, recency });
  }
  scored.sort((a, b) => b.score - a.score || b.recency - a.recency);
  return scored.map((entry) => entry.item);
}
