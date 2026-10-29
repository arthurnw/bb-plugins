import { test } from "node:test";
import assert from "node:assert/strict";
import { nearestInDirection, nearestTo, rankMatches, type NavItem } from "./nav.ts";

const box = (x: number, y: number) => ({ x, y, width: 100, height: 50 });
const items: NavItem[] = [
  { id: "right", rect: box(200, 0) },
  { id: "right-far-up", rect: box(400, -300) },
  { id: "below", rect: box(0, 100) },
  { id: "left", rect: box(-200, 20) },
];

test("nearestInDirection prefers the card in line over a closer-diagonal one", () => {
  assert.equal(nearestInDirection(box(0, 0), items, "right"), "right");
  assert.equal(nearestInDirection(box(0, 0), items, "down"), "below");
  assert.equal(nearestInDirection(box(0, 0), items, "left"), "left");
  assert.equal(nearestInDirection(box(0, 0), items, "up"), "right-far-up");
});

test("nearestInDirection returns null at the edge and ignores the current card", () => {
  assert.equal(nearestInDirection(box(400, -300), items, "right"), null);
  assert.equal(nearestInDirection(box(0, 0), [{ id: "self", rect: box(0, 0) }], "right"), null);
});

test("nearestInDirection reaches a tall frame beside you before a farther one in line", () => {
  // The project frames from a real canvas: Personal is tall, so its center is far below the others'.
  const frames: NavItem[] = [
    { id: "bb-canvas", rect: { x: 0, y: 0, width: 348, height: 208 } },
    { id: "Personal", rect: { x: 437, y: -1, width: 348, height: 752 } },
    { id: "bb-nav", rect: { x: 888, y: 0, width: 348, height: 208 } },
    { id: "bb-vim", rect: { x: 1332, y: 0, width: 348, height: 208 } },
  ];
  const others = (id: string) => frames.filter((frame) => frame.id !== id);
  const rect = (id: string) => frames.find((frame) => frame.id === id)!.rect;
  assert.equal(nearestInDirection(rect("bb-nav"), others("bb-nav"), "left"), "Personal");
  assert.equal(nearestInDirection(rect("bb-canvas"), others("bb-canvas"), "right"), "Personal");
  assert.equal(nearestInDirection(rect("Personal"), others("Personal"), "right"), "bb-nav");
  assert.equal(nearestInDirection(rect("Personal"), others("Personal"), "left"), "bb-canvas");
});

test("nearestInDirection breaks ties toward the item most in line", () => {
  const column: NavItem[] = [
    { id: "a", rect: box(0, 100) },
    { id: "b", rect: box(30, 100) },
  ];
  assert.equal(nearestInDirection(box(28, 0), column, "down"), "b");
});

test("nearestTo picks the closest center", () => {
  assert.equal(nearestTo({ x: 190, y: 10 }, items), "right");
});

test("rankMatches requires every word and puts title-prefix hits first", () => {
  const rows = [
    { title: "Fix login bug", rest: "web", recency: 1 },
    { title: "Login page redesign", rest: "web", recency: 0 },
    { title: "Unrelated", rest: "login", recency: 5 },
  ];
  const ranked = rankMatches(rows, "login", (row) => row);
  assert.deepEqual(ranked.map((row) => row.title), ["Login page redesign", "Fix login bug", "Unrelated"]);
  assert.deepEqual(rankMatches(rows, "login web", (row) => row).length, 2);
  // An empty query keeps everything, newest first.
  assert.deepEqual(rankMatches(rows, "", (row) => row).map((row) => row.recency), [5, 1, 0]);
});
