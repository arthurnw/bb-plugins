import { test } from "node:test";
import assert from "node:assert/strict";
import { cornerPlacement, paneAvatarState } from "./pane-avatar-layout.ts";

const pane = { left: 300, top: 50, right: 1300, bottom: 900 };
const composer = { left: 500, top: 700, right: 1100, bottom: 880 };

test("top corners sit inside the pane's top edge, held to their side", () => {
  assert.deepEqual(cornerPlacement("top-right", pane, composer), { side: "right", top: 12 });
  assert.deepEqual(cornerPlacement("top-left", pane, composer), { side: "left", top: 12 });
});

test("bottom corners clear the composer only where they overlap it", () => {
  // Wide pane: the corner is beside the centered composer, so it uses the pane's bottom.
  assert.deepEqual(cornerPlacement("bottom-right", pane, composer), { side: "right", top: 850 - 12 - 96 });
  // Narrow pane: the composer spans it, so the avatar sits above the composer.
  const narrow = { left: 300, top: 50, right: 800, bottom: 900 };
  assert.deepEqual(cornerPlacement("bottom-left", narrow, { left: 316, top: 700, right: 784, bottom: 880 }), { side: "left", top: 650 - 12 - 96 });
});

test("without a composer measured yet, bottom corners use the pane's bottom", () => {
  assert.deepEqual(cornerPlacement("bottom-right", pane, null), { side: "right", top: 742 });
  assert.deepEqual(cornerPlacement("bottom-left", pane, null), { side: "left", top: 742 });
});

test("off and panes too small for the avatar show nothing", () => {
  assert.equal(cornerPlacement("off", pane, composer), null);
  assert.equal(cornerPlacement("top-right", { left: 0, top: 0, right: 110, bottom: 900 }, null), null);
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
