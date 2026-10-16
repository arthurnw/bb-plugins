import { test } from "node:test";
import assert from "node:assert/strict";
import { CARD_H, CARD_W, arrangeGroup, autoLayout, facingSides, frameBounds, placeNew, type LayoutThread } from "./layout.ts";

const thread = (id: string, group: string, extra: Partial<LayoutThread> = {}): LayoutThread => ({
  id,
  group,
  parentThreadId: null,
  sourceThreadId: null,
  createdAt: 0,
  latestAttentionAt: 0,
  ...extra,
});

const overlap = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.abs(a.x - b.x) < CARD_W && Math.abs(a.y - b.y) < CARD_H;

test("autoLayout puts a first child beside its parent and later children below", () => {
  const positions = autoLayout([
    thread("root", "p"),
    thread("a", "p", { parentThreadId: "root", createdAt: 1 }),
    thread("b", "p", { parentThreadId: "root", createdAt: 2 }),
  ]);
  const root = positions.get("root")!;
  const a = positions.get("a")!;
  const b = positions.get("b")!;
  assert.equal(a.y, root.y);
  assert.ok(a.x > root.x);
  assert.equal(b.x, a.x);
  assert.ok(b.y > a.y);
});

test("autoLayout keeps groups apart and never overlaps cards", () => {
  const threads = [
    thread("a1", "a", { latestAttentionAt: 5 }),
    thread("a2", "a"),
    thread("b1", "b", { latestAttentionAt: 9 }),
    thread("b2", "b", { sourceThreadId: "b1" }),
  ];
  const positions = [...autoLayout(threads).values()];
  for (let i = 0; i < positions.length; i += 1) {
    for (let j = i + 1; j < positions.length; j += 1) assert.ok(!overlap(positions[i]!, positions[j]!));
  }
  // The most recently active group comes first.
  assert.ok(autoLayout(threads).get("b1")!.x < autoLayout(threads).get("a1")!.x);
});

test("autoLayout survives parent cycles", () => {
  const positions = autoLayout([
    thread("x", "p", { parentThreadId: "y" }),
    thread("y", "p", { parentThreadId: "x" }),
  ]);
  assert.equal(positions.size, 2);
});

test("placeNew puts a new child beside its parent without overlapping", () => {
  const placed = new Map([
    ["parent", { x: 0, y: 0 }],
    ["other", { x: CARD_W + 56, y: 0 }],
  ]);
  const positions = placeNew(
    [thread("parent", "p"), thread("other", "p"), thread("kid", "p", { parentThreadId: "parent" })],
    placed,
  );
  const kid = positions.get("kid")!;
  assert.equal(kid.x, CARD_W + 56);
  assert.ok(!overlap(kid, placed.get("other")!));
  assert.deepEqual(positions.get("parent"), { x: 0, y: 0 });
});

test("placeNew puts a group's first thread to the right of everything", () => {
  const positions = placeNew([thread("a", "a"), thread("b", "b")], new Map([["a", { x: 0, y: 0 }]]));
  assert.ok(positions.get("b")!.x > CARD_W);
});

test("frameBounds wraps cards with padding and a header", () => {
  const bounds = frameBounds([{ x: 0, y: 0 }, { x: 400, y: 200 }])!;
  assert.ok(bounds.x < 0 && bounds.y < 0);
  assert.ok(bounds.x + bounds.width > 400 + CARD_W);
  assert.ok(bounds.y + bounds.height > 200 + CARD_H);
  assert.equal(frameBounds([]), null);
});

test("facingSides joins the middles of the sides that face each other", () => {
  const card = { x: 400, y: 0, width: 300, height: 100 };
  // A chat down and to the left, as in a real report: top of the chat, bottom of the card.
  const below = facingSides(card, { x: 0, y: 300, width: 400, height: 400 });
  assert.equal(below.from.side, "bottom");
  assert.equal(below.to.side, "top");
  // Each end sits at the middle of its side.
  assert.deepEqual({ x: below.from.x, y: below.from.y }, { x: 550, y: 100 });
  assert.deepEqual({ x: below.to.x, y: below.to.y }, { x: 200, y: 300 });
  // To the right: card's right side to the chat's left, each at its middle.
  const right = facingSides(card, { x: 800, y: -100, width: 400, height: 400 });
  assert.equal(right.from.side, "right");
  assert.equal(right.to.side, "left");
  assert.deepEqual({ x: right.from.x, y: right.from.y }, { x: 700, y: 50 });
  assert.deepEqual({ x: right.to.x, y: right.to.y }, { x: 800, y: 100 });
  // To the left.
  assert.equal(facingSides(card, { x: -500, y: 0, width: 400, height: 400 }).from.side, "left");
});

