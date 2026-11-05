import { test } from "node:test";
import assert from "node:assert/strict";
import { animatedImageType, dataUrlBytes } from "./animation.ts";

// Two-frame and one-frame 4×4 images written by Pillow.
const FIXTURES = {
  animatedGif: "R0lGODlhBAAEAIEAAP8AAAAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQACgAAACwAAAAABAAEAAAICQABCBxIsCCAgAAh+QQBCgABACwAAAAABAAEAIEAAP8AAAAAAAAAAAAICQABCBxIsCCAgAA7",
  stillGif: "R0lGODdhBAAEAIEAAP8AAAAAAAAAAAAAACwAAAAABAAEAAAICQABCBxIsCCAgAA7",
  animatedWebp: "UklGRoQAAABXRUJQVlA4WAoAAAACAAAAAwAAAwAAQU5JTQYAAAAAAAAAAABBTk1GKAAAAAAAAAAAAAMAAAMAAGQAAAJWUDhMDwAAAC8DwAAABxD9j/4HIqL/AQBBTk1GKAAAAAAAAAAAAAMAAAMAAGQAAABWUDhMDwAAAC8DwAAABxDR//4HIqL/AQA=",
  stillWebp: "UklGRhwAAABXRUJQVlA4TA8AAAAvA8AAAAcQ/Y/+ByKi/wEA",
  animatedPng: "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAACGFjVEwAAAACAAAAAPONk3AAAAAaZmNUTAAAAAAAAAAEAAAABAAAAAAAAAAAAAEACgAAV3ID4QAAABVJREFUeJxj/M/A8J8BCTAhc4gTAACD0QIGBLwkRwAAABpmY1RMAAAAAQAAAAQAAAAEAAAAAAAAAAAAAQAKAADMAek1AAAAGWZkQVQAAAACeJxjZGD4/58BCTAhc4gTAACB0wIGSo/wYAAAAABJRU5ErkJggg==",
  stillPng: "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFUlEQVR4nGP8z8DwnwEJMCFziBMAAIPRAgYEvCRHAAAAAElFTkSuQmCC",
};
const bytes = (base64: string) => dataUrlBytes(`data:application/octet-stream;base64,${base64}`);

test("animated GIF, WebP, and APNG are recognized by their bytes", () => {
  assert.equal(animatedImageType(bytes(FIXTURES.animatedGif)), "image/gif");
  assert.equal(animatedImageType(bytes(FIXTURES.animatedWebp)), "image/webp");
  assert.equal(animatedImageType(bytes(FIXTURES.animatedPng)), "image/png");
});

test("still images, other formats, and truncated files are not animations", () => {
  for (const still of [FIXTURES.stillGif, FIXTURES.stillWebp, FIXTURES.stillPng]) assert.equal(animatedImageType(bytes(still)), null);
  assert.equal(animatedImageType(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>")), null);
  assert.equal(animatedImageType(new Uint8Array()), null);
  assert.equal(animatedImageType(bytes(FIXTURES.animatedGif).subarray(0, 60)), null);
});
