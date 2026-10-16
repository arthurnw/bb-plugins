import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { quickCompose } from "./overlay-store.ts";
import { projectShortcut } from "./overlay-keys.ts";

beforeEach(() => { quickCompose.finish("new-thread"); quickCompose.finish("handoff"); });
test("a session with a draft survives reopening elsewhere", () => {
  const unregister = quickCompose.registerDraftCheck("new-thread", () => true);
  quickCompose.open("new-thread", { projectId: "a", threadId: null });
  const session = quickCompose.getState().sessions["new-thread"];
  const focus = quickCompose.getState().focusRequest;
  quickCompose.close();
  quickCompose.open("new-thread", { projectId: "b", threadId: null });
  assert.equal(quickCompose.getState().sessions["new-thread"], session);
  assert.equal(quickCompose.getState().focusRequest, focus + 1);
  quickCompose.finish("new-thread");
  quickCompose.open("new-thread", { projectId: "b", threadId: null });
  assert.equal(quickCompose.getState().sessions["new-thread"]?.projectId, "b");
  unregister();
});
test("a session without a draft re-seeds from the current project on open", () => {
  const unregister = quickCompose.registerDraftCheck("new-thread", () => false);
  quickCompose.open("new-thread", { projectId: "a", threadId: null });
  const first = quickCompose.getState().sessions["new-thread"];
  quickCompose.close();
  quickCompose.open("new-thread", { projectId: "b", threadId: null });
  const second = quickCompose.getState().sessions["new-thread"];
  assert.notEqual(second, first);
  assert.equal(second?.projectId, "b");
  quickCompose.toggle("new-thread", { projectId: "c", threadId: null });
  assert.equal(quickCompose.getState().active, null);
  unregister();
});
test("handoff is scoped to its source and does not clear the new-thread session", () => {
  quickCompose.open("new-thread", { projectId: "a", threadId: null });
  const plain = quickCompose.getState().sessions["new-thread"];
  quickCompose.toggle("handoff", { projectId: "a", threadId: "t1" });
  const handoff = quickCompose.getState().sessions.handoff;
  quickCompose.toggle("handoff", { projectId: "a", threadId: "t1" });
  assert.equal(quickCompose.getState().active, null);
  quickCompose.toggle("handoff", { projectId: "b", threadId: "t2" });
  assert.notEqual(quickCompose.getState().sessions.handoff, handoff);
  assert.equal(quickCompose.getState().sessions.handoff?.sourceThreadId, "t2");
  quickCompose.finish("handoff");
  assert.equal(quickCompose.getState().sessions["new-thread"], plain);
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
  assert.equal(projectShortcut({ ...b, ctrlKey: true }, true), null);
  assert.equal(projectShortcut({ ...b, metaKey: true, altKey: true }, true), null);
  assert.equal(projectShortcut({ ...b, metaKey: true, shiftKey: false }, true), null);
});
