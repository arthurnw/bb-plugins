import { test } from "node:test";
import assert from "node:assert/strict";
import { cornerPosition, nextCorner, paneAvatarState } from "./pane-avatar-layout.ts";

const pane = { left: 300, top: 50, right: 1300, bottom: 900 };
const composer = { left: 500, top: 700, right: 1100, bottom: 880 };

test("the chip cycles clockwise from top-right, then off, then back", () => {
  const seen = ["top-right" as const];
  for (let i = 0; i < 5; i++) seen.push(nextCorner(seen.at(-1)!) as never);
  assert.deepEqual(seen, ["top-right", "bottom-right", "bottom-left", "top-left", "off", "top-right"]);
});

test("top corners sit inside the pane's top edge", () => {
  assert.deepEqual(cornerPosition("top-right", pane, composer), { left: 1300 - 12 - 96, top: 62 });
  assert.deepEqual(cornerPosition("top-left", pane, composer), { left: 312, top: 62 });
});

test("bottom corners clear the composer only where they overlap it", () => {
  // Wide pane: the corner is beside the centered composer, so it uses the pane's bottom.
  assert.deepEqual(cornerPosition("bottom-right", pane, composer), { left: 1192, top: 900 - 12 - 96 });
  // Narrow pane: the composer spans it, so the avatar sits above the composer.
  const narrow = { left: 300, top: 50, right: 800, bottom: 900 };
  assert.deepEqual(cornerPosition("bottom-left", narrow, { left: 316, top: 700, right: 784, bottom: 880 }), { left: 312, top: 700 - 12 - 96 });
});

test("without a composer measured yet, bottom corners use the pane's bottom", () => {
  assert.deepEqual(cornerPosition("bottom-right", pane, null), { left: 1192, top: 792 });
  assert.deepEqual(cornerPosition("bottom-left", pane, null), { left: 312, top: 792 });
});

test("off and panes too small for the avatar show nothing", () => {
  assert.equal(cornerPosition("off", pane, composer), null);
  assert.equal(cornerPosition("top-right", { left: 0, top: 0, right: 110, bottom: 900 }, null), null);
});

test("a pane's own thread shows working before unread; waiting still wins", () => {
  const thread = (status: string, extra: { isUnread?: boolean; hasPendingInteraction?: boolean } = {}) =>
    ({ status, isUnread: extra.isUnread ?? false, hasPendingInteraction: extra.hasPendingInteraction ?? false });
  assert.equal(paneAvatarState(thread("active", { isUnread: true })), "working");
  assert.equal(paneAvatarState(thread("active", { isUnread: true, hasPendingInteraction: true })), "waiting");
  assert.equal(paneAvatarState(thread("idle", { isUnread: true })), "unread");
  assert.equal(paneAvatarState(thread("idle")), "idle");
  assert.equal(paneAvatarState(undefined), "idle");
});
