import { z } from "zod";
import { ANIMATION_MAX_CHARS, AVATAR_CORNERS, AVATAR_MAX_CHARS, BOT_ENVIRONMENTS, BRIEF_MAX, DEFAULT_AVATAR_CORNER, INSTRUCTIONS_MAX, MAX_BOTS, NAME_MAX, STARTER_MAX, type Bot, type BotDraft } from "./bots.ts";
import { selectionSchema } from "./selection.schema.ts";

const permissionModeSchema = z.enum(["accept-edits", "auto", "full"]);

const draftFields = {
  name: z.string().trim().min(1).max(NAME_MAX),
  emoji: z.string().trim().max(16).default(""),
  instructions: z.string().max(INSTRUCTIONS_MAX).default(""),
  starterPrompt: z.string().max(STARTER_MAX).default(""),
  model: selectionSchema.nullable().default(null),
  permissionMode: permissionModeSchema.nullable().default(null),
  environment: z.enum(BOT_ENVIRONMENTS).nullable().default(null),
  projectId: z.string().min(1).nullable().default(null),
  avatarCorner: z.enum(AVATAR_CORNERS).default(DEFAULT_AVATAR_CORNER),
  workerModel: selectionSchema.nullable().default(null),
};
export const botDraftSchema: z.ZodType<BotDraft, unknown> = z.object(draftFields);
/** A new initiative bot's draft: an empty name means "name it from the brief". */
export const initiativeDraftSchema: z.ZodType<BotDraft, unknown> = z.object({ ...draftFields, name: z.string().trim().max(NAME_MAX).default("") });

export const botSchema: z.ZodType<Bot, unknown> = z.object({
  id: z.string().min(1),
  position: z.number().int(),
  name: z.string(),
  emoji: z.string(),
  instructions: z.string(),
  starterPrompt: z.string(),
  model: selectionSchema.nullable(),
  permissionMode: permissionModeSchema.nullable(),
  environment: z.enum(BOT_ENVIRONMENTS).nullable(),
  projectId: z.string().nullable(),
  // Defaulted, like avatarAnimation, so a Launcher built against this schema still reads an older Bots.
  avatarCorner: z.enum(AVATAR_CORNERS).default(DEFAULT_AVATAR_CORNER),
  avatar: z.string().nullable(),
  // Defaulted so a Launcher built against this schema still reads an older Bots.
  avatarAnimation: z.string().nullable().default(null),
  avatarSlot: z.number().int().min(0).max(MAX_BOTS - 1),
  // Initiative fields are defaulted so a Launcher built against this schema still reads an older Bots.
  workerModel: selectionSchema.nullable().default(null),
  coordinatorThreadId: z.string().nullable().default(null),
  workspacePath: z.string().nullable().default(null),
  doneThreads: z.array(z.string()).default([]),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const botId = z.string().min(1);
const threadId = z.string().min(1);

export const botsRpcContract = {
  /** Null when the bot does not exist. */
  getBot: { input: z.object({ botId }), output: z.object({ bot: botSchema.nullable() }) },
  /** Initiative bots. */
  listBots: { input: z.object({}), output: z.object({ bots: z.array(botSchema).max(MAX_BOTS) }) },
  /** Persona bots from before initiative bots, kept for the Launcher's one-time import as Starters. */
  listPersonaBots: { input: z.object({}), output: z.object({ bots: z.array(botSchema).max(MAX_BOTS) }) },
  /** Creates a bot when `botId` is omitted. */
  saveBot: { input: z.object({ botId: botId.optional(), bot: botDraftSchema }), output: z.object({ bot: botSchema }) },
  /** Threads keep their bindings; they stop receiving the bot at their next session start. */
  deleteBot: { input: z.object({ botId }), output: z.object({ deleted: z.boolean() }) },
  /**
   * A square data URL made by the editor, or null to remove it. `animation` is
   * an animated upload as uploaded, with `avatar` its still first frame;
   * omitting it removes any earlier one.
   */
  setBotAvatar: {
    input: z.object({ botId, avatar: z.string().max(AVATAR_MAX_CHARS).nullable(), animation: z.string().max(ANIMATION_MAX_CHARS).nullable().optional() }),
    output: z.object({ bot: botSchema }),
  },
  /** The animated upload behind `Bot.avatarAnimation`; null when the bot has none. */
  getBotAvatarAnimation: { input: z.object({ botId }), output: z.object({ animation: z.string().nullable() }) },
  reorderBots: { input: z.object({ botIds: z.array(botId).max(MAX_BOTS) }), output: z.object({ bots: z.array(botSchema) }) },
  /** Only for a thread that has not started; a running session keeps its instructions. */
  assignThread: { input: z.object({ threadId, botId }), output: z.object({ botId }) },
  /** "No bot": clears the binding and stops inheritance from the parent or source. */
  detachThread: { input: z.object({ threadId }), output: z.object({ ok: z.literal(true) }) },
  threadBots: { input: z.object({}), output: z.object({ threads: z.record(z.string(), z.string()) }) },
  /** The thread's bot and the instructions a session starting now would get; null fields when it has none. */
  threadBot: { input: z.object({ threadId }), output: z.object({ botId: z.string().nullable(), source: z.enum(["own", "inherited", "none", "detached"]), instructions: z.string().nullable() }) },
  /** The Bots thread list's manual group order: "bot:<id>" and "section:<id>" keys. Unknown keys are ignored when drawn. */
  getListOrder: { input: z.object({}), output: z.object({ order: z.array(z.string().max(200)).max(500) }) },
  setListOrder: { input: z.object({ order: z.array(z.string().max(200)).max(500) }), output: z.object({ order: z.array(z.string()) }) },
};
