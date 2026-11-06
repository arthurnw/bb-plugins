import { test } from "node:test";
import assert from "node:assert/strict";
import { compareThreads, organizeAll, topLevelOrder, type AllNode, type AllPrefs, type AllThread } from "./all-model.ts";

let clock = 0;
const thread = (id: string, over: Partial<AllThread> = {}): AllThread => {
  clock += 1;
  return {
    id, parentThreadId: null, sectionId: null, isPinned: false, pinnedAt: null, pinSortKey: null, isHidden: false, isArchived: false,
    status: "idle", displayTitle: id, createdAt: clock, latestAttentionAt: clock, ...over,
  };
};
const prefs = (over: Partial<AllPrefs> = {}): AllPrefs => ({
  threadLifecycles: ["active"], chronologicalSort: "updated", sortDirection: "default", manualSectionOrder: ["pinned", "sections", "threads"], ...over,
});
const ids = (nodes: readonly AllNode<AllThread>[]): unknown[] => nodes.map((node) => node.children.length ? [node.thread.id, ids(node.children)] : node.thread.id);
const layout = (groups: ReturnType<typeof organizeAll<AllThread>>) => groups.map((group) => [group.key, ids(group.roots)]);
const sorted = (threads: AllThread[], sort: AllPrefs["chronologicalSort"], direction: AllPrefs["sortDirection"]) =>
  [...threads].sort(compareThreads(sort, direction)).map((item) => item.id);

test("updated sorts running threads first by creation, then the rest by latest attention", () => {
  const threads = [
    thread("old", { latestAttentionAt: 10, createdAt: 1 }),
    thread("recent", { latestAttentionAt: 30, createdAt: 2 }),
    thread("run-old", { status: "active", createdAt: 3, latestAttentionAt: 0 }),
    thread("run-new", { status: "active", createdAt: 4, latestAttentionAt: 0 }),
  ];
  assert.deepEqual(sorted(threads, "updated", "default"), ["run-new", "run-old", "recent", "old"]);
  assert.deepEqual(sorted(threads, "updated", "descending"), ["run-new", "run-old", "recent", "old"]);
  // Reversed, running threads still lead.
  assert.deepEqual(sorted(threads, "updated", "ascending"), ["run-old", "run-new", "old", "recent"]);
  assert.deepEqual(sorted(threads, "none", "default"), sorted(threads, "updated", "default"));
});

test("created sorts newest first by default and oldest first ascending", () => {
  const threads = [thread("a", { createdAt: 1 }), thread("b", { createdAt: 3 }), thread("c", { createdAt: 2, status: "active" })];
  assert.deepEqual(sorted(threads, "created", "default"), ["b", "c", "a"]);
  assert.deepEqual(sorted(threads, "created", "descending"), ["b", "c", "a"]);
  assert.deepEqual(sorted(threads, "created", "ascending"), ["a", "c", "b"]);
});

test("alpha sorts A to Z by default and Z to A descending", () => {
  const threads = [thread("1", { displayTitle: "beta" }), thread("2", { displayTitle: "Alpha" }), thread("3", { displayTitle: "gamma" })];
  assert.deepEqual(sorted(threads, "alpha", "default"), ["2", "1", "3"]);
  assert.deepEqual(sorted(threads, "alpha", "ascending"), ["2", "1", "3"]);
  assert.deepEqual(sorted(threads, "alpha", "descending"), ["3", "1", "2"]);
});

test("Custom organization: Pinned, sections in stored order, then Threads", () => {
  const sections = [{ id: "s1", name: "One" }, { id: "s2", name: "Two" }];
  const threads = [
    thread("loose"), thread("in-s1", { sectionId: "s1" }), thread("in-s2", { sectionId: "s2" }),
    thread("pin", { isPinned: true, pinnedAt: 5 }),
  ];
  assert.deepEqual(layout(organizeAll({ threads, prefs: prefs(), sections })),
    [["pinned", ["pin"]], ["section:s1", ["in-s1"]], ["section:s2", ["in-s2"]], ["threads", ["loose"]]]);
  assert.deepEqual(layout(organizeAll({ threads, prefs: prefs({ manualSectionOrder: ["threads", "section:s2", "pinned", "section:s1"] }), sections })),
    [["threads", ["loose"]], ["section:s2", ["in-s2"]], ["pinned", ["pin"]], ["section:s1", ["in-s1"]]]);
});

