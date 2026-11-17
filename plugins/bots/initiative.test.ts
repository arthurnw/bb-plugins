import { test } from "node:test";
import assert from "node:assert/strict";
import { COORDINATOR_KICKOFF, coordinatorKickoff, nameFromBrief, workspaceDirName } from "./initiative.ts";

test("placeholder names are up to three content words from the brief's first line, in title case, and stay unique", () => {
  assert.equal(nameFromBrief("\n# Ship initiative bots\nmore", []), "Ship Initiative Bots");
  assert.equal(nameFromBrief("this is a test of the bot workflow.", []), "Test Bot Workflow");
  assert.equal(nameFromBrief("Take over @thread:thr_1 please", []), "Take Over");
  assert.equal(nameFromBrief("Ship it", ["ship"]), "Ship 2");
  assert.ok(nameFromBrief("wordy".repeat(20), []).length <= 36);
  assert.equal(nameFromBrief("@thread:x", []), "Initiative");
  assert.equal(nameFromBrief("let's do it", []), "Let's Do It");
});

test("the kickoff asks the coordinator to rename a placeholder name only", () => {
  assert.equal(coordinatorKickoff(null), COORDINATOR_KICKOFF);
  assert.match(coordinatorKickoff("Test Bot Workflow"), /"Test Bot Workflow" is a placeholder[\s\S]*bb bots rename/);
});

test("workspace folders read as the bot's name plus an id prefix", () => {
  assert.equal(workspaceDirName("Ship initiative bots!", "CA3bc7ff-66d0"), "ship-initiative-bots-ca3b");
  assert.equal(workspaceDirName("this is just a test. create a worker to show that it works", "ab12"), "this-is-just-a-test-create-a-worker-to-ab12");
  assert.equal(workspaceDirName("Café ✨", "ab12"), "cafe-ab12");
  assert.equal(workspaceDirName("✨", "ab12"), "bot-ab12");
});
