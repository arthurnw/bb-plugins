import { test } from "node:test";
import assert from "node:assert/strict";
import { combinedAvatarState, threadAvatarState } from "./state.ts";

const thread = (extra: Partial<{ status: string; hasPendingInteraction: boolean; isUnread: boolean }> = {}) =>
  ({ status: "idle", hasPendingInteraction: false, isUnread: false, ...extra });

test("a thread's state: waiting, then unread, then working, else idle", () => {
  assert.equal(threadAvatarState(thread()), "idle");
  assert.equal(threadAvatarState(thread({ status: "pending" })), "idle");
  for (const status of ["starting", "active", "stopping"]) assert.equal(threadAvatarState(thread({ status })), "working");
  assert.equal(threadAvatarState(thread({ status: "active", isUnread: true })), "unread");
  assert.equal(threadAvatarState(thread({ status: "active", isUnread: true, hasPendingInteraction: true })), "waiting");
});

test("a bot's combined state is its threads' highest-priority state", () => {
  assert.equal(combinedAvatarState([]), "idle");
  assert.equal(combinedAvatarState([thread(), thread({ status: "active" })]), "working");
  assert.equal(combinedAvatarState([thread({ status: "active" }), thread({ isUnread: true }), thread()]), "unread");
  assert.equal(combinedAvatarState([thread({ isUnread: true }), thread({ hasPendingInteraction: true }), thread({ status: "active" })]), "waiting");
});
