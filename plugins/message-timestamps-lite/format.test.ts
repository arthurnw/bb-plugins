import assert from "node:assert/strict";
import { test } from "node:test";
import { formatSentAt, parseMessageRowId } from "./format.ts";

test("parseMessageRowId reads thread id, role, and seq", () => {
  assert.deepEqual(parseMessageRowId("thr_abc:user-seed:212"), { threadId: "thr_abc", role: "user", seq: 212 });
  assert.deepEqual(parseMessageRowId("thr_abc:user-seed:x"), { threadId: "thr_abc", role: "user", seq: null });
  assert.deepEqual(
    parseMessageRowId("thr_abc:assistant:kind:assistant|turn:t1|parent:root|item:i4"),
    { threadId: "thr_abc", role: "assistant", seq: null },
  );
  assert.equal(parseMessageRowId("thr_abc:command:da6-i2"), null);
  assert.equal(parseMessageRowId("thr_abc:op:reasoning:kind:reasoning"), null);
  assert.equal(parseMessageRowId("da3-t4:work-summary:thr_abc:op:reasoning"), null);
});

test("formatSentAt labels today, yesterday, and older dates", () => {
  const now = new Date(2026, 9, 16, 15, 0);
  const today = new Date(2026, 9, 16, 9, 5).getTime();
  const yesterday = new Date(2026, 9, 15, 9, 5).getTime();
  const lastYear = new Date(2025, 7, 12, 9, 5).getTime();
  assert.doesNotMatch(formatSentAt(today, now), /Yesterday|,/);
  assert.match(formatSentAt(yesterday, now), /^Yesterday /);
  assert.match(formatSentAt(lastYear, now), /2025/);
  assert.equal(formatSentAt(Number.NaN, now), "");
});
