import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { MIGRATIONS } from "./bot-store.ts";
import { registerBots } from "./bots-server.ts";

type Dispatch = (ctx: { thread: Record<string, unknown>; input: { blocks: unknown[] } }) => { action: string };

function fakeBb() {
  const db = new DatabaseSync(":memory:");
  let dispatch: Dispatch | undefined;
  let rpc: Record<string, (input: never) => unknown> = {};
  let mention: { search(): unknown[]; resolve(id: string): { context: string } } | undefined;
  const bb = {
    pluginId: "bots",
    storage: { database: () => db, migrate: (d: DatabaseSync, statements: string[]) => statements.forEach((s) => d.exec(s)), kv: { get: async () => null, set: async () => {} } },
    log: { info() {}, warn() {} },
    realtime: { publish() {} },
    agents: { configure() {}, registerTool() {} },
    experimental_hooks: { on: (_: string, handler: Dispatch) => { dispatch = handler; } },
    ui: { registerMentionProvider: (provider: typeof mention) => { mention = provider; } },
    rpc: { register: (_: unknown, handlers: typeof rpc) => { rpc = { ...rpc, ...handlers }; } },
    sdk: { threads: { get: async () => ({}) } },
  } as unknown as BbPluginApi;
  assert.equal(MIGRATIONS.length > 0, true);
  const store = registerBots(bb);
  return { store, dispatch: dispatch!, rpc, mention: mention! };
}

const pill = (pluginId: string, botId: string) => ({ type: "text", text: "@B go", mentions: [{ start: 0, end: 2, resource: { kind: "plugin", pluginId, itemId: `bot:${botId}` } }] });
const thread = (id: string, originPluginId: string) => ({ id, status: "pending", originPluginId, parentThreadId: null, sourceThreadId: null });

test("a first message with a bots or launcher pill binds the thread", () => {
  const { store, dispatch } = fakeBb();
  const bot = store.save(undefined, { name: "B", emoji: "", instructions: "", starterPrompt: "", model: null, permissionMode: null, environment: null, projectId: null, memoryWrites: true, avatarCorner: "top-right" });
  dispatch({ thread: thread("t1", "launcher"), input: { blocks: [pill("bots", bot.id)] } });
  dispatch({ thread: thread("t2", "launcher"), input: { blocks: [pill("launcher", bot.id)] } });
  dispatch({ thread: thread("t3", "someone-else"), input: { blocks: [{ type: "text", text: "plain", mentions: [] }] } });
  assert.deepEqual(store.threadBots(), { t1: bot.id, t2: bot.id });
});

test("No bot from a trusted origin detaches; from another plugin it does not", () => {
  const { store, dispatch } = fakeBb();
  const marker = { type: "text", text: "The user started this thread without a bot.", mentions: [], visibility: "agent-only" };
  dispatch({ thread: thread("a", "launcher"), input: { blocks: [marker] } });
  dispatch({ thread: thread("b", "elsewhere"), input: { blocks: [marker] } });
  assert.equal(store.detached("a"), true);
  assert.equal(store.detached("b"), false);
});

test("the mention provider lists nothing but still explains pills", () => {
  const { store, mention } = fakeBb();
  const bot = store.save(undefined, { name: "B", emoji: "", instructions: "", starterPrompt: "", model: null, permissionMode: null, environment: null, projectId: null, memoryWrites: true, avatarCorner: "top-right" });
  assert.deepEqual(mention.search(), []);
  assert.match(mention.resolve(bot.id).context, /"B" bot/);
});

test("getBot returns the bot or null", () => {
  const { store, rpc } = fakeBb();
  const bot = store.save(undefined, { name: "B", emoji: "", instructions: "", starterPrompt: "", model: null, permissionMode: null, environment: null, projectId: null, memoryWrites: true, avatarCorner: "top-right" });
  assert.equal((rpc.getBot!({ botId: bot.id } as never) as { bot: { id: string } }).bot.id, bot.id);
  assert.deepEqual(rpc.getBot!({ botId: "nope" } as never), { bot: null });
});
