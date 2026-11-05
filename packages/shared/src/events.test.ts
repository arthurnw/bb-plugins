import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { onBotsHandoff, onBotsNewThread, onHandoff, onNewThread, openHandoff, openNewThread } from "./events.ts";

// The events are window events; Node has EventTarget and CustomEvent but no window.
beforeEach(() => { (globalThis as { window?: unknown }).window = new EventTarget(); });

test("with no Launcher, new-thread and handoff requests fall through to Bots", () => {
  const seen: unknown[] = [];
  onBotsNewThread((detail) => { seen.push(["new", detail]); });
  onBotsHandoff((detail) => { seen.push(["handoff", detail]); });
  assert.equal(openNewThread({ botId: "b" }), true);
  assert.equal(openHandoff({ threadId: "t", projectId: "p", botId: null }), true);
  assert.deepEqual(seen, [["new", { botId: "b" }], ["handoff", { threadId: "t", projectId: "p", botId: null }]]);
});

test("the Launcher answers first, so Bots' dialog stays closed", () => {
  const seen: string[] = [];
  onNewThread(() => { seen.push("launcher"); });
  onBotsNewThread(() => { seen.push("bots"); });
  onHandoff(() => { seen.push("launcher-handoff"); });
  onBotsHandoff(() => { seen.push("bots-handoff"); });
  assert.equal(openNewThread({}), true);
  assert.equal(openHandoff({ threadId: "t", projectId: null }), true);
  assert.deepEqual(seen, ["launcher", "launcher-handoff"]);
});

test("a listener that declines leaves the request unhandled", () => {
  onBotsNewThread(() => false);
  assert.equal(openNewThread({ projectId: "p" }), false);
  assert.equal(openHandoff({ threadId: "t", projectId: null }), false);
});
