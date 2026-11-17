import { test } from "node:test";
import assert from "node:assert/strict";
import { importPersonaBots, starterIdIn, starterInstructions, type Starter } from "./starters.ts";
import { startersSchema } from "./starters-schema.ts";
import type { Bot } from "@arthurnw/bb-shared/bots";

const bot = (id: string, name: string, extra: Partial<Bot> = {}) => ({
  id, name, emoji: "🛠", instructions: `Be ${name}.`, starterPrompt: "/skill:x", model: null, permissionMode: "auto", environment: "named-worktree",
  projectId: "proj_1", coordinatorThreadId: null, ...extra,
}) as unknown as Bot;

test("persona bots become Starters once; initiative bots are skipped", () => {
  let n = 0;
  const id = () => `s${++n}`;
  const first = importPersonaBots([], [bot("b1", "Engineer"), bot("b2", "Coord", { coordinatorThreadId: "thr_c" })], id)!;
  assert.equal(first.length, 1);
  assert.deepEqual(first[0], { id: "s1", importedFrom: "b1", name: "Engineer", emoji: "🛠", model: null, starterPrompt: "/skill:x",
    instructions: "Be Engineer.", projectId: "proj_1", environment: "named-worktree", permissionMode: "auto" });
  assert.equal(importPersonaBots(first, [bot("b1", "Engineer")], id), null);
  const second = importPersonaBots(first, [bot("b1", "Engineer"), bot("b3", "engineer")], id)!;
  assert.equal(second[1]!.name, "engineer 2");
  assert.doesNotThrow(() => startersSchema.parse(second));
});

test("Starter instructions are added only when there are some", () => {
  assert.equal(starterInstructions({ name: "Quick", instructions: "  " }), null);
  assert.match(starterInstructions({ name: "Eng\nineer", instructions: "Test first." })!, /^# Starter: Eng ineer[\s\S]*## Starter instructions\nTest first\.$/);
});

test("a submission names its Starter", () => {
  assert.equal(starterIdIn({ starterId: "s1" }), "s1");
  assert.equal(starterIdIn({ starterId: "" }), null);
  assert.equal(starterIdIn("s1"), null);
  assert.equal(starterIdIn(null), null);
});

test("Starter names are unique", () => {
  const s = (id: string, name: string): Starter => ({ id, importedFrom: null, name, emoji: "", model: null, starterPrompt: "", instructions: "",
    projectId: null, environment: null, permissionMode: null });
  assert.throws(() => startersSchema.parse([s("a", "Eng"), s("b", "eng")]), /Two starters/);
});
