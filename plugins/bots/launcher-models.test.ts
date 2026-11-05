import { test } from "node:test";
import assert from "node:assert/strict";
import { readLauncher } from "./launcher-models.ts";

const state = { presets: [], selection: null, names: {} };

test("a Launcher that answers is present with its model state", async () => {
  assert.deepEqual(await readLauncher(async () => state), { status: "present", models: state });
});

test("a 404 from the Launcher's RPC means it is absent", async () => {
  assert.deepEqual(await readLauncher(async () => { throw Object.assign(new Error("not found"), { status: 404 }); }), { status: "absent" });
  assert.deepEqual(await readLauncher(async () => { throw new Error("HTTP 404: plugin not running"); }), { status: "absent" });
});

test("another failure leaves the Launcher present without models", async () => {
  assert.deepEqual(await readLauncher(async () => { throw new Error("HTTP 500"); }), { status: "present", models: null });
});
