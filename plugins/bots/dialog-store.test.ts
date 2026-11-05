import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { dialog } from "./dialog-store.ts";

const base = { projectId: "p", threadId: null, placement: null, hostId: null };
beforeEach(() => { dialog.finish("new-thread"); dialog.finish("handoff"); });

test("a new-thread session with a draft is resumed for the same bot", () => {
  const unregister = dialog.registerDraftCheck(() => true);
  dialog.open("new-thread", { ...base, botId: "b" });
  const first = dialog.getState().sessions["new-thread"];
  dialog.close();
  dialog.open("new-thread", { ...base, botId: "b" });
  assert.equal(dialog.getState().sessions["new-thread"], first);
  dialog.open("new-thread", { ...base, botId: "c" });
  assert.notEqual(dialog.getState().sessions["new-thread"], first);
  unregister();
});

test("an untouched new-thread session re-seeds on open", () => {
  const unregister = dialog.registerDraftCheck(() => false);
  dialog.open("new-thread", { ...base, botId: "b" });
  const first = dialog.getState().sessions["new-thread"];
  dialog.open("new-thread", { ...base, botId: "b" });
  assert.notEqual(dialog.getState().sessions["new-thread"], first);
  unregister();
});

test("a handoff is scoped to its source thread and leaves the new-thread session alone", () => {
  dialog.open("new-thread", { ...base, botId: "b" });
  const plain = dialog.getState().sessions["new-thread"];
  dialog.open("handoff", { ...base, threadId: "t1", botId: null });
  const handoff = dialog.getState().sessions.handoff;
  dialog.close();
  dialog.open("handoff", { ...base, threadId: "t1", botId: null });
  assert.equal(dialog.getState().sessions.handoff, handoff);
  dialog.open("handoff", { ...base, threadId: "t2", botId: null });
  assert.equal(dialog.getState().sessions.handoff?.threadId, "t2");
  dialog.finish("handoff");
  assert.equal(dialog.getState().sessions["new-thread"], plain);
  assert.equal(dialog.getState().active, null);
});
