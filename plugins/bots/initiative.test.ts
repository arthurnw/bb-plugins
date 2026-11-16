import { test } from "node:test";
import assert from "node:assert/strict";
import { nameFromBrief, workspaceDirName } from "./initiative.ts";

test("names come from the brief's first line, without mentions, and stay unique", () => {
  assert.equal(nameFromBrief("\n# Ship initiative bots\nmore", []), "Ship initiative bots");
  assert.equal(nameFromBrief("Take over @thread:thr_1 please", []), "Take over please");
  assert.equal(nameFromBrief("Ship it", ["ship it"]), "Ship it 2");
  assert.ok(nameFromBrief("word ".repeat(40), []).length <= 36);
  assert.equal(nameFromBrief("@thread:x", []), "Initiative");
});

test("workspace folders read as the bot's name plus an id prefix", () => {
  assert.equal(workspaceDirName("Ship initiative bots!", "CA3bc7ff-66d0"), "ship-initiative-bots-ca3b");
  assert.equal(workspaceDirName("this is just a test. create a worker to show that it works", "ab12"), "this-is-just-a-test-create-a-worker-to-ab12");
  assert.equal(workspaceDirName("Café ✨", "ab12"), "cafe-ab12");
  assert.equal(workspaceDirName("✨", "ab12"), "bot-ab12");
});
