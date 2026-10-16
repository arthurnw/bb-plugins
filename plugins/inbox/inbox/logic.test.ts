import { test } from "node:test";
import assert from "node:assert/strict";
import { askOf } from "./interaction.ts";
import { clock, compareRows, duration, groupOf, statusOf, type StatusFields } from "./status.ts";
import { expandCollapsedTurn, plainText, summarizeTurn, type TimelineRowLike } from "./steps.ts";

const base: StatusFields = {
  status: "idle",
  runtimeStatus: "idle",
  indicator: "none",
  hasPendingInteraction: false,
  queuedWork: "none",
};

test("statusOf puts a pending interaction above everything", () => {
  assert.equal(statusOf({ ...base, status: "active", hasPendingInteraction: true }), "waiting");
  assert.equal(statusOf({ ...base, indicator: "unread-error" }), "failed");
  assert.equal(statusOf({ ...base, runtimeStatus: "provisioning" }), "running");
  assert.equal(statusOf({ ...base, indicator: "unread-success" }), "done");
  assert.equal(statusOf(base), "idle");
});

test("failed threads need you, and idle ones count as done", () => {
  assert.equal(groupOf("failed"), "needs");
  assert.equal(groupOf("waiting"), "needs");
  assert.equal(groupOf("running"), "running");
  assert.equal(groupOf("idle"), "done");
});

test("rows sort by status, then newest attention first", () => {
  const rows = [
    { status: "idle" as const, latestAttentionAt: 9 },
    { status: "running" as const, latestAttentionAt: 1 },
    { status: "waiting" as const, latestAttentionAt: 2 },
    { status: "running" as const, latestAttentionAt: 5 },
  ].sort(compareRows);
  assert.deepEqual(
    rows.map((row) => `${row.status}:${row.latestAttentionAt}`),
    ["waiting:2", "running:5", "running:1", "idle:9"],
  );
});

test("clock and duration format elapsed time", () => {
  assert.equal(clock(42_000), "0:42");
  assert.equal(clock(3_729_000), "1:02:09");
  assert.equal(duration(252_000), "4m 12s");
  assert.equal(duration(3_780_000), "1h 3m");
});

const row = (fields: Partial<TimelineRowLike> & { id: string }): TimelineRowLike => ({
  kind: "work",
  startedAt: 0,
  createdAt: 0,
  turnId: "t1",
  ...fields,
});

test("summarizeTurn reads the latest turn's steps, timing, and message", () => {
  const rows = [
    row({ id: "u1", kind: "conversation", role: "user", text: "old", turnId: null }),
    row({ id: "old", workKind: "command", command: "echo old", turnId: "t0" }),
    row({ id: "u2", kind: "conversation", role: "user", text: "go", turnId: null, startedAt: 90 }),
    row({ id: "think", kind: "system", systemKind: "operation", title: "Thought", startedAt: 100 }),
    row({ id: "c1", workKind: "command", command: "npm test\n--watch", startedAt: 110, completedAt: 120 }),
    row({ id: "f1", workKind: "file-change", change: { path: "src/a.ts", kind: "update", diffStats: { added: 3, removed: 1 } }, startedAt: 130 }),
    row({ id: "t1", workKind: "tool", toolName: "Skill", presentation: { label: { completed: "Loaded skill" } }, startedAt: 140 }),
    row({ id: "a1", kind: "conversation", role: "assistant", text: "**Done.** See `a.ts`.", startedAt: 150, createdAt: 160 }),
  ];
  const summary = summarizeTurn(rows, false);
  assert.equal(summary.turnId, "t1");
  assert.equal(summary.startedAt, 100);
  assert.equal(summary.endedAt, 160);
  assert.equal(summary.toolCount, 3);
  assert.equal(summary.sourceCount, 0);
  assert.equal(summary.latest, "Done. See a.ts.");
  assert.equal(summary.message, "Done. See a.ts.");
  assert.deepEqual(
    summary.steps.map((step) => step.label),
    ["npm test", "Edited a.ts +3 −1", "Loaded skill"],
  );
  assert.equal(summarizeTurn(rows, true).endedAt, null);
});

test("summarizeTurn surfaces a failed start as an error", () => {
  const rows = [
    row({ id: "u", kind: "conversation", role: "user", text: "hi", turnId: null }),
    row({ id: "e", kind: "system", systemKind: "error", status: "error", title: "Start failed", detail: "No auth", turnId: null, startedAt: 5 }),
  ];
  const summary = summarizeTurn(rows, false);
  assert.equal(summary.message, "No auth");
  assert.equal(summary.messageTone, "error");
  assert.deepEqual(summary.steps.map((step) => [step.label, step.tone]), [["Start failed", "error"]]);
});

test("a collapsed turn is reported, then expanded from its own rows", () => {
  const page = [
    row({ id: "turn", kind: "turn", summaryCount: 9, sourceSeqStart: 1, sourceSeqEnd: 50, startedAt: 10, completedAt: 90, children: null }),
    row({ id: "a", kind: "conversation", role: "assistant", text: "Committed.", startedAt: 80 }),
  ];
  const collapsed = summarizeTurn(page, false);
  assert.deepEqual(collapsed.collapsedTurn, { turnId: "t1", sourceSeqStart: 1, sourceSeqEnd: 50 });
  assert.equal(collapsed.toolCount, 9);
  assert.equal(collapsed.sourceCount, null);
  const expanded = expandCollapsedTurn(page, [row({ id: "c", workKind: "command", command: "git commit", startedAt: 20 })], false);
  assert.deepEqual(expanded.steps.map((step) => step.label), ["git commit"]);
  assert.equal(expanded.message, "Committed.");
});

test("plainText drops markdown noise", () => {
  assert.equal(plainText("# Title\n\nSee [docs](https://x) and ```js\ncode\n```"), "Title See docs and");
});

test("askOf offers Approve and Reject for an approval", () => {
  const ask = askOf([
    {
      id: "i1",
      status: "pending",
      payload: {
        kind: "approval",
        availableDecisions: ["allow_once", "allow_for_session", "deny"],
        reason: null,
        subject: { kind: "command", command: "rm -rf dist", cwd: null },
      },
    },
  ]);
  assert.equal(ask?.kind, "approval");
  if (ask?.kind !== "approval") return;
  assert.equal(ask.detail, "rm -rf dist");
  assert.deepEqual(ask.approve, { decision: "allow_once", grantedPermissions: null });
  assert.deepEqual(ask.reject, { decision: "deny" });
});

test("askOf answers a single one-choice question inline, and sends others to the thread", () => {
  const choice = askOf([
    {
      id: "i2",
      status: "pending",
      payload: {
        kind: "user_question",
        questions: [{ id: "q", prompt: "Ship it?", multiSelect: false, allowFreeText: true, options: [{ label: "Yes", value: "yes" }] }],
      },
    },
  ]);
  assert.equal(choice?.kind, "choice");
  if (choice?.kind === "choice") {
    assert.deepEqual(choice.options[0]!.resolution, { kind: "user_answer", answers: { q: { selected: ["yes"] } } });
  }
  const open = askOf([
    {
      id: "i3",
      status: "pending",
      payload: { kind: "user_question", questions: [{ id: "q", prompt: "Which?", multiSelect: true, options: [] }] },
    },
  ]);
  assert.equal(open?.kind, "open");
  assert.equal(askOf([{ id: "i4", status: "resolved", payload: { kind: "approval" } }]), null);
});
