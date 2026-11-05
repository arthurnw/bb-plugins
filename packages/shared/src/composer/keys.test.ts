import { test } from "node:test";
import assert from "node:assert/strict";
import { isBackgroundSubmit } from "./keys.ts";

test("Cmd+Enter starts a thread in the background; plain and Shift+Enter do not", () => {
  const enter = { key: "Enter", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, isComposing: false };
  assert.equal(isBackgroundSubmit({ ...enter, metaKey: true }, true), true);
  assert.equal(isBackgroundSubmit({ ...enter, ctrlKey: true }, false), true);
  assert.equal(isBackgroundSubmit({ ...enter, ctrlKey: true }, true), false);
  assert.equal(isBackgroundSubmit(enter, true), false);
  assert.equal(isBackgroundSubmit({ ...enter, metaKey: true, shiftKey: true }, true), false);
  assert.equal(isBackgroundSubmit({ ...enter, metaKey: true, isComposing: true }, true), false);
});
