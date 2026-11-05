import { test } from "node:test";
import assert from "node:assert/strict";
import { GALLERY_IDS } from "@arthurnw/bb-shared/bots";
import { LEGACY_GALLERY, LEGACY_TO_GALLERY, legacyReassignments } from "./legacy-gallery.ts";

test("every legacy pick maps to a distinct animated avatar", () => {
  const targets = LEGACY_GALLERY.map((item) => LEGACY_TO_GALLERY[item.id]);
  assert.ok(targets.every((id) => id && (GALLERY_IDS as readonly string[]).includes(id)));
  assert.equal(new Set(targets).size, LEGACY_GALLERY.length);
});

test("only bots whose avatar exactly matches a rasterized legacy pick are reassigned", () => {
  const rasterized = new Map([["coral", "data:image/webp;base64,CORAL"], ["robot", "data:image/webp;base64,ROBOT"]]);
  const bots = [
    { id: "a", avatar: "data:image/webp;base64,CORAL" },
    { id: "b", avatar: "data:image/webp;base64,ROBOT" },
    { id: "c", avatar: "data:image/webp;base64,UPLOAD" },
    { id: "d", avatar: "gallery:bean" },
    { id: "e", avatar: null },
  ];
  assert.deepEqual(legacyReassignments(bots, rasterized), [{ botId: "a", avatar: "gallery:bean" }, { botId: "b", avatar: "gallery:cubo" }]);
});
