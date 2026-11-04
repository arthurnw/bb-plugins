import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { BotStore, MIGRATIONS, sha256, type SqlDb } from "./bot-store.ts";
import {
  applyMemoryChange, draftBotId, draftWithBot, FACT_MAX, filterBots, findBotMention, handoffSource, hasNoBotMarker, NO_BOT_TEXT, withBotMention, INSTRUCTION_BUDGET, INSTRUCTIONS_MAX, MEMORY_MAX, MemoryError, NAME_MAX,
  ownerOf, renderInstructions, type BotDraft,
} from "./bots.ts";
import { botDraftSchema, memoryToolSchema } from "./bots.schema.ts";

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

test("instructions fit the budget at maximum lengths", () => {
  const text = renderInstructions({ name: "N".repeat(NAME_MAX), instructions: "i".repeat(INSTRUCTIONS_MAX), memory: "m".repeat(MEMORY_MAX) });
  assert.ok(text.length <= INSTRUCTION_BUDGET, `${text.length} > ${INSTRUCTION_BUDGET}`);
  assert.match(renderInstructions({ name: "W", instructions: "", memory: "" }), /## Bot memory\n\(empty\)/);
});

test("memory changes: append dedupes, forget matches a line, overwrite and the cap", () => {
  let memory = applyMemoryChange("", { action: "append", fact: "Prefers  short PRs" });
  assert.equal(memory, "- Prefers short PRs");
  assert.equal(applyMemoryChange(memory, { action: "append", fact: "- prefers short prs" }), memory);
  memory = applyMemoryChange(memory, { action: "append", fact: "Uses pnpm" });
  assert.equal(applyMemoryChange(memory, { action: "forget", fact: "prefers short PRs" }), "- Uses pnpm");
  assert.throws(() => applyMemoryChange(memory, { action: "forget", fact: "nope" }), MemoryError);
  assert.throws(() => applyMemoryChange("", { action: "append", fact: "x".repeat(FACT_MAX + 1) }), MemoryError);
  const full = Array.from({ length: 21 }, (_, i) => `- ${"f".repeat(82)}${i}`).join("\n");
  assert.throws(() => applyMemoryChange(full, { action: "append", fact: "one more" }), /condense/);
  assert.equal(applyMemoryChange(full, { action: "overwrite", content: "  - condensed \n" }), "- condensed");
});

const pluginId = "launcher";
type Resource = { kind: string; pluginId?: string; itemId?: string; threadId?: string };
const text = (value: string, mentions: { start: number; resource: Resource }[] = []) =>
  ({ type: "text", text: value, mentions: mentions.map((m) => ({ ...m, end: m.start + 1 })) });

test("bot mentions: first known bot of this plugin wins, in reading order", () => {
  const known = (id: string) => id === "a" || id === "b";
  const block = text("@B and @A", [
    { start: 7, resource: { kind: "plugin", pluginId, itemId: "bot:a" } },
    { start: 0, resource: { kind: "plugin", pluginId, itemId: "bot:b" } },
  ]);
  assert.equal(findBotMention([block], pluginId, known), "b");
  const other = text("@x", [{ start: 0, resource: { kind: "plugin", pluginId: "bots-sidebar", itemId: "bot:a" } }]);
  assert.equal(findBotMention([other], pluginId, known), null);
  const deleted = text("@gone", [{ start: 0, resource: { kind: "plugin", pluginId, itemId: "bot:gone" } }]);
  assert.equal(findBotMention([deleted], pluginId, known), null);
  assert.equal(findBotMention([{ type: "image" }], pluginId, known), null);
});

test("handoff source: BB's native prefix, or a leading thread mention from the Launcher", () => {
  assert.equal(handoffSource([text("Continue from @thread:thr_1\n\nmore")], false), "thr_1");
  const launcher = text("  @t carry on", [{ start: 2, resource: { kind: "thread", threadId: "thr_2" } }]);
  assert.equal(handoffSource([launcher], true), "thr_2");
  assert.equal(handoffSource([launcher], false), null);
  const later = text("see @t", [{ start: 4, resource: { kind: "thread", threadId: "thr_3" } }]);
  assert.equal(handoffSource([later], true), null);
});

test("the memory tool schema is a plain object", () => {
  assert.deepEqual(memoryToolSchema.parse({ action: "read" }), { action: "read" });
  assert.throws(() => memoryToolSchema.parse({ action: "delete" }));
});

test("withBotMention prepends one pill, shifts later mentions, and is idempotent", () => {
  const bot = { id: "b1", name: "Probe", avatarSlot: 3 };
  const thread = { kind: "thread", threadId: "thr_1", label: "Source" };
  const blocks = [{ type: "text", text: "@Source carry on", mentions: [{ start: 0, end: 7, resource: thread }] }];
  const [first] = withBotMention(blocks, bot, pluginId);
  assert.equal(first!.text, "@Probe @Source carry on");
  assert.deepEqual(first!.mentions![0], { start: 0, end: 6, resource: { kind: "plugin", pluginId, itemId: "bot:b1", label: "Probe", icon: "launcher-bot-3" } });
  assert.equal(first!.text!.slice(first!.mentions![1]!.start, first!.mentions![1]!.end), "@Source");
  const again = withBotMention([first!], bot, pluginId);
  assert.equal(again[0]!.text, first!.text);
  assert.equal(findBotMention(again, pluginId, (id) => id === "b1"), "b1");
  const imageOnly = withBotMention([{ type: "image", url: "x" }], bot, pluginId);
  assert.deepEqual(imageOnly.map((block) => block.type), ["text", "image"]);
});

test("bot filter and the no-bot marker", () => {
  const { store } = openStore();
  store.save(undefined, draft("Code Reviewer"));
  store.save(undefined, draft("Writer"));
  assert.deepEqual(filterBots(store.list(), "rev code").map((bot) => bot.name), ["Code Reviewer"]);
  assert.equal(hasNoBotMarker([{ type: "text", text: NO_BOT_TEXT, visibility: "agent-only" }]), true);
  assert.equal(hasNoBotMarker([{ type: "text", text: NO_BOT_TEXT }]), false);
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

test("draftWithBot swaps the bot pill, keeps other mentions in place, and adds the starter only to an empty draft", () => {
  const probe = { id: "p", name: "Probe", avatarSlot: 0, starterPrompt: "/skill:research " };
  const writer = { id: "w", name: "Writer", avatarSlot: 1, starterPrompt: "" };
  const empty = draftWithBot({ text: "", mentions: [] }, probe, pluginId);
  assert.equal(empty.text, "@Probe /skill:research ");
  assert.equal(draftBotId(empty, pluginId), "p");
  const thread = { from: 7, to: 14, label: "Source", kind: "thread", threadId: "t" };
  const withThread = { text: "@Probe @Source go", mentions: [empty.mentions[0]!, thread] };
  const swapped = draftWithBot(withThread, writer, pluginId);
  assert.equal(swapped.text, "@Writer @Source go");
  assert.equal(swapped.text.slice(swapped.mentions[1]!.from, swapped.mentions[1]!.to), "@Source");
  assert.equal(draftBotId(swapped, pluginId), "w");
  const cleared = draftWithBot(swapped, null, pluginId);
  assert.equal(cleared.text, "@Source go");
  assert.deepEqual(cleared.mentions.map((m) => [m.from, m.to]), [[0, 7]]);
  const other = { from: 0, to: 4, label: "Bot", kind: "plugin", pluginId: "bots-sidebar", provider: "bot", id: "x" };
  assert.equal(draftBotId({ text: "@Bot hi", mentions: [other] }, pluginId), null);
});

import { feedSort, groupKeys, groupThreads, moveBefore, placeThread, sortFeed, wouldCycle } from "./list-model.ts";

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

test("read-only memory is marked in the instructions, and old drafts default to writable", () => {
  assert.match(renderInstructions({ name: "W", instructions: "", memory: "- a", memoryWrites: false }), /## Bot memory \(read-only\)/);
  const { db, store } = openStore();
  const bot = store.save(undefined, draft("Old"));
  const { memoryWrites: _, ...legacy } = bot;
  db.prepare("UPDATE bots SET draft_json = ? WHERE id = ?").run(JSON.stringify({ ...legacy, memory: undefined }), bot.id);
  assert.equal(new BotStore(db as unknown as SqlDb).get(bot.id)!.memoryWrites, true);
});
