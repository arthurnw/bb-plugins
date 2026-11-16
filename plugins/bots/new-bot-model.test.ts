import { test } from "node:test";
import assert from "node:assert/strict";
import { GALLERY_IDS, galleryAvatar } from "@arthurnw/bb-shared/bots";
import { freeAvatars, isWorkerShortcut, shuffleAvatar } from "./new-bot-model.ts";

test("avatars of persona bots and live initiative bots are taken; archived ones are free", () => {
  const [a, b, c] = GALLERY_IDS;
  const bots = [
    { avatar: galleryAvatar(a!), coordinatorThreadId: null },
    { avatar: galleryAvatar(b!), coordinatorThreadId: "live" },
    { avatar: galleryAvatar(c!), coordinatorThreadId: "archived" },
  ];
  const free = freeAvatars(bots, new Set(["live"]));
  assert.equal(free.includes(a!), false);
  assert.equal(free.includes(b!), false);
  assert.equal(free.includes(c!), true);
});

test("shuffle avoids the current avatar and falls back to all when none are free", () => {
  const [a, b] = GALLERY_IDS;
  assert.equal(shuffleAvatar([a!, b!], a!, () => 0), b);
  assert.equal(shuffleAvatar([a!], a!, () => 0), a);
  assert.ok(GALLERY_IDS.includes(shuffleAvatar([], null)));
});

test("Mod+Shift+K opens the worker model picker", () => {
  const key = { key: "K", code: "KeyK", metaKey: true, ctrlKey: false, altKey: false, shiftKey: true, isComposing: false };
  assert.equal(isWorkerShortcut(key, true), true);
  assert.equal(isWorkerShortcut(key, false), false);
  assert.equal(isWorkerShortcut({ ...key, metaKey: false, ctrlKey: true }, false), true);
  assert.equal(isWorkerShortcut({ ...key, shiftKey: false }, true), false);
});
