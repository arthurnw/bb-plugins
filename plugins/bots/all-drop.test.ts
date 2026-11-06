import { test } from "node:test";
import assert from "node:assert/strict";
import { organizeAll, type AllPrefs, type AllThread } from "./all-model.ts";
import { planDrop, reorderGroups } from "./all-drop.ts";

let clock = 0;
const thread = (id: string, over: Partial<AllThread> = {}): AllThread => {
  clock += 1;
  return {
    id, projectId: "p1", parentThreadId: null, sectionId: null, isPinned: false, pinnedAt: null, pinSortKey: null, isHidden: false, isArchived: false,
    isUnread: false, status: "idle", displayTitle: id, createdAt: clock, latestAttentionAt: clock, environment: null, host: null, ...over,
  };
};
const prefs = (over: Partial<AllPrefs> = {}): AllPrefs => ({
  threadLifecycles: ["active"], organizationMode: "chronological", environmentGrouping: "auto", groupByReadStatus: false,
  chronologicalSort: "updated", sortDirection: "default", sectionOrder: ["pinned", "projects", "threads"],
  manualSectionOrder: ["pinned", "sections", "threads"], machineSectionOrder: ["pinned", "machines", "threads"], ...over,
});
const sections = [{ id: "s1", name: "One" }, { id: "s2", name: "Two" }];
const projects = [{ id: "home", name: "Personal", isPersonal: true }, { id: "p1", name: "P1", isPersonal: false }, { id: "p2", name: "P2", isPersonal: false }];
const threads = [
  thread("loose"), thread("filed", { sectionId: "s1" }), thread("kid", { parentThreadId: "loose" }), thread("grandkid", { parentThreadId: "kid" }),
  thread("pin-a", { isPinned: true, pinnedAt: 3, pinSortKey: "a" }), thread("pin-b", { isPinned: true, pinnedAt: 2, pinSortKey: "b" }),
  thread("pin-c", { isPinned: true, pinnedAt: 1, pinSortKey: "c" }), thread("mine", { projectId: "home" }), thread("other", { projectId: "p2" }),
];
const byId = new Map(threads.map((item) => [item.id, item]));
const drop = (id: string, target: string, over: Partial<AllPrefs> = {}) => {
  const p = prefs(over);
  return planDrop({ thread: byId.get(id)!, target, groups: organizeAll({ threads, prefs: p, sections, projects, hosts: [] }), threadsById: byId, mode: p.organizationMode, personalProjectId: "home" });
};

test("onto a row: nest, taking the row's section in Custom", () => {
  assert.deepEqual(drop("filed", "thread:loose"), { kind: "apply", actions: [{ kind: "update", threadId: "filed", parentThreadId: "loose", sectionId: null }] });
  assert.deepEqual(drop("loose", "thread:filed"), { kind: "apply", actions: [{ kind: "update", threadId: "loose", parentThreadId: "filed", sectionId: "s1" }] });
  assert.deepEqual(drop("filed", "thread:loose", { organizationMode: "project" }), { kind: "apply", actions: [{ kind: "update", threadId: "filed", parentThreadId: "loose" }] });
});

test("onto a row: a pinned thread unpins; under a pinned row it takes that row's section", () => {
  assert.deepEqual(drop("pin-a", "thread:loose"), { kind: "apply", actions: [{ kind: "unpin", threadId: "pin-a" }, { kind: "update", threadId: "pin-a", parentThreadId: "loose", sectionId: null }] });
  assert.deepEqual(drop("filed", "thread:pin-b"), { kind: "apply", actions: [{ kind: "update", threadId: "filed", parentThreadId: "pin-b", sectionId: null }] });
});

test("onto a row: never under itself, its own descendant, or its current parent", () => {
  assert.equal(drop("loose", "thread:loose").kind, "rejected");
  assert.equal(drop("loose", "thread:grandkid").kind, "rejected");
  assert.equal(drop("kid", "thread:loose").kind, "rejected");
});

