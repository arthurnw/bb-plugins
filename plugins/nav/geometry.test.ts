import assert from "node:assert/strict";
import { test } from "node:test";
import { pickNeighbor, type Box } from "./geometry.ts";

const box = (left: number, top: number, right: number, bottom: number): Box => ({
  left,
  top,
  right,
  bottom,
});

// Sidebar | thread (composer) | right panel split into terminal over files.
const sidebar = box(0, 0, 250, 1000);
const thread = box(251, 0, 900, 1000);
const terminal = box(901, 0, 1400, 500);
const files = box(901, 501, 1400, 1000);
const all = [sidebar, thread, terminal, files];

test("moves horizontally to the adjacent column", () => {
  assert.equal(pickNeighbor(terminal, all, "left"), 1);
  assert.equal(pickNeighbor(thread, all, "left"), 0);
  assert.equal(pickNeighbor(sidebar, all, "right"), 1);
});

test("moves vertically within a column", () => {
  assert.equal(pickNeighbor(terminal, all, "down"), 3);
  assert.equal(pickNeighbor(files, all, "up"), 2);
});

test("prefers the box with the most perpendicular overlap", () => {
  const lowerThread = box(251, 600, 900, 1000);
  assert.equal(pickNeighbor(lowerThread, [terminal, files], "right"), 1);
});

test("returns -1 at an edge", () => {
  assert.equal(pickNeighbor(sidebar, all, "left"), -1);
  assert.equal(pickNeighbor(terminal, all, "up"), -1);
  assert.equal(pickNeighbor(terminal, all, "right"), -1);
});

test("tolerates small overlaps from splitters", () => {
  const a = box(0, 0, 505, 100);
  const b = box(500, 0, 1000, 100);
  assert.equal(pickNeighbor(a, [b], "right"), 0);
  assert.equal(pickNeighbor(b, [a], "left"), 0);
});

test("falls back to the nearest non-overlapping box", () => {
  const from = box(0, 0, 100, 100);
  const far = box(200, 500, 300, 600);
  const near = box(200, 150, 300, 250);
  assert.equal(pickNeighbor(from, [far, near], "right"), 1);
});

test("breaks edge-distance ties by the larger overlap", () => {
  const from = box(0, 0, 100, 100);
  const small = box(100, 90, 200, 300);
  const large = box(100, 20, 200, 80);
  assert.equal(pickNeighbor(from, [small, large], "right"), 1);
});
