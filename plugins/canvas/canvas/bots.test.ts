import { test } from "node:test";
import assert from "node:assert/strict";
import { availableGroupings, effectiveGrouping, rebound } from "./bots.ts";
import { GROUPINGS } from "./shared.ts";

test("the bot grouping is offered unless the Launcher is unavailable", () => {
  assert.deepEqual(availableGroupings(GROUPINGS, "ready"), ["project", "section", "machine", "bot"]);
  assert.deepEqual(availableGroupings(GROUPINGS, "loading"), ["project", "section", "machine", "bot"]);
  assert.deepEqual(availableGroupings(GROUPINGS, "unavailable"), ["project", "section", "machine"]);
});

test("a stored bot grouping falls back to project without the Launcher", () => {
  assert.equal(effectiveGrouping("bot", "unavailable"), "project");
  assert.equal(effectiveGrouping("bot", "loading"), "bot");
  assert.equal(effectiveGrouping("section", "unavailable"), "section");
});

test("rebound lists threads whose bot was added, changed, or removed", () => {
  const previous = { a: "x", b: "x", c: "y" };
  const next = { a: "x", b: "y", d: "x" };
  assert.deepEqual(rebound(previous, next, ["a", "b", "c", "d", "e"]), ["b", "c", "d"]);
});