test("onto a group in Custom: leave the parent and take the group's section", () => {
  assert.deepEqual(drop("loose", "section:s2"), { kind: "apply", actions: [{ kind: "update", threadId: "loose", sectionId: "s2" }] });
  assert.deepEqual(drop("kid", "threads"), { kind: "apply", actions: [{ kind: "update", threadId: "kid", parentThreadId: null, sectionId: null }] });
  assert.deepEqual(drop("filed", "section:s1"), { kind: "unchanged" });
  assert.deepEqual(drop("pin-a", "section:s1"), { kind: "apply", actions: [{ kind: "unpin", threadId: "pin-a" }, { kind: "update", threadId: "pin-a", sectionId: "s1" }] });
});

test("onto Pinned: pin, leaving the parent first", () => {
  assert.deepEqual(drop("loose", "pinned"), { kind: "apply", actions: [{ kind: "pin", threadId: "loose" }] });
  assert.deepEqual(drop("kid", "pinned"), { kind: "apply", actions: [{ kind: "update", threadId: "kid", parentThreadId: null }, { kind: "pin", threadId: "kid" }] });
  assert.deepEqual(drop("pin-a", "pinned"), { kind: "unchanged" });
});

test("a row's edge in Pinned reorders pinned threads", () => {
  assert.deepEqual(drop("pin-a", "edge:after:pin-b"), { kind: "apply", actions: [{ kind: "reorderPinned", threadId: "pin-a", previousThreadId: "pin-b", nextThreadId: "pin-c" }] });
  assert.deepEqual(drop("pin-c", "edge:before:pin-a"), { kind: "apply", actions: [{ kind: "reorderPinned", threadId: "pin-c", previousThreadId: null, nextThreadId: "pin-a" }] });
  assert.deepEqual(drop("pin-a", "edge:before:pin-b"), { kind: "unchanged" });
  // An unpinned thread on a pinned row's edge pins it.
  assert.deepEqual(drop("loose", "edge:after:pin-b"), { kind: "apply", actions: [{ kind: "pin", threadId: "loose" }] });
  // Elsewhere an edge means the row's group.
  assert.deepEqual(drop("loose", "edge:before:filed"), { kind: "apply", actions: [{ kind: "update", threadId: "loose", sectionId: "s1" }] });
});

test("By project: a thread stays in its project; groups never change sections", () => {
  assert.equal(drop("loose", "project:p2", { organizationMode: "project" }).kind, "rejected");
  assert.equal(drop("loose", "threads", { organizationMode: "project" }).kind, "rejected");
  assert.deepEqual(drop("kid", "project:p1", { organizationMode: "project" }), { kind: "apply", actions: [{ kind: "update", threadId: "kid", parentThreadId: null }] });
  assert.deepEqual(drop("loose", "project:p1", { organizationMode: "project" }), { kind: "unchanged" });
  assert.deepEqual(drop("mine", "threads", { organizationMode: "project" }), { kind: "unchanged" });
});

test("By machine: a group drop only leaves the parent or unpins", () => {
  assert.deepEqual(drop("kid", "machine:no-machine", { organizationMode: "machine" }), { kind: "apply", actions: [{ kind: "update", threadId: "kid", parentThreadId: null }] });
  assert.deepEqual(drop("pin-a", "machine:no-machine", { organizationMode: "machine" }), { kind: "apply", actions: [{ kind: "unpin", threadId: "pin-a" }] });
});

test("group headers reorder the organization's top-level order, landing after the target when moving down", () => {
  const keys = ["pinned", "section:s1", "section:s2", "threads"];
  assert.deepEqual(reorderGroups(prefs(), keys, "section:s1", "section:s2"), { key: "manualSectionOrder", value: ["pinned", "section:s2", "section:s1", "threads"] });
  assert.deepEqual(reorderGroups(prefs(), keys, "threads", "pinned"), { key: "manualSectionOrder", value: ["threads", "pinned", "section:s1", "section:s2"] });
  assert.equal(reorderGroups(prefs(), keys, "threads", "threads"), null);
  assert.deepEqual(reorderGroups(prefs({ organizationMode: "project" }), ["project:a", "project:b"], "project:b", "project:a"), { key: "sectionOrder", value: ["pinned", "project:b", "project:a", "threads"] });
  assert.deepEqual(reorderGroups(prefs({ organizationMode: "machine" }), ["machine:h1", "machine:no-machine"], "machine:h1", "threads"), { key: "machineSectionOrder", value: ["pinned", "machine:no-machine", "threads", "machine:h1"] });
});