test("Pinned hides when empty; sections and Threads show when empty", () => {
  assert.deepEqual(layout(organizeAll({ threads: [], prefs: prefs(), sections: [{ id: "s1", name: "One" }] })), [["section:s1", []], ["threads", []]]);
});

test("children nest under their parent whatever their own section, sorted like roots", () => {
  const threads = [
    thread("parent", { sectionId: "s1", latestAttentionAt: 1 }),
    thread("kid-old", { parentThreadId: "parent", latestAttentionAt: 2 }),
    thread("kid-new", { parentThreadId: "parent", sectionId: "s2", latestAttentionAt: 3 }),
    thread("grandkid", { parentThreadId: "kid-old" }),
    thread("orphan", { parentThreadId: "missing" }),
  ];
  const groups = organizeAll({ threads, prefs: prefs(), sections: [{ id: "s1", name: "One" }, { id: "s2", name: "Two" }] });
  assert.deepEqual(layout(groups), [["section:s1", [["parent", ["kid-new", ["kid-old", ["grandkid"]]]]]], ["section:s2", []], ["threads", ["orphan"]]]);
});

test("a pinned thread brings its descendants into Pinned", () => {
  const threads = [thread("pin", { isPinned: true, pinnedAt: 10 }), thread("kid", { parentThreadId: "pin", sectionId: "s1" }), thread("other")];
  assert.deepEqual(layout(organizeAll({ threads, prefs: prefs(), sections: [{ id: "s1", name: "One" }] })),
    [["pinned", [["pin", ["kid"]]]], ["section:s1", []], ["threads", ["other"]]]);
});

test("pinned roots follow pin keys when both have one, else most recently pinned first", () => {
  const pinnedOrder = (threads: AllThread[]) => organizeAll({ threads, prefs: prefs(), sections: [] })[0]!.roots.map((node) => node.thread.id);
  assert.deepEqual(pinnedOrder([thread("b", { isPinned: true, pinnedAt: 2, pinSortKey: "b" }), thread("a", { isPinned: true, pinnedAt: 1, pinSortKey: "a" })]), ["a", "b"]);
  assert.deepEqual(pinnedOrder([thread("early", { isPinned: true, pinnedAt: 1 }), thread("late", { isPinned: true, pinnedAt: 2 })]), ["late", "early"]);
});

test("thread lifecycles choose active, archived, or both; hidden threads never show", () => {
  const threads = [thread("live"), thread("gone", { isArchived: true }), thread("helper", { isHidden: true })];
  const rows = (lifecycles: AllPrefs["threadLifecycles"]) => organizeAll({ threads, prefs: prefs({ threadLifecycles: lifecycles }), sections: [] }).at(-1)!.roots.map((node) => node.thread.id);
  assert.deepEqual(rows(["active"]), ["live"]);
  assert.deepEqual(rows(["archived"]), ["gone"]);
  assert.deepEqual(rows(["active", "archived"]).sort(), ["gone", "live"]);
});

test("a thread in an unknown section files under Threads", () => {
  assert.deepEqual(layout(organizeAll({ threads: [thread("x", { sectionId: "deleted" })], prefs: prefs(), sections: [] })), [["threads", ["x"]]]);
});

test("a parent cycle still shows every thread once", () => {
  const threads = [thread("a", { parentThreadId: "b" }), thread("b", { parentThreadId: "a" })];
  const roots = organizeAll({ threads, prefs: prefs(), sections: [] }).at(-1)!.roots;
  assert.equal(roots.length, 1);
  assert.equal(roots[0]!.children.length, 1);
});

test("top-level order expands the anchor, drops unknown keys, and places missing entities", () => {
  assert.deepEqual(topLevelOrder(["pinned", "sections", "threads"], ["section:a", "section:b"], "sections"), ["pinned", "section:a", "section:b", "threads"]);
  assert.deepEqual(topLevelOrder(["section:b", "section:gone", "threads"], ["section:a", "section:b"], "sections"), ["pinned", "section:b", "section:a", "threads"]);
  assert.deepEqual(topLevelOrder(["threads", "pinned"], ["section:a"], "sections"), ["section:a", "threads", "pinned"]);
  assert.deepEqual(topLevelOrder([], ["section:a"], "sections"), ["pinned", "section:a", "threads"]);
});
