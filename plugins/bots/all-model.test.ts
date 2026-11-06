import { test } from "node:test";
import assert from "node:assert/strict";
import { compareThreads, organizeAll as organize, topLevelOrder, type AllItem, type AllPrefs, type AllThread, type OrganizeInput } from "./all-model.ts";

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
const organizeAll = (input: Partial<OrganizeInput<AllThread>> & Pick<OrganizeInput<AllThread>, "threads" | "prefs">) =>
  organize({ sections: [], projects: [{ id: "p1", name: "One", isPersonal: false }], hosts: [], ...input });
/** Thread ids, with [id, children] for a parent and { env: [label, ...] } for a worktree row. */
const ids = (items: readonly AllItem<AllThread>[]): unknown[] => items.map((item) => item.kind === "environment"
  ? { env: [item.label, ...ids(item.nodes.map((node) => ({ kind: "thread" as const, node })))] }
  : item.node.children.length ? [item.node.thread.id, ids(item.node.children)] : item.node.thread.id);
const layout = (groups: ReturnType<typeof organizeAll>) => groups.map((group) => [group.key, ids(group.roots)]);
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
  const pinnedOrder = (threads: AllThread[]) => ids(organizeAll({ threads, prefs: prefs() })[0]!.roots);
  assert.deepEqual(pinnedOrder([thread("b", { isPinned: true, pinnedAt: 2, pinSortKey: "b" }), thread("a", { isPinned: true, pinnedAt: 1, pinSortKey: "a" })]), ["a", "b"]);
  assert.deepEqual(pinnedOrder([thread("early", { isPinned: true, pinnedAt: 1 }), thread("late", { isPinned: true, pinnedAt: 2 })]), ["late", "early"]);
});

test("thread lifecycles choose active, archived, or both; hidden threads never show", () => {
  const threads = [thread("live"), thread("gone", { isArchived: true }), thread("helper", { isHidden: true })];
  const rows = (lifecycles: AllPrefs["threadLifecycles"]) => organizeAll({ threads, prefs: prefs({ threadLifecycles: lifecycles }), sections: [] }).at(-1)!.roots.map((item) => item.kind === "thread" ? item.node.thread.id : item.id);
  assert.deepEqual(rows(["active"]), ["live"]);
  assert.deepEqual(rows(["archived"]), ["gone"]);
  assert.deepEqual(rows(["active", "archived"]).sort(), ["gone", "live"]);
});

test("a thread in an unknown section files under Threads", () => {
  assert.deepEqual(layout(organizeAll({ threads: [thread("x", { sectionId: "deleted" })], prefs: prefs(), sections: [] })), [["threads", ["x"]]]);
});

test("a parent cycle still shows every thread once", () => {
  const threads = [thread("a", { parentThreadId: "b" }), thread("b", { parentThreadId: "a" })];
  assert.equal(JSON.stringify(layout(organizeAll({ threads, prefs: prefs() }))), JSON.stringify([["threads", [["a", ["b"]]]]]));
});

test("top-level order expands the anchor, drops unknown keys, and places missing entities", () => {
  assert.deepEqual(topLevelOrder(["pinned", "sections", "threads"], ["section:a", "section:b"], "sections"), ["pinned", "section:a", "section:b", "threads"]);
  assert.deepEqual(topLevelOrder(["section:b", "section:gone", "threads"], ["section:a", "section:b"], "sections"), ["pinned", "section:b", "section:a", "threads"]);
  assert.deepEqual(topLevelOrder(["threads", "pinned"], ["section:a"], "sections"), ["section:a", "threads", "pinned"]);
  assert.deepEqual(topLevelOrder([], ["section:a"], "sections"), ["pinned", "section:a", "threads"]);
});

const worktree = (id: string, name: string | null = null) => ({ id, name, branchName: `branch-${id}`, path: `/w/${id}`, isWorktree: true });

test("By project: one group per non-personal project in stored order, personal threads under Threads", () => {
  const projects = [{ id: "home", name: "Personal", isPersonal: true }, { id: "a", name: "A", isPersonal: false }, { id: "b", name: "B", isPersonal: false }, { id: "c", name: "Empty", isPersonal: false }];
  const threads = [
    thread("in-a", { projectId: "a" }), thread("in-b", { projectId: "b" }), thread("mine", { projectId: "home" }),
    thread("kid-elsewhere", { projectId: "b", parentThreadId: "in-a" }),
  ];
  const groups = organizeAll({ threads, projects, prefs: prefs({ organizationMode: "project", sectionOrder: ["threads", "project:b", "projects"] }) });
  assert.deepEqual(layout(groups), [["threads", ["mine"]], ["project:b", ["in-b"]], ["project:a", [["in-a", ["kid-elsewhere"]]]], ["project:c", []]]);
  assert.deepEqual(groups.map((group) => group.title), ["Threads", "B", "A", "Empty"]);
});

test("By project: Threads hides when no thread is personal", () => {
  const groups = organizeAll({ threads: [thread("x")], prefs: prefs({ organizationMode: "project" }) });
  assert.deepEqual(layout(groups), [["project:p1", ["x"]]]);
});

