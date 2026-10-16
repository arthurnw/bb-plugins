import assert from "node:assert/strict";
import { test } from "node:test";
import { cycle, filter, PERSONAL_LABEL, toOptions } from "./projects.ts";

const options = toOptions([
  { id: "p", name: "Personal", kind: "personal" },
  { id: "a", name: "web", kind: "repository" },
  { id: "b", name: "dbt_models", kind: "repository" },
  { id: "c", name: "bb-canvas", kind: "repository" },
]);

test("toOptions moves the personal project last", () => {
  assert.deepEqual(
    options.map((o) => o.name),
    ["web", "dbt_models", "bb-canvas", PERSONAL_LABEL],
  );
});

test("cycle wraps both ways", () => {
  assert.equal(cycle(options, "a", 1)?.id, "b");
  assert.equal(cycle(options, "p", 1)?.id, "a");
  assert.equal(cycle(options, "a", -1)?.id, "p");
});

test("cycle starts at an end when the current project is unknown", () => {
  assert.equal(cycle(options, null, 1)?.id, "a");
  assert.equal(cycle(options, "missing", -1)?.id, "p");
  assert.equal(cycle([], "a", 1), null);
});

test("filter ranks prefix, substring, then subsequence", () => {
  assert.deepEqual(
    filter(options, "b").map((o) => o.id),
    ["c", "a", "b"],
  );
  assert.deepEqual(
    filter(options, "dm").map((o) => o.id),
    ["b"],
  );
  assert.equal(filter(options, "  ").length, 4);
  assert.equal(filter(options, "zzz").length, 0);
});
