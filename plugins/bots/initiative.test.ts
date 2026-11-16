import { test } from "node:test";
import assert from "node:assert/strict";
import { nameFromBrief } from "./initiative.ts";

test("names come from the brief's first line, without mentions, and stay unique", () => {
  assert.equal(nameFromBrief("\n# Ship initiative bots\nmore", []), "Ship initiative bots");
  assert.equal(nameFromBrief("Take over @thread:thr_1 please", []), "Take over please");
  assert.equal(nameFromBrief("Ship it", ["ship it"]), "Ship it 2");
  assert.ok(nameFromBrief("word ".repeat(40), []).length <= 36);
  assert.equal(nameFromBrief("@thread:x", []), "Initiative");
});
