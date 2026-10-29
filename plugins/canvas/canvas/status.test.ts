import { test } from "node:test";
import assert from "node:assert/strict";
import { age, bucketOf, type StatusFields } from "./status.ts";

const base: StatusFields = {
  status: "idle",
  runtimeStatus: "idle",
  indicator: "none",
  hasPendingInteraction: false,
  queuedWork: "none",
};

test("bucketOf ranks a pending question above everything", () => {
  assert.equal(bucketOf({ ...base, status: "active", hasPendingInteraction: true }), "needs-you");
  assert.equal(bucketOf({ ...base, indicator: "waiting-for-input" }), "needs-you");
});

test("bucketOf separates errors, work, unread results, and idle", () => {
  assert.equal(bucketOf({ ...base, indicator: "unread-error" }), "error");
  assert.equal(bucketOf({ ...base, queuedWork: "failed" }), "error");
  assert.equal(bucketOf({ ...base, status: "active" }), "working");
  assert.equal(bucketOf({ ...base, runtimeStatus: "provisioning" }), "working");
  assert.equal(bucketOf({ ...base, indicator: "unread-success" }), "done");
  assert.equal(bucketOf(base), "idle");
});

test("age formats short durations", () => {
  assert.equal(age(0, 10_000), "now");
  assert.equal(age(0, 5 * 60_000), "5m");
  assert.equal(age(0, 3 * 3_600_000), "3h");
  assert.equal(age(0, 72 * 3_600_000), "3d");
});
