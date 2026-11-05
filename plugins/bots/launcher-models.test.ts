import { test } from "node:test";
import assert from "node:assert/strict";
import { readLauncher } from "./launcher-models.ts";

const state = { presets: [], selection: null, names: {} };
const present = { status: "present", models: state } as const;

test("a Launcher that answers is present with its model state", async () => {
  assert.deepEqual(await readLauncher(async () => state), present);
});

test("a disabled or missing Launcher is absent: 404, and the 503 a disabled plugin returns", async () => {
  assert.deepEqual(await readLauncher(async () => { throw Object.assign(new Error("not found"), { status: 404 }); }), { status: "absent" });
  assert.deepEqual(await readLauncher(async () => { throw new Error("HTTP 404: plugin not found"); }), { status: "absent" });
  assert.deepEqual(await readLauncher(async () => { throw new Error('HTTP 503: plugin "launcher" is not running (status: disabled)'); }), { status: "absent" });
  assert.deepEqual(await readLauncher(async () => { throw Object.assign(new Error("x"), { status: 503 }); }, present), { status: "absent" });
});

test("another failure keeps the last answer, and is absent when there is none", async () => {
  assert.deepEqual(await readLauncher(async () => { throw new Error("HTTP 500: boom"); }, present), present);
  assert.deepEqual(await readLauncher(async () => { throw new Error("HTTP 500: boom"); }), { status: "absent" });
  assert.deepEqual(await readLauncher(async () => { throw new Error("timeout"); }, { status: "loading" }), { status: "absent" });
});
