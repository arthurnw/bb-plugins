import { test } from "node:test";
import assert from "node:assert/strict";
import type { AvatarState } from "@arthurnw/bb-shared/avatars/state";
import {
  anchorFromRect, attentionCount, botSummary, cardColumns, clamp, DEFAULT_PLACEMENT, DEFAULT_SETTINGS, INSET, loudest,
  parseZooPlacement, parseZooSettings, rankBots, rectFromAnchor, snap, threadsByUrgency, type Anchor,
} from "./zoo-layout.ts";

const bots = [{ id: "a" }, { id: "b" }, { id: "c" }];
const states = (entries: [string, AvatarState][]) => new Map(entries);
const thread = (id: string, over: Partial<{ status: string; hasPendingInteraction: boolean; isUnread: boolean }> = {}) =>
  ({ id, status: "idle", hasPendingInteraction: false, isUnread: false, ...over });

test("bots keep Bots order, and a bot without a state is idle", () => {
  assert.deepEqual(rankBots(bots, states([["c", "waiting"]])).map((entry) => [entry.bot.id, entry.state]), [["a", "idle"], ["b", "idle"], ["c", "waiting"]]);
});

test("the loudest bot is the most urgent, and ties go to Bots order", () => {
  assert.equal(loudest(rankBots(bots, states([["a", "working"], ["b", "unread"], ["c", "unread"]])))?.bot.id, "b");
  assert.equal(loudest(rankBots(bots, states([["a", "working"], ["c", "waiting"]])))?.bot.id, "c");
});

test("with every bot idle, the loudest is the first bot; with none, there is none", () => {
  assert.equal(loudest(rankBots(bots, new Map()))?.bot.id, "a");
  assert.equal(loudest([]), null);
});

test("bots that need the user are the waiting and unread ones", () => {
  assert.equal(attentionCount(rankBots(bots, states([["a", "waiting"], ["b", "unread"], ["c", "working"]]))), 2);
  assert.equal(attentionCount(rankBots(bots, new Map())), 0);
});

test("threads sort waiting, unread, working, idle, keeping order within a state", () => {
  const sorted = threadsByUrgency([
    thread("idle1"), thread("work1", { status: "active" }), thread("unread1", { isUnread: true }),
    thread("wait1", { hasPendingInteraction: true }), thread("work2", { status: "starting" }), thread("idle2"),
  ]);
  assert.deepEqual(sorted.map((item) => item.id), ["wait1", "unread1", "work1", "work2", "idle1", "idle2"]);
});

test("the hover summary counts live threads by state", () => {
  assert.equal(botSummary("Planner", [thread("1", { hasPendingInteraction: true }), thread("2", { status: "active" }), thread("3", { status: "active" }), thread("4")]),
    "Planner · 1 waiting, 2 working");
  assert.equal(botSummary("Planner", [thread("1")]), "Planner · idle");
  assert.equal(botSummary("Planner", []), "Planner · idle");
});

test("the card grid has two to four columns", () => {
  assert.deepEqual([1, 2, 4, 5, 9, 10, 30].map(cardColumns), [2, 2, 2, 3, 3, 4, 4]);
});

const viewport = { width: 1400, height: 900 };
const size = { width: 200, height: 120 };

test("an anchor round-trips at each corner", () => {
  const corners: [number, number, Anchor][] = [
    [40, 50, { h: "left", v: "top", dx: 40, dy: 50 }],
    [1100, 60, { h: "right", v: "top", dx: 100, dy: 60 }],
    [30, 700, { h: "left", v: "bottom", dx: 30, dy: 80 }],
    [1150, 740, { h: "right", v: "bottom", dx: 50, dy: 40 }],
  ];
  for (const [left, top, anchor] of corners) {
    assert.deepEqual(anchorFromRect({ left, top }, size, viewport), anchor);
    assert.deepEqual(rectFromAnchor(anchor, size, viewport), { left, top });
  }
});

test("a card grows away from its corner", () => {
  const anchor: Anchor = { h: "right", v: "bottom", dx: 20, dy: 30 };
  assert.deepEqual(rectFromAnchor(anchor, { width: 72, height: 72 }, viewport), { left: 1308, top: 798 });
  assert.deepEqual(rectFromAnchor(anchor, { width: 300, height: 200 }, viewport), { left: 1080, top: 670 });
});

test("after the window shrinks, the card is clamped back inside it", () => {
  const anchor: Anchor = { h: "left", v: "top", dx: 1100, dy: 700 };
  assert.deepEqual(rectFromAnchor(anchor, size, { width: 800, height: 600 }), { left: 800 - INSET - 200, top: 600 - INSET - 120 });
  // A window smaller than the card plus insets pins it to the top-left inset or edge.
  assert.deepEqual(clamp({ left: 50, top: 50 }, size, { width: 210, height: 100 }), { left: 10, top: 0 });
});

test("a drop near an edge snaps to the inset; elsewhere it stays", () => {
  assert.deepEqual(snap({ left: 30, top: 300 }, size, viewport), { left: INSET, top: 300 });
  assert.deepEqual(snap({ left: 1170, top: 760 }, size, viewport), { left: 1400 - INSET - 200, top: 900 - INSET - 120 });
  assert.deepEqual(snap({ left: 500, top: 300 }, size, viewport), { left: 500, top: 300 });
});

test("stored settings and placement fall back to defaults when unreadable", () => {
  assert.deepEqual(parseZooSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(parseZooSettings("{bad"), DEFAULT_SETTINGS);
  assert.deepEqual(parseZooSettings('{"enabled":true}'), { enabled: true, dockToPanel: true });
  assert.deepEqual(parseZooPlacement('{"anchor":{"h":"middle"},"collapsed":true}'), { anchor: DEFAULT_PLACEMENT.anchor, collapsed: true });
  const stored = { anchor: { h: "left", v: "top", dx: 12, dy: 34 }, collapsed: false };
  assert.deepEqual(parseZooPlacement(JSON.stringify(stored)), stored);
});
