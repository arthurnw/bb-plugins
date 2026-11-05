// Frontend-safe bot model and pure helpers. Zod schemas live in
// bots.schema.ts and SQLite in bot-store.ts so the app bundle stays small.
import type { ModelSelection } from "./selection.ts";

export const MAX_BOTS = 30;
export const NAME_MAX = 40;
export const INSTRUCTIONS_MAX = 2000;
export const STARTER_MAX = 2000;
/** Stored memory always fits whole in the 4,096-character instruction budget. */
export const MEMORY_MAX = 1800;
export const FACT_MAX = 300;
/** `PluginAgentConfiguration.instructions` is truncated past this. */
export const INSTRUCTION_BUDGET = 4096;
export const MENTION_PROVIDER = "bot";
export const MEMORY_TOOL = "bot_memory";
/** A 128 px WebP is 5–20 KB as a data URL; this leaves room for PNG fallbacks. */
export const AVATAR_MAX_CHARS = 120_000;
export const AVATAR_SIZE = 128;
export const AVATAR_DATA_URL = /^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/=]+$/;
/**
 * Icons can only be registered during app setup, so each bot holds one of
 * MAX_BOTS fixed icon names. A slot is reused after its bot is deleted.
 */
export const botIconName = (slot: number) => `launcher-bot-${slot}`;

export type PermissionMode = "accept-edits" | "auto" | "full";
// "No project" as the bot's project covers the personal workspace.
export const BOT_ENVIRONMENTS = ["named-worktree", "existing-branch", "checkout"] as const;
export type BotEnvironment = (typeof BOT_ENVIRONMENTS)[number];

/** What the user edits. Null fields keep the composer's current value. */
export interface BotDraft {
  name: string;
  emoji: string;
  instructions: string;
  starterPrompt: string;
  model: ModelSelection | null;
  permissionMode: PermissionMode | null;
  environment: BotEnvironment | null;
  projectId: string | null;
  /** Off: agents can still read memory, but `bot_memory` refuses changes. */
  memoryWrites: boolean;
}
export interface Bot extends BotDraft {
  id: string;
  position: number;
  /** A square image as a data URL, or null to show the emoji or initial. */
  avatar: string | null;
  avatarSlot: number;
  memory: string;
  createdAt: number;
  updatedAt: number;
}

/** Text for places that cannot show the avatar icon. */
export const botLabel = (bot: Pick<Bot, "emoji" | "name">) => bot.emoji ? `${bot.emoji} ${bot.name}` : bot.name;

/** Case-insensitive match of every query word against a bot's name. */
export function filterBots(bots: readonly Bot[], query: string): Bot[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return bots.filter((bot) => words.every((word) => bot.name.toLowerCase().includes(word)));
}

/** Agent-only block the Launcher adds when the user picks "No bot" for a handoff that would otherwise inherit one. */
export const NO_BOT_TEXT = "The user started this thread without a Launcher bot.";

/** How a thread got its bot: picked with a mention, inherited, or assigned before its first turn. */
export type BindingSource = "mention" | "inherit" | "assign";

export function renderInstructions(bot: Pick<Bot, "name" | "instructions" | "memory"> & { memoryWrites?: boolean }): string {
  const parts = [
    `# Launcher bot: ${oneLine(bot.name)}`,
    `This thread runs as the "${oneLine(bot.name)}" bot. Its instructions add to the user's and the project's instructions and do not override them.`,
  ];
  if (bot.instructions.trim()) parts.push(`## Bot instructions\n${bot.instructions.trim()}`);
  parts.push(`## Bot memory${bot.memoryWrites === false ? " (read-only)" : ""}\n${bot.memory.trim() || "(empty)"}`);
  return parts.join("\n\n");
}

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

// Memory is a list of single-line facts, one per line.
export type MemoryChange =
  | { action: "append"; fact: string }
  | { action: "forget"; fact: string }
  | { action: "overwrite"; content: string };

export class MemoryError extends Error {}

const normalizeFact = (fact: string) => oneLine(fact).replace(/^[-*]\s+/, "");
const factKey = (fact: string) => normalizeFact(fact).toLowerCase();
const factLines = (memory: string) => memory.split("\n").map((line) => line.trim()).filter(Boolean);

