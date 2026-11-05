import { defineRpcContract, type BbPluginApi, type NewThreadRequest } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { BotStore, BotStoreError, MIGRATIONS, type SqlDb } from "./bot-store.ts";
import {
  applyMemoryChange, BOT_MENTION_PLUGINS, BOTS_PLUGIN_ID, findBotMention, handoffSource, hasNoBotMarker, MemoryError, MEMORY_MAX, MEMORY_TOOL, MENTION_PROVIDER, NO_BOT_TEXT, ownerOf, renderInstructions,
  TRUSTED_ORIGIN_PLUGINS, withBotMention, withoutBotMentions,
} from "@arthurnw/bb-shared/bots";
import { botsRpcContract, memoryToolSchema } from "@arthurnw/bb-shared/bots/schema";

export const botsContract = defineRpcContract(botsRpcContract);
// Registered apart from `botsContract`: its `z.custom` request cannot be published as discoverable.
export const spawnContract = defineRpcContract({
  // Starts a thread as a bot (or without one) for composers that have no Launcher.
  createThread: {
    input: z.object({ request: z.custom<NewThreadRequest>(),
      placement: z.object({ sectionId: z.string().nullable(), pinned: z.boolean() }).optional(),
      // A bot id starts the thread as that bot; null means the user chose "No bot" over an inherited one.
      botId: z.string().min(1).nullable().optional() }),
    output: z.object({ threadId: z.string() }),
  },
});
const trusted = (pluginId: string | null | undefined) => pluginId != null && (TRUSTED_ORIGIN_PLUGINS as readonly string[]).includes(pluginId);
const LIST_ORDER_KEY = "list-order.v1";

const MEMORY_GUIDANCE = `${MEMORY_TOOL} keeps durable facts for this thread's bot, shared by every thread that uses the bot. The memory in the thread instructions is a snapshot from session start; call action "read" for the current text and its sha256.
- Append only facts that will matter in later threads: stable user preferences, recurring corrections, conventions the user stated. Not task progress, and nothing that belongs in the repository.
- Never store credentials or secrets.
- When the bot's memory is read-only, only "read" works; do not retry changes.
- One fact per append, on one line. To remove one, call "forget" with the line as read.
- Memory is limited to ${MEMORY_MAX} characters. When an append is refused, read, condense, and call "overwrite" with the complete text and the sha256 from that read. On a conflict, read again and merge; do not overwrite with stale text.`;