const five = [
  thread("root", "p", { latestAttentionAt: 9 }),
  thread("kid", "p", { parentThreadId: "root", createdAt: 1 }),
  thread("b", "p", { latestAttentionAt: 5 }),
  thread("c", "p", { latestAttentionAt: 3 }),
  thread("d", "p", { latestAttentionAt: 1 }),
];
const cells = (positions: Map<string, { x: number; y: number }>) => {
  const xs = [...new Set([...positions.values()].map((point) => point.x))].sort((a, b) => a - b);
  const ys = [...new Set([...positions.values()].map((point) => point.y))].sort((a, b) => a - b);
  return Object.fromEntries([...positions].map(([id, point]) => [id, [xs.indexOf(point.x), ys.indexOf(point.y)]]));
};

test("flat styles keep tree order: a child follows its parent", () => {
  assert.deepEqual(cells(autoLayout(five, { style: "column", gridSize: 3 })), {
    root: [0, 0], kid: [0, 1], b: [0, 2], c: [0, 3], d: [0, 4],
  });
  assert.deepEqual(cells(autoLayout(five, { style: "row", gridSize: 3 })), {
    root: [0, 0], kid: [1, 0], b: [2, 0], c: [3, 0], d: [4, 0],
  });
});

test("grid styles wrap at the given number of columns or rows", () => {
  assert.deepEqual(cells(autoLayout(five, { style: "gridColumns", gridSize: 2 })), {
    root: [0, 0], kid: [1, 0], b: [0, 1], c: [1, 1], d: [0, 2],
  });
  assert.deepEqual(cells(autoLayout(five, { style: "gridRows", gridSize: 2 })), {
    root: [0, 0], kid: [0, 1], b: [1, 0], c: [1, 1], d: [2, 0],
  });
});

test("arrangeGroup closes gaps but keeps the frame's top-left in place", () => {
  const current = new Map([
    ["root", { x: 500, y: 300 }],
    ["kid", { x: 900, y: 900 }],
    ["b", { x: 500, y: 1400 }],
  ]);
  const threads = five.slice(0, 3);
  const arranged = arrangeGroup(threads, current, { style: "column", gridSize: 3 });
  assert.deepEqual(arranged.get("root"), { x: 500, y: 300 });
  assert.deepEqual(arranged.get("kid"), { x: 500, y: 300 + CARD_H + 20 });
  assert.deepEqual(arranged.get("b"), { x: 500, y: 300 + 2 * (CARD_H + 20) });
});

test("a tall parent card pushes the next row down by its height", () => {
  const tall = [thread("a", "p", { latestAttentionAt: 2, height: 300 }), thread("b", "p", { latestAttentionAt: 1 })];
  const positions = autoLayout(tall, { style: "column", gridSize: 3 });
  assert.equal(positions.get("b")!.y - positions.get("a")!.y, 300 + 20);
  // In a grid row, the tallest card sets the row's height.
  const grid = [...tall, thread("c", "p")];
  const gridPositions = autoLayout(grid, { style: "gridColumns", gridSize: 2 });
  assert.equal(gridPositions.get("c")!.y - gridPositions.get("a")!.y, 300 + 20);
});

test("placeNew puts a new card below a tall sibling, not over it", () => {
  const threads = [thread("tall", "p", { height: 400 }), thread("new", "p", { createdAt: 5 })];
  const positions = placeNew(threads, new Map([["tall", { x: 0, y: 0 }]]));
  assert.ok(positions.get("new")!.y >= 400);
});

test("frameBounds uses each card's height", () => {
  const bounds = frameBounds([{ x: 0, y: 0, height: 500 }])!;
  assert.ok(bounds.y + bounds.height > 500);
});
