import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { ownerOf, type BotDraft } from "@arthurnw/bb-shared/bots";
import { botDraftSchema } from "@arthurnw/bb-shared/bots/schema";
import { BotStore, MIGRATIONS, sha256, type SqlDb } from "./bot-store.ts";
import { feedSort, groupKeys, groupThreads, moveBefore, placeThread, sortFeed, wouldCycle } from "./list-model.ts";

function openStore() {
  const db = new DatabaseSync(":memory:");
  for (const statement of MIGRATIONS) db.exec(statement);
  let clock = 1000;
  return { db, store: new BotStore(db as unknown as SqlDb, () => clock++) };
}
const draft = (name: string, extra: Partial<BotDraft> = {}): BotDraft => botDraftSchema.parse({ name, ...extra });

test("bots are created in order, renamed, reordered, and reloaded from SQLite", () => {
  const { db, store } = openStore();
  const a = store.save(undefined, draft("Engineer"));
  const b = store.save(undefined, draft("Researcher", { starterPrompt: "/skill:research " }));
  assert.deepEqual(store.list().map((bot) => bot.name), ["Engineer", "Researcher"]);
  store.save(a.id, draft("Builder"));
  store.reorder([b.id]);
  const reloaded = new BotStore(db as unknown as SqlDb);
  assert.deepEqual(reloaded.list().map((bot) => [bot.name, bot.position]), [["Researcher", 0], ["Builder", 1]]);
  assert.equal(reloaded.get(b.id)?.starterPrompt, "/skill:research ");
});

test("bot names are unique regardless of case", () => {
  const { store } = openStore();
  const a = store.save(undefined, draft("Writer"));
  assert.throws(() => store.save(undefined, draft("writer")), /already exists/);
  assert.doesNotThrow(() => store.save(a.id, draft("WRITER")));
});

test("memory saves only against the sha it was read with", () => {
  const { store } = openStore();
  const bot = store.save(undefined, draft("Writer"));
  const first = store.memory(bot.id);
  assert.equal(first.sha256, sha256(""));
  store.setMemory(bot.id, "- prefers short PRs", first.sha256);
  assert.throws(() => store.setMemory(bot.id, "- stale", first.sha256), /changed since/);
  assert.equal(store.memory(bot.id).content, "- prefers short PRs");
});

test("deleting a bot keeps its bindings but stops them resolving, and they do not inherit again", () => {
  const { store } = openStore();
  const a = store.save(undefined, draft("A"));
  const b = store.save(undefined, draft("B"));
  store.bind("parent", b.id, "mention");
  store.bind("t1", a.id, "mention");
  store.delete(a.id);
  assert.equal(store.binding("t1"), null);
  assert.equal(store.hasBinding("t1"), true);
  assert.equal(ownerOf(store, { id: "t1", parentThreadId: "parent", sourceThreadId: null }), null);
  assert.deepEqual(store.threadBots(), { parent: b.id });
});

test("owner resolution: own binding, then parent, then fork source; detaching stops inheritance", () => {
  const { store } = openStore();
  const a = store.save(undefined, draft("A"));
  const b = store.save(undefined, draft("B"));
  store.bind("p", a.id, "mention");
  store.bind("s", b.id, "mention");
  assert.equal(ownerOf(store, { id: "c", parentThreadId: "p", sourceThreadId: "s" }), a.id);
  assert.equal(ownerOf(store, { id: "c", parentThreadId: null, sourceThreadId: "s" }), b.id);
  store.detach("c");
  assert.equal(ownerOf(store, { id: "c", parentThreadId: "p", sourceThreadId: "s" }), null);
  store.bind("c", b.id, "assign");
  assert.equal(store.detached("c"), false);
  assert.equal(ownerOf(store, { id: "c", parentThreadId: "p", sourceThreadId: null }), b.id);
});

test("avatar slots are unique, reused after delete, and backfilled for old rows", () => {
  const { db, store } = openStore();
  const a = store.save(undefined, draft("A"));
  const b = store.save(undefined, draft("B"));
  assert.deepEqual([a.avatarSlot, b.avatarSlot], [0, 1]);
  store.delete(a.id);
  assert.equal(store.save(undefined, draft("C")).avatarSlot, 0);
  db.prepare("UPDATE bots SET avatar_slot = NULL WHERE id = ?").run(b.id);
  const reloaded = new BotStore(db as unknown as SqlDb);
  assert.equal(reloaded.get(b.id)!.avatarSlot, 1);
});

