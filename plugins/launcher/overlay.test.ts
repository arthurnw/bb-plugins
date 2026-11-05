import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { quickCompose } from "./overlay-store.ts";

beforeEach(() => { quickCompose.finish("new-thread"); quickCompose.finish("handoff"); quickCompose.finish("fork"); });
test("a session with a draft survives reopening elsewhere", () => {
  const unregister = quickCompose.registerDraftCheck(() => true);
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
  const unregister = quickCompose.registerDraftCheck(() => false);
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
test("fork sessions are scoped to their source thread", () => {
  quickCompose.toggle("fork", { projectId: "a", threadId: "t1" });
  const fork = quickCompose.getState().sessions.fork;
  assert.equal(fork?.sourceThreadId, "t1");
  assert.equal(quickCompose.getState().sessions.handoff, null);
  quickCompose.toggle("fork", { projectId: "a", threadId: "t2" });
  assert.equal(quickCompose.getState().sessions.fork?.sourceThreadId, "t2");
  quickCompose.toggle("fork", { projectId: "a", threadId: "t2", sourceSeqEnd: 40 });
  assert.equal(quickCompose.getState().sessions.fork?.sourceSeqEnd, 40);
  assert.equal(quickCompose.getState().active, "fork");
  quickCompose.toggle("fork", { projectId: "a", threadId: "t2", sourceSeqEnd: 40 });
  assert.equal(quickCompose.getState().active, null);
  quickCompose.finish("fork");
});

test("a draft is kept only for the same section and machine", () => {
  const unregister = quickCompose.registerDraftCheck(() => true);
  const section = { sectionId: "s1", pinned: false };
  quickCompose.open("new-thread", { projectId: null, threadId: null, placement: section });
  const first = quickCompose.getState().sessions["new-thread"];
  assert.deepEqual(first?.placement, section);
  quickCompose.open("new-thread", { projectId: null, threadId: null, placement: { ...section } });
  assert.equal(quickCompose.getState().sessions["new-thread"], first);
  quickCompose.open("new-thread", { projectId: null, threadId: null, hostId: "h1" });
  const machine = quickCompose.getState().sessions["new-thread"];
  assert.notEqual(machine, first);
  assert.equal(machine?.hostId, "h1");
  assert.equal(machine?.placement, null);
  unregister();
});
