import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyMemoryChange, draftBotId, draftWithBot, FACT_MAX, filterBots, findBotMention, handoffSource, hasNoBotMarker, NO_BOT_TEXT, withBotMention, INSTRUCTION_BUDGET, INSTRUCTIONS_MAX, MEMORY_MAX, MemoryError, NAME_MAX,
  renderInstructions, type Bot,
} from "./bots.ts";
import { memoryToolSchema } from "./bots.schema.ts";

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
  const bots = [{ name: "Code Reviewer" }, { name: "Writer" }] as Bot[];
  assert.deepEqual(filterBots(bots, "rev code").map((bot) => bot.name), ["Code Reviewer"]);
  assert.equal(hasNoBotMarker([{ type: "text", text: NO_BOT_TEXT, visibility: "agent-only" }]), true);
  assert.equal(hasNoBotMarker([{ type: "text", text: NO_BOT_TEXT }]), false);
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


test("read-only memory is marked in the instructions", () => {
  assert.match(renderInstructions({ name: "W", instructions: "", memory: "- a", memoryWrites: false }), /## Bot memory \(read-only\)/);
});
