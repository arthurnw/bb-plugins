import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PREFS, parsePrefs } from "./thread-list-prefs.ts";

test("a bad value for one key falls back for that key only", () => {
  const prefs = parsePrefs({ organizationMode: "galaxy", chronologicalSort: "alpha", collapsedThreads: "nope", rowActions: ["bb--core/pin"] });
  assert.equal(prefs.organizationMode, DEFAULT_PREFS.organizationMode);
  assert.deepEqual(prefs.collapsedThreads, DEFAULT_PREFS.collapsedThreads);
  assert.equal(prefs.chronologicalSort, "alpha");
  assert.deepEqual(prefs.rowActions, ["bb--core/pin"]);
});

test("missing keys and a non-object read as defaults", () => {
  assert.deepEqual(parsePrefs({}), DEFAULT_PREFS);
  assert.deepEqual(parsePrefs(null), DEFAULT_PREFS);
  assert.equal(parsePrefs({ environmentGrouping: true }).environmentGrouping, true);
  assert.deepEqual(parsePrefs({ threadLifecycles: [] }).threadLifecycles, ["active"]);
});
