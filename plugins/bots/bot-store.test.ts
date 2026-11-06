import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { GALLERY_IDS, galleryAvatar, galleryId, ownerOf, type BotDraft } from "@arthurnw/bb-shared/bots";
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

test("avatars must be known gallery ids or small image data URLs", () => {
  const { store } = openStore();
  const bot = store.save(undefined, draft("A"));
  assert.equal(store.setAvatar(bot.id, "gallery:mochi").avatar, "gallery:mochi");
  assert.throws(() => store.setAvatar(bot.id, "gallery:blue"), /built-in avatar/);
  assert.throws(() => store.setAvatar(bot.id, "gallery:"), /built-in avatar/);
  assert.equal(store.setAvatar(bot.id, "data:image/webp;base64,AAAA").avatar, "data:image/webp;base64,AAAA");
  assert.throws(() => store.setAvatar(bot.id, "data:image/svg+xml;base64,AAAA"), /PNG, JPEG, or WebP/);
  assert.throws(() => store.setAvatar(bot.id, `data:image/png;base64,${"A".repeat(200_000)}`), /small/);
  assert.equal(store.setAvatar(bot.id, null).avatar, null);
});

// Two-frame and one-frame 4×4 GIFs written by Pillow.
const ANIMATED_GIF = "data:image/gif;base64,R0lGODlhBAAEAIEAAP8AAAAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQACgAAACwAAAAABAAEAAAICQABCBxIsCCAgAAh+QQBCgABACwAAAAABAAEAIEAAP8AAAAAAAAAAAAICQABCBxIsCCAgAA7";
const STILL_GIF = "data:image/gif;base64,R0lGODdhBAAEAIEAAP8AAAAAAAAAAAAAACwAAAAABAAEAAAICQABCBxIsCCAgAA7";
const STILL = "data:image/webp;base64,AAAA";

test("an animated upload is stored apart from the bot and replaced or removed with the avatar", () => {
  const { db, store } = openStore();
  const bot = store.save(undefined, draft("Dancer"));
  const set = store.setAvatar(bot.id, STILL, ANIMATED_GIF);
  assert.equal(set.avatar, STILL);
  assert.match(set.avatarAnimation ?? "", /^[0-9a-f]{16}$/);
  assert.equal(store.animation(bot.id), ANIMATED_GIF);
  const reloaded = new BotStore(db as unknown as SqlDb);
  assert.equal(reloaded.get(bot.id)?.avatarAnimation, set.avatarAnimation);
  assert.equal(reloaded.animation(bot.id), ANIMATED_GIF);
  assert.equal(store.setAvatar(bot.id, "gallery:bean").avatarAnimation, null);
  assert.equal(store.animation(bot.id), null);
  store.setAvatar(bot.id, STILL, ANIMATED_GIF);
  store.delete(bot.id);
  assert.deepEqual(db.prepare("SELECT bot_id FROM bot_avatar_animations").all(), []);
});

test("an animated upload must be an animation within the cap, with a still frame", () => {
  const { store } = openStore();
  const bot = store.save(undefined, draft("Dancer"));
  assert.throws(() => store.setAvatar(bot.id, null, ANIMATED_GIF), /still first frame/);
  assert.throws(() => store.setAvatar(bot.id, "gallery:bean", ANIMATED_GIF), /still first frame/);
  assert.throws(() => store.setAvatar(bot.id, STILL, STILL_GIF), /not an animated/);
  assert.throws(() => store.setAvatar(bot.id, STILL, ANIMATED_GIF.replace("image/gif", "image/webp")), /not an animated/);
  assert.throws(() => store.setAvatar(bot.id, STILL, "data:image/svg+xml;base64,AAAA"), /at most 1 MB/);
  assert.throws(() => store.setAvatar(bot.id, STILL, `data:image/gif;base64,${"A".repeat(1_400_000)}`), /at most 1 MB/);
  assert.equal(store.get(bot.id)?.avatarAnimation, null);
});

test("new bots get a gallery avatar no other bot uses until every one is taken", () => {
  const { db, store } = openStore();
  const avatars = GALLERY_IDS.map((_, i) => store.save(undefined, draft(`Bot ${i}`)).avatar);
  assert.deepEqual([...avatars].sort(), GALLERY_IDS.map(galleryAvatar).sort());
  assert.ok(galleryId(store.save(undefined, draft("Extra")).avatar));
  const reloaded = new BotStore(db as unknown as SqlDb);
  assert.deepEqual(reloaded.list().slice(0, GALLERY_IDS.length).map((bot) => bot.avatar), avatars);
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

test("the pane avatar corner defaults to top-right, saves, and reloads", () => {
  const { db, store } = openStore();
  const bot = store.save(undefined, draft("Corner"));
  assert.equal(bot.avatarCorner, "top-right");
  assert.equal(store.save(bot.id, draft("Corner", { avatarCorner: "bottom-left" })).avatarCorner, "bottom-left");
  assert.equal(new BotStore(db as unknown as SqlDb).get(bot.id)!.avatarCorner, "bottom-left");
  store.save(bot.id, draft("Corner", { avatarCorner: "off" }));
  assert.equal(new BotStore(db as unknown as SqlDb).get(bot.id)!.avatarCorner, "off");
});

test("old drafts default the pane avatar corner to top-right", () => {
  const { db, store } = openStore();
  const bot = store.save(undefined, draft("Old", { avatarCorner: "top-left" }));
  const { avatarCorner: _, ...legacy } = bot;
  db.prepare("UPDATE bots SET draft_json = ? WHERE id = ?").run(JSON.stringify({ ...legacy, memory: undefined }), bot.id);
  assert.equal(new BotStore(db as unknown as SqlDb).get(bot.id)!.avatarCorner, "top-right");
});

test("drafts accept only the five corners", () => {
  assert.throws(() => draft("Bad", { avatarCorner: "middle" as BotDraft["avatarCorner"] }));
});