export function registerBots(bb: BbPluginApi) {
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  const store = new BotStore(db as unknown as SqlDb);
  bb.log.info(`loaded ${store.list().length} bots`);
  const publish = () => bb.realtime.publish("bots", { changedAt: Date.now() });
  const known = (botId: string) => store.get(botId) !== null;

  bb.agents.configure((ctx) => {
    const botId = ownerOf(store, ctx.thread);
    const bot = botId === null ? null : store.get(botId);
    if (!bot) return { tools: [], skills: [] };
    return { tools: [MEMORY_TOOL], skills: [], instructions: renderInstructions(bot) };
  });

  // A binding is fixed before the first turn starts, because tools and
  // instructions apply only when a provider session is constructed.
  bb.experimental_hooks.on("message.dispatch", (ctx) => {
    const { thread } = ctx;
    if (thread.status !== "pending") return { action: "proceed" };
    const mentioned = findBotMention(ctx.input.blocks, BOT_MENTION_PLUGINS, known);
    if (mentioned !== null) {
      if (store.binding(thread.id) !== mentioned) {
        store.bind(thread.id, mentioned, "mention");
        publish();
      }
      return { action: "proceed" };
    }
    if (store.hasBinding(thread.id) || store.detached(thread.id)) return { action: "proceed" };
    if (trusted(thread.originPluginId) && hasNoBotMarker(ctx.input.blocks)) {
      store.detach(thread.id);
      publish();
      return { action: "proceed" };
    }
    const source = handoffSource(ctx.input.blocks, trusted(thread.originPluginId));
    const inherited = ownerOf(store, thread) ?? (source === null ? null : store.binding(source));
    if (inherited !== null) {
      store.bind(thread.id, inherited, "inherit");
      publish();
    }
    return { action: "proceed" };
  });

  async function botForThread(threadId: string) {
    if (store.hasBinding(threadId) || store.detached(threadId)) return store.binding(threadId);
    return ownerOf(store, await bb.sdk.threads.get({ threadId }));
  }

  bb.agents.registerTool({
    name: MEMORY_TOOL,
    description: "Read or change the memory of the bot this thread runs as.",
    instructions: MEMORY_GUIDANCE,
    parameters: memoryToolSchema,
    async execute(params, ctx) {
      const botId = await botForThread(ctx.threadId);
      if (botId === null) return { content: [{ type: "text", text: "This thread has no bot." }], isError: true };
      const current = store.memory(botId);
      const fail = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true });
      const view = (memory: { content: string; sha256: string }, changed?: boolean) =>
        JSON.stringify({ ...(changed === undefined ? {} : { changed }), content: memory.content, sha256: memory.sha256, chars: memory.content.length, limit: MEMORY_MAX });
      if (params.action === "read") return view(current);
      if (!store.require(botId).memoryWrites) return fail("This bot's memory is read-only. The user turned off memory updates; do not retry.");
      try {
        let next: string;
        if (params.action === "overwrite") {
          if (params.content === undefined || !params.expectedSha256) return fail("overwrite needs content and expectedSha256.");
          if (params.expectedSha256 !== current.sha256) return fail("Memory changed since it was read. Read it again and merge.");
          next = applyMemoryChange(current.content, { action: "overwrite", content: params.content });
        } else {
          if (!params.fact) return fail(`${params.action} needs a fact.`);
          next = applyMemoryChange(current.content, { action: params.action, fact: params.fact });
        }
        if (next === current.content) return view(current, false);
        const written = store.setMemory(botId, next, current.sha256);
        publish();
        return view(written, true);
      } catch (error) {
        if (error instanceof MemoryError || error instanceof BotStoreError) return fail(error.message);
        throw error;
      }
    },
  });

  bb.ui.registerMentionProvider({
    id: MENTION_PROVIDER,
    label: "Bots",
    // Typed pills only bind in a first message and mislead elsewhere, so bots
    // stay out of the menu. Bots inserts its own pills, and `resolve`
    // still explains them and the ones in old messages.
    search() {
      return [];
    },
    // The bot's instructions arrive through `configure`; this only explains the pill.
    resolve(itemId) {
      const bot = store.get(itemId);
      return { context: bot ? `The user started this thread with the "${bot.name}" bot.` : "This message mentions a bot that no longer exists." };
    },
  });

  bb.rpc.register(botsContract, {
    getBot: ({ botId }) => ({ bot: store.get(botId) }),
    listBots: () => ({ bots: store.list() }),
    saveBot: ({ botId, bot }) => {
      const saved = store.save(botId, bot);
      publish();
      return { bot: saved };
    },
    deleteBot: ({ botId }) => {
      const deleted = store.delete(botId);
      if (deleted) publish();
      return { deleted };
    },
    setBotAvatar: ({ botId, avatar, animation }) => {
      const bot = store.setAvatar(botId, avatar, animation ?? null);
      publish();
      return { bot };
    },
    getBotAvatarAnimation: ({ botId }) => ({ animation: store.animation(botId) }),
    reorderBots: ({ botIds }) => {
      const bots = store.reorder(botIds);
      publish();
      return { bots };
    },
    getBotMemory: ({ botId }) => store.memory(botId),
    saveBotMemory: ({ botId, content, expectedSha256 }) => {
      const memory = store.setMemory(botId, content.trim(), expectedSha256);
      publish();
      return memory;
    },
    async assignThread({ threadId, botId }) {
      const thread = await bb.sdk.threads.get({ threadId });
      if (thread.status !== "pending") throw new BotStoreError("This thread has started; hand it off to the bot instead.");
      store.bind(threadId, botId, "assign");
      publish();
      return { botId };
    },
    detachThread: ({ threadId }) => {
      store.detach(threadId);
      publish();
      return { ok: true as const };
    },
    threadBots: () => ({ threads: store.threadBots() }),
    async threadBot({ threadId }) {
      if (store.detached(threadId)) return { botId: null, source: "detached" as const, instructions: null };
      const botId = await botForThread(threadId);
      const bot = botId === null ? null : store.get(botId);
      if (!bot) return { botId: null, source: "none" as const, instructions: null };
      return { botId: bot.id, source: store.hasBinding(threadId) ? "own" as const : "inherited" as const, instructions: renderInstructions(bot) };
    },
    async rowPreferences() {
      const fallback = { rowActions: ["bb--core/read", "bb--core/archive"], showProviderIcons: true, showRowMetadata: true, chronologicalSort: "updated" };
      try {
        // The built-in thread-list plugin owns these; its RPC is not a public contract, so any mismatch falls back.
        const { preferences } = await bb.sdk.plugins.callRpc({ pluginId: "thread-list", method: "listPreferences", input: {},
          outputSchema: z.object({ preferences: z.record(z.string(), z.unknown()) }) });
        const read = <T,>(key: string, schema: z.ZodType<T>, value: T) => { const parsed = schema.safeParse(preferences[key]); return parsed.success ? parsed.data : value; };
        return {
          rowActions: read("rowActions", z.array(z.string()).max(3), fallback.rowActions),
          showProviderIcons: read("showProviderIcons", z.boolean(), true),
          showRowMetadata: read("showRowMetadata", z.boolean(), true),
          chronologicalSort: read("chronologicalSort", z.string(), "updated"),
        };
      } catch (error) {
        bb.log.warn(`thread-list preferences unavailable: ${error instanceof Error ? error.message : String(error)}`);
        return fallback;
      }
    },
    getListOrder: async () => ({ order: (await bb.storage.kv.get<string[]>(LIST_ORDER_KEY)) ?? [] }),
    setListOrder: async ({ order }) => {
      await bb.storage.kv.set(LIST_ORDER_KEY, order);
      publish();
      return { order };
    },
  }, { experimental_discoverable: true, experimental_description: "Bots: saved launch configurations with instructions and memory." });

  bb.rpc.register(spawnContract, {
    async createThread({ request, placement, botId }) {
      // An explicit choice replaces any bot pill already in the draft, so the thread gets one.
      const input: NewThreadRequest["input"] = botId ? withBotMention(withoutBotMentions(request.input, BOT_MENTION_PLUGINS), store.require(botId), BOTS_PLUGIN_ID)
        : botId === null ? [...withoutBotMentions(request.input, BOT_MENTION_PLUGINS), { type: "text", text: NO_BOT_TEXT, mentions: [], visibility: "agent-only" }]
        : request.input;
      const thread = await bb.sdk.threads.spawn({ ...request, input, ...placement });
      return { threadId: thread.id };
    },
  });

  // bb does not tell plugins when a thread is deleted, so drop rows for
  // threads that are gone once per load, in the background.
  void (async () => {
    let removed = 0;
    for (const threadId of store.boundThreadIds()) {
      try { await bb.sdk.threads.get({ threadId }); }
      catch (error) {
        if (/\b404\b|not found/i.test(error instanceof Error ? error.message : String(error))) { store.forget(threadId); removed++; }
      }
    }
    if (removed > 0) { bb.log.info(`removed bot bindings for ${removed} deleted threads`); publish(); }
  })().catch((error) => bb.log.warn(`pruning bot bindings failed: ${error instanceof Error ? error.message : String(error)}`));

  return store;
}
