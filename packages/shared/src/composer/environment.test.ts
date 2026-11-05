import { test } from "node:test";
import assert from "node:assert/strict";
import { availableEnvironments, environmentFor } from "./environment.ts";

test("without the Launcher only the project checkout is available", () => {
  assert.deepEqual(availableEnvironments(false), ["checkout"]);
  assert.deepEqual(availableEnvironments(true), ["named-worktree", "existing-branch", "checkout"]);
  assert.equal(environmentFor("named-worktree", "h", false), undefined);
  assert.equal(environmentFor("existing-branch", null, false), undefined);
  assert.deepEqual(environmentFor("checkout", "h", false), { type: "host", hostId: "h", workspace: { type: "unmanaged", path: null } });
  assert.equal(environmentFor("checkout", null, false), undefined);
  assert.equal(environmentFor(null, "h", true), undefined);
});

test("with the Launcher a bot's worktree environments seed the providers on the chosen machine", () => {
  assert.deepEqual(environmentFor("named-worktree", "h", true), { type: "provider", environmentProviderId: "named-worktree", inputs: null, machine: { type: "existing", hostId: "h" } });
  assert.deepEqual(environmentFor("existing-branch", null, true), { type: "provider", environmentProviderId: "existing-branch", inputs: null });
});