test("avatars must be small image data URLs", () => {
  const { store } = openStore();
  const bot = store.save(undefined, draft("A"));
  assert.equal(store.setAvatar(bot.id, "data:image/webp;base64,AAAA").avatar, "data:image/webp;base64,AAAA");
  assert.throws(() => store.setAvatar(bot.id, "data:image/svg+xml;base64,AAAA"), /PNG, JPEG, or WebP/);
  assert.throws(() => store.setAvatar(bot.id, `data:image/png;base64,${"A".repeat(200_000)}`), /small/);
  assert.equal(store.setAvatar(bot.id, null).avatar, null);
});

test("group order keeps saved keys, drops stale ones, and appends new bots then sections", () => {
  assert.deepEqual(groupKeys(["section:s1", "bot:gone", "bot:b2", "section:s1"], ["b1", "b2"], ["s1", "s2"]),
    ["section:s1", "bot:b2", "bot:b1", "section:s2"]);
  assert.deepEqual(moveBefore(["bot:a", "bot:b", "section:c"], "section:c", "bot:a"), ["section:c", "bot:a", "bot:b"]);
  assert.deepEqual(moveBefore(["bot:a", "bot:b"], "bot:a", "bot:missing" as "bot:x"), ["bot:b", "bot:a"]);
});

test("placement: pinned alone, bot and section both, else Threads", () => {
  assert.deepEqual(placeThread({ pinned: true, botId: "b", sectionId: "s" }), ["pinned"]);
  assert.deepEqual(placeThread({ pinned: false, botId: "b", sectionId: "s" }), ["bot:b", "section:s"]);
  assert.deepEqual(placeThread({ pinned: false, botId: null, sectionId: null }), ["threads"]);
});

test("reparenting under a descendant is a cycle", () => {
  const parents: Record<string, string | null> = { a: null, b: "a", c: "b" };
  const parentOf = (id: string) => parents[id] ?? null;
  assert.equal(wouldCycle("a", "c", parentOf), true);
  assert.equal(wouldCycle("c", "a", parentOf), false);
});

test("children nest under their parent's group; a child with a bot also shows under the bot", () => {
  const t = (id: string, parentThreadId: string | null, extra: { botId?: string; sectionId?: string; pinned?: boolean } = {}) =>
    ({ id, parentThreadId, pinned: extra.pinned ?? false, botId: extra.botId ?? null, sectionId: extra.sectionId ?? null });
  const groups = groupThreads([t("p", null, { sectionId: "s" }), t("c", "p", { botId: "b" }), t("g", "c"), t("orphan", "gone")]);
  const ids = (key: string) => (groups.get(key as "threads") ?? []).map((row) => row.id).sort();
  assert.deepEqual(ids("section:s"), ["c", "g", "p"]);
  assert.deepEqual(ids("bot:b"), ["c", "g"]);
  assert.deepEqual(ids("threads"), ["orphan"]);
});

test("feed sort: stored choice, else the built-in list's sort; newest first", () => {
  assert.equal(feedSort(null, "created"), "created");
  assert.equal(feedSort(null, "alpha"), "updated");
  assert.equal(feedSort("attention", "created"), "attention");
  const rows = [{ id: "a", createdAt: 1, updatedAt: 9, latestAttentionAt: 5 }, { id: "b", createdAt: 2, updatedAt: 3, latestAttentionAt: 7 }];
  assert.deepEqual(sortFeed(rows, "updated").map((r) => r.id), ["a", "b"]);
  assert.deepEqual(sortFeed(rows, "attention").map((r) => r.id), ["b", "a"]);
  assert.deepEqual(sortFeed(rows, "created").map((r) => r.id), ["b", "a"]);
});

test("old drafts default to writable memory", () => {
  const { db, store } = openStore();
  const bot = store.save(undefined, draft("Old"));
  const { memoryWrites: _, ...legacy } = bot;
  db.prepare("UPDATE bots SET draft_json = ? WHERE id = ?").run(JSON.stringify({ ...legacy, memory: undefined }), bot.id);
  assert.equal(new BotStore(db as unknown as SqlDb).get(bot.id)!.memoryWrites, true);
});
