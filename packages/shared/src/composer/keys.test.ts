import { test } from "node:test";
import assert from "node:assert/strict";
import { isBackgroundSubmit, projectShortcut } from "./keys.ts";

test("Cmd+Enter starts a thread in the background; plain and Shift+Enter do not", () => {
  const enter = { key: "Enter", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, isComposing: false };
  assert.equal(isBackgroundSubmit({ ...enter, metaKey: true }, true), true);
  assert.equal(isBackgroundSubmit({ ...enter, ctrlKey: true }, false), true);
  assert.equal(isBackgroundSubmit({ ...enter, ctrlKey: true }, true), false);
  assert.equal(isBackgroundSubmit(enter, true), false);
  assert.equal(isBackgroundSubmit({ ...enter, metaKey: true, shiftKey: true }, true), false);
  assert.equal(isBackgroundSubmit({ ...enter, metaKey: true, isComposing: true }, true), false);
});

test("overlay shortcuts respect platform, option-produced characters, and IME", () => {
  const base = { key: "j", code: "KeyJ", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, isComposing: false };
  assert.equal(projectShortcut({ ...base, key: "∆", altKey: true }, true), "next");
  assert.equal(projectShortcut({ ...base, altKey: true, shiftKey: true }, true), "previous");
  assert.equal(projectShortcut({ ...base, metaKey: true, shiftKey: true }, true), "open");
  assert.equal(projectShortcut({ ...base, ctrlKey: true, shiftKey: true }, false), "open");
  assert.equal(projectShortcut({ ...base, ctrlKey: true, shiftKey: true }, true), null);
  assert.equal(projectShortcut({ ...base, altKey: true, isComposing: true }, false), null);
  assert.equal(projectShortcut(base, false), null);
});

test("branch name shortcut matches Mod+Shift+B only", () => {
  const b = { key: "b", code: "KeyB", ctrlKey: false, metaKey: false, altKey: false, shiftKey: true, isComposing: false };
  assert.equal(projectShortcut({ ...b, metaKey: true }, true), "branch-name");
  assert.equal(projectShortcut({ ...b, ctrlKey: true }, false), "branch-name");
  assert.equal(projectShortcut({ ...b, key: "g", code: "KeyG", metaKey: true }, true), "existing-ref");
  assert.equal(projectShortcut({ ...b, ctrlKey: true }, true), null);
  assert.equal(projectShortcut({ ...b, metaKey: true, altKey: true }, true), null);
  assert.equal(projectShortcut({ ...b, metaKey: true, shiftKey: false }, true), null);
});

test("model picker shortcut matches Mod+Shift+M only", () => {
  const m = { key: "m", code: "KeyM", ctrlKey: false, metaKey: false, altKey: false, shiftKey: true, isComposing: false };
  assert.equal(projectShortcut({ ...m, metaKey: true }, true), "model");
  assert.equal(projectShortcut({ ...m, ctrlKey: true }, false), "model");
  assert.equal(projectShortcut({ ...m, ctrlKey: true }, true), null);
  assert.equal(projectShortcut({ ...m, metaKey: true, shiftKey: false }, true), null);
  assert.equal(projectShortcut({ ...m, metaKey: true, altKey: true }, true), null);
});