test("By machine: known machines in order, unknown ones by id, then No machine; Threads only without machines", () => {
  const hosts = [{ id: "h2", name: "Laptop" }, { id: "h1", name: "Desk" }, { id: "h3", name: "Idle box" }];
  const threads = [
    thread("on-h1", { host: { id: "h1", name: "Desk" } }), thread("on-h2", { host: { id: "h2", name: "Laptop" } }),
    thread("on-zz", { host: { id: "zz", name: "?" } }), thread("on-aa", { host: { id: "aa", name: "?" } }), thread("nowhere"),
  ];
  const groups = organizeAll({ threads, hosts, prefs: prefs({ organizationMode: "machine" }) });
  assert.deepEqual(layout(groups), [["machine:h2", ["on-h2"]], ["machine:h1", ["on-h1"]], ["machine:h3", []], ["machine:aa", ["on-aa"]], ["machine:zz", ["on-zz"]], ["machine:no-machine", ["nowhere"]]]);
  assert.deepEqual(groups.map((group) => group.title), ["Laptop", "Desk", "Idle box", "Unknown machine", "Unknown machine", "No machine"]);
  assert.deepEqual(layout(organizeAll({ threads: [], prefs: prefs({ organizationMode: "machine" }) })), [["threads", []]]);
});

test("worktree grouping: auto groups everywhere except Custom; true always; false never", () => {
  const threads = [thread("w1", { environment: worktree("e1", "Feature") }), thread("w2", { environment: worktree("e1", "Feature") }), thread("solo")];
  const rows = (over: Partial<AllPrefs>) => organizeAll({ threads, prefs: prefs(over) }).at(-1)!.roots;
  assert.deepEqual(ids(rows({ organizationMode: "project" })), ["solo", { env: ["Feature", "w2", "w1"] }]);
  assert.deepEqual(ids(rows({ organizationMode: "chronological" })), ["solo", "w2", "w1"]);
  assert.deepEqual(ids(rows({ organizationMode: "chronological", environmentGrouping: true })), ["solo", { env: ["Feature", "w2", "w1"] }]);
  assert.deepEqual(ids(rows({ organizationMode: "project", environmentGrouping: false })), ["solo", "w2", "w1"]);
});

test("worktree grouping needs two worktree siblings and labels by name, then branch", () => {
  const plain = { id: "e9", name: null, branchName: null, path: "/repo", isWorktree: false };
  const threads = [
    thread("one", { environment: worktree("e1") }), thread("p1", { environment: plain }), thread("p2", { environment: plain }),
    thread("b1", { environment: worktree("e2") }), thread("b2", { environment: worktree("e2") }),
  ];
  assert.deepEqual(ids(organizeAll({ threads, prefs: prefs({ environmentGrouping: true }) }).at(-1)!.roots), [{ env: ["branch-e2", "b2", "b1"] }, "p2", "p1", "one"]);
});

test("children in their parent's worktree stay under it; siblings in another worktree group", () => {
  const threads = [
    thread("parent", { environment: worktree("e1", "Main") }),
    thread("same-1", { parentThreadId: "parent", environment: worktree("e1", "Main") }),
    thread("same-2", { parentThreadId: "parent", environment: worktree("e1", "Main") }),
    thread("other-1", { parentThreadId: "parent", environment: worktree("e2", "Side") }),
    thread("other-2", { parentThreadId: "parent", environment: worktree("e2", "Side") }),
  ];
  assert.deepEqual(ids(organizeAll({ threads, prefs: prefs({ environmentGrouping: true }) }).at(-1)!.roots),
    [["parent", [{ env: ["Side", "other-2", "other-1"] }, "same-2", "same-1"]]]);
});

test("in Custom, worktree rows never span sections", () => {
  const threads = [thread("a", { environment: worktree("e1"), sectionId: "s1" }), thread("b", { environment: worktree("e1") })];
  assert.deepEqual(layout(organizeAll({ threads, sections: [{ id: "s1", name: "S" }], prefs: prefs({ environmentGrouping: true }) })), [["section:s1", ["a"]], ["threads", ["b"]]]);
});

test("pinned threads group by worktree too, in pin order", () => {
  const threads = [
    thread("pa", { isPinned: true, pinnedAt: 1, environment: worktree("e1", "W") }),
    thread("pb", { isPinned: true, pinnedAt: 3, environment: worktree("e1", "W") }),
    thread("pc", { isPinned: true, pinnedAt: 2 }),
  ];
  assert.deepEqual(ids(organizeAll({ threads, prefs: prefs({ environmentGrouping: true }) })[0]!.roots), [{ env: ["W", "pb", "pa"] }, "pc"]);
});

test("by read status: unread idle roots first, keeping the sort; worktree grouping is off", () => {
  const threads = [
    thread("read-new", { latestAttentionAt: 50, environment: worktree("e1") }),
    thread("unread-old", { latestAttentionAt: 10, isUnread: true, environment: worktree("e1") }),
    thread("unread-new", { latestAttentionAt: 40, isUnread: true }),
    thread("unread-running", { status: "active", isUnread: true, createdAt: 1 }),
    thread("kid-unread", { parentThreadId: "read-new", isUnread: true }),
  ];
  const rows = ids(organizeAll({ threads, prefs: prefs({ groupByReadStatus: true, environmentGrouping: true }) }).at(-1)!.roots);
  assert.deepEqual(rows, ["unread-new", "unread-old", "unread-running", ["read-new", ["kid-unread"]]]);
});

test("by read status: the open thread keeps the unread state it had when opened", () => {
  const threads = [thread("opened", { latestAttentionAt: 10 }), thread("other", { latestAttentionAt: 20 })];
  const rows = (readOverride: OrganizeInput<AllThread>["readOverride"]) => ids(organizeAll({ threads, readOverride, prefs: prefs({ groupByReadStatus: true }) }).at(-1)!.roots);
  assert.deepEqual(rows(null), ["other", "opened"]);
  assert.deepEqual(rows({ threadId: "opened", isUnread: true }), ["opened", "other"]);
});