/** Applies one change and returns the new memory, or throws `MemoryError` with a message for the agent. */
export function applyMemoryChange(memory: string, change: MemoryChange): string {
  let next: string;
  if (change.action === "overwrite") {
    next = change.content.trim();
  } else {
    const fact = normalizeFact(change.fact);
    if (!fact) throw new MemoryError("The fact is empty.");
    const lines = factLines(memory);
    const key = factKey(fact);
    const index = lines.findIndex((line) => factKey(line) === key);
    if (change.action === "append") {
      if (fact.length > FACT_MAX) throw new MemoryError(`A fact is limited to ${FACT_MAX} characters.`);
      if (index !== -1) return memory;
      next = [...lines, `- ${fact}`].join("\n");
    } else {
      if (index === -1) throw new MemoryError("No fact matches. Read the memory and pass one line exactly.");
      next = lines.filter((_, i) => i !== index).join("\n");
    }
  }
  if (next.length > MEMORY_MAX) {
    throw new MemoryError(`Memory would be ${next.length} characters; the limit is ${MEMORY_MAX}. Read it, condense it, and overwrite.`);
  }
  return next;
}

// Mentions reach dispatch hooks as `{ kind: "plugin", pluginId, itemId }`; the
// host composes `itemId` as "<providerId>:<itemId>".
type MentionResource = { kind: string; pluginId?: string; itemId?: string; threadId?: string };
type InputBlock = { type: string; text?: string; mentions?: readonly { start: number; resource: MentionResource }[] };

export function botMentionId(resource: MentionResource, pluginId: string): string | null {
  if (resource.kind !== "plugin" || resource.pluginId !== pluginId || !resource.itemId) return null;
  const prefix = `${MENTION_PROVIDER}:`;
  return resource.itemId.startsWith(prefix) ? resource.itemId.slice(prefix.length) : null;
}

/** The first bot this plugin owns that is mentioned anywhere in the message, in reading order. */
export function findBotMention(blocks: readonly InputBlock[], pluginId: string, known: (botId: string) => boolean): string | null {
  for (const block of blocks) {
    if (block.type !== "text") continue;
    const mentions = [...(block.mentions ?? [])].sort((a, b) => a.start - b.start);
    for (const mention of mentions) {
      const id = botMentionId(mention.resource, pluginId);
      if (id !== null && known(id)) return id;
    }
  }
  return null;
}

type RequestBlock = { type: string; text?: string; mentions?: { start: number; end: number; resource: unknown }[] } & Record<string, unknown>;

/**
 * Puts a mention of `bot` at the start of the first message unless it already
 * mentions that bot. Offsets of later mentions in that block shift with it.
 */
export function withBotMention<B extends RequestBlock>(blocks: readonly B[], bot: Pick<Bot, "id" | "name" | "avatarSlot">, pluginId: string): B[] {
  if (findBotMention(blocks as readonly InputBlock[], pluginId, (id) => id === bot.id) === bot.id) return [...blocks];
  const label = bot.name;
  const token = `@${label}`;
  const mention = { start: 0, end: token.length, resource: { kind: "plugin", pluginId, itemId: `${MENTION_PROVIDER}:${bot.id}`, label, icon: botIconName(bot.avatarSlot) } };
  const index = blocks.findIndex((block) => block.type === "text");
  if (index === -1) return [{ type: "text", text: token, mentions: [mention] } as unknown as B, ...blocks];
  const first = blocks[index]!;
  const shift = token.length + 1;
  const next = { ...first, text: `${token} ${first.text ?? ""}`, mentions: [mention, ...(first.mentions ?? []).map((m) => ({ ...m, start: m.start + shift, end: m.end + shift }))] };
  return blocks.map((block, i) => (i === index ? next : block));
}

// The composer's draft shape (`ComposerDraft` in the app SDK), kept structural
// so the server and tests do not import the app bundle's types.
type DraftMention = { from: number; to: number; label: string; kind: string; pluginId?: string; provider?: string; id?: string; icon?: string | null };
type Draft<M extends DraftMention> = { text: string; mentions: readonly M[] };

const isOwnBot = (mention: DraftMention, pluginId: string) =>
  mention.kind === "plugin" && mention.pluginId === pluginId && mention.provider === MENTION_PROVIDER && !!mention.id;

