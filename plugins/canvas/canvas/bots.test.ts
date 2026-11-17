import { test } from "node:test";
import assert from "node:assert/strict";
import { activeBots, availableGroupings, effectiveGrouping, rebound } from "./bots.ts";
import { GROUPINGS } from "./shared.ts";

test("the bot grouping is offered unless the Bots plugin is unavailable", () => {
  assert.deepEqual(availableGroupings(GROUPINGS, "ready"), ["project", "section", "machine", "bot"]);
  assert.deepEqual(availableGroupings(GROUPINGS, "loading"), ["project", "section", "machine", "bot"]);
  assert.deepEqual(availableGroupings(GROUPINGS, "unavailable"), ["project", "section", "machine"]);
});

test("a stored bot grouping falls back to project without the Bots plugin", () => {
  assert.equal(effectiveGrouping("bot", "unavailable"), "project");
  assert.equal(effectiveGrouping("bot", "loading"), "bot");
  assert.equal(effectiveGrouping("section", "unavailable"), "section");
});

test("rebound lists threads whose bot was added, changed, or removed", () => {
  const previous = { a: "x", b: "x", c: "y" };
  const next = { a: "x", b: "y", d: "x" };
  assert.deepEqual(rebound(previous, next, ["a", "b", "c", "d", "e"]), ["b", "c", "d"]);
});

test("bots whose coordinator is archived or gone drop off", () => {
  const bots = [
    { id: "live", coordinatorThreadId: "c1" },
    { id: "archived", coordinatorThreadId: "c2" },
    { id: "gone", coordinatorThreadId: "c3" },
    { id: "persona", coordinatorThreadId: null },
  ];
  const threads = [{ id: "c1", isArchived: false }, { id: "c2", isArchived: true }];
  assert.deepEqual(activeBots(bots, threads).map((bot) => bot.id), ["live"]);
});
