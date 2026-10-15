import { test } from "node:test";
import assert from "node:assert/strict";
import { CARD_H, CARD_W, autoLayout, frameBounds, placeNew, type LayoutThread } from "./layout.ts";

const thread = (id: string, projectId: string, extra: Partial<LayoutThread> = {}): LayoutThread => ({
  id,
  projectId,
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

test("autoLayout keeps projects apart and never overlaps cards", () => {
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
  // The most recently active project comes first.
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

test("placeNew puts a project's first thread to the right of everything", () => {
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