/** The bot of the first bot pill in a composer draft, which is the one that binds the thread. */
export function draftBotId(draft: Draft<DraftMention>, pluginId: string): string | null {
  const first = [...draft.mentions].sort((a, b) => a.from - b.from).find((m) => isOwnBot(m, pluginId));
  return first?.id ?? null;
}

/**
 * Removes this plugin's bot pills (and the space after each), then puts `bot`'s
 * pill first. The starter prompt is added only when nothing else is left.
 */
export function draftWithBot<M extends DraftMention>(draft: Draft<M>, bot: Pick<Bot, "id" | "name" | "avatarSlot" | "starterPrompt"> | null, pluginId: string): { text: string; mentions: M[] } {
  let text = "";
  const mentions: M[] = [];
  let cursor = 0;
  for (const mention of [...draft.mentions].sort((a, b) => a.from - b.from)) {
    text += draft.text.slice(cursor, mention.from);
    cursor = mention.to;
    if (isOwnBot(mention, pluginId)) {
      if (draft.text[cursor] === " ") cursor++;
      continue;
    }
    mentions.push({ ...mention, from: text.length, to: text.length + (mention.to - mention.from) });
    text += draft.text.slice(mention.from, mention.to);
  }
  text += draft.text.slice(cursor);
  if (!bot) return { text, mentions };
  const token = `@${bot.name}`;
  const rest = text.trim() === "" && mentions.length === 0 ? bot.starterPrompt : text;
  const shift = token.length + 1;
  const pill = { from: 0, to: token.length, label: bot.name, kind: "plugin", pluginId, provider: MENTION_PROVIDER, id: bot.id, icon: botIconName(bot.avatarSlot) } as M;
  return { text: `${token} ${rest}`, mentions: [pill, ...mentions.map((m) => ({ ...m, from: m.from + shift, to: m.to + shift }))] };
}

export const hasNoBotMarker = (blocks: readonly { type: string; text?: string; visibility?: string }[]) =>
  blocks.some((block) => block.type === "text" && block.visibility === "agent-only" && block.text === NO_BOT_TEXT);

// Handoffs create a top-level thread with no parent or source id, so the
// source is read from the first message:
// - BB's "Continue in new thread" starts with "Continue from @thread:<id>".
// - The Launcher's handoff starts with an @thread mention.
const NATIVE_HANDOFF = /^\s*Continue from @thread:([A-Za-z0-9_-]+)/;

export function handoffSource(blocks: readonly InputBlock[], leadingThreadMention: boolean): string | null {
  const first = blocks.find((block) => block.type === "text" && block.text?.trim());
  if (!first?.text) return null;
  const native = first.text.match(NATIVE_HANDOFF)?.[1];
  if (native) return native;
  if (!leadingThreadMention) return null;
  const leading = first.text.length - first.text.trimStart().length;
  const mention = first.mentions?.find((item) => item.start === leading);
  return mention?.resource.kind === "thread" ? mention.resource.threadId ?? null : null;
}

export interface OwnerLookup {
  /** Null for no binding and for a binding to a deleted bot. */
  binding(threadId: string): string | null;
  /** True for any binding row, including one to a deleted bot. */
  hasBinding(threadId: string): boolean;
  detached(threadId: string): boolean;
}

/**
 * The bot that owns a thread: its own binding, else its parent's, else its
 * fork source's. "No bot" chosen on the thread stops inheritance. One level
 * suffices because inherited owners are written back when threads are created.
 */
export function ownerOf(lookup: OwnerLookup, thread: { id: string; parentThreadId: string | null; sourceThreadId: string | null }): string | null {
  if (lookup.hasBinding(thread.id)) return lookup.binding(thread.id);
  if (lookup.detached(thread.id)) return null;
  for (const id of [thread.parentThreadId, thread.sourceThreadId]) {
    if (id === null) continue;
    const owner = lookup.binding(id);
    if (owner !== null) return owner;
  }
  return null;
}

/**
 * The plugin that owns bots. Plugin ids in mentions, RPC calls, and thread
 * origins resolve against it. Still "launcher" until bots move to their own plugin.
 */
export const BOTS_PLUGIN_ID = "launcher";
/** Plugins whose new threads the binding hook treats as started by the user's bot picker. */
export const TRUSTED_ORIGIN_PLUGINS = ["bots", "launcher"] as const;
