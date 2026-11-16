import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { MIGRATIONS } from "./bot-store.ts";
import { registerBots, spawnContract } from "./bots-server.ts";

type Dispatch = (ctx: { thread: Record<string, unknown>; input: { blocks: unknown[] } }) => { action: string };

type Configure = (ctx: { thread: { id: string; parentThreadId: string | null; sourceThreadId: string | null }; project: { id: string; name: string } }) => { tools: unknown[]; skills: string[]; instructions?: string };
type Provider = { create(ctx: { inputs: { botId: string }; projectCheckout: { path: string } | null }): Promise<{ status: string; path?: string }> };
type Cli = { run(argv: string[], ctx: { threadId?: string }): Promise<{ exitCode: number; stdout?: string; stderr?: string }> };

function fakeBb() {
  const dir = mkdtempSync(join(tmpdir(), "bots-test-"));
  const db = Object.assign(new DatabaseSync(":memory:"), { name: join(dir, "data.db") });
  let dispatch: Dispatch | undefined;
  let configure: Configure | undefined;
  let provider: Provider | undefined;
  let cli: Cli | undefined;
  const spawned: Record<string, unknown>[] = [];
  const updated: Record<string, unknown>[] = [];
  const threads = new Map<string, { id: string; parentThreadId: string | null; sourceThreadId: string | null }>();
  let rpc: Record<string, (input: never) => unknown> = {};
  let mention: { search(): unknown[]; resolve(id: string): { context: string } } | undefined;
  const bb = {
    pluginId: "bots",
    storage: { database: () => db, migrate: (d: DatabaseSync, statements: string[]) => statements.forEach((s) => d.exec(s)), kv: { get: async () => null, set: async () => {} } },
    log: { info() {}, warn() {} },
    realtime: { publish() {} },
    agents: { configure: (handler: Configure) => { configure = handler; }, registerTool() {} },
    experimental_environments: { register: (declaration: Provider) => { provider = declaration; } },
    cli: { register: (registration: { run: unknown }) => { cli = registration as unknown as Cli; } },
    experimental_hooks: { on: (_: string, handler: Dispatch) => { dispatch = handler; } },
    ui: { registerMentionProvider: (provider: typeof mention) => { mention = provider; } },
    rpc: { register: (_: unknown, handlers: typeof rpc) => { rpc = { ...rpc, ...handlers }; } },
    sdk: { threads: {
      get: async ({ threadId }: { threadId: string }) => threads.get(threadId) ?? ({ id: threadId, parentThreadId: null, sourceThreadId: null }),
      spawn: async (request: Record<string, unknown>) => {
        spawned.push(request);
        const id = `thr_${spawned.length}`;
        // bb runs the dispatch hook before the session starts.
        dispatch!({ thread: { id, status: "pending", originPluginId: "bots", parentThreadId: null, sourceThreadId: null }, input: { blocks: request.input as unknown[] } });
        return { id };
      },
      update: async (request: Record<string, unknown>) => { updated.push(request); },
    } },
  } as unknown as BbPluginApi;
  assert.equal(MIGRATIONS.length > 0, true);
  const store = registerBots(bb);
  return { store, dispatch: dispatch!, rpc, mention: mention!, configure: configure!, provider: provider!, cli: cli!, spawned, updated, threads, dir };
}

const base = { name: "", emoji: "", instructions: "", starterPrompt: "", model: null, permissionMode: null, environment: null, projectId: "proj_1", avatarCorner: "top-right", workerModel: null };
const request = (text: string) => ({ projectId: "proj_1", origin: "plugin", input: [{ type: "text", text, mentions: [] }], environment: { type: "project-default" } });

const pill = (pluginId: string, botId: string) => ({ type: "text", text: "@B go", mentions: [{ start: 0, end: 2, resource: { kind: "plugin", pluginId, itemId: `bot:${botId}` } }] });
const thread = (id: string, originPluginId: string) => ({ id, status: "pending", originPluginId, parentThreadId: null, sourceThreadId: null });

test("a first message with a bots or launcher pill binds the thread", () => {
  const { store, dispatch } = fakeBb();
  const bot = store.save(undefined, { name: "B", emoji: "", instructions: "", starterPrompt: "", model: null, permissionMode: null, environment: null, projectId: null, avatarCorner: "top-right", workerModel: null });
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
  const bot = store.save(undefined, { name: "B", emoji: "", instructions: "", starterPrompt: "", model: null, permissionMode: null, environment: null, projectId: null, avatarCorner: "top-right", workerModel: null });
  assert.deepEqual(mention.search(), []);
  assert.match(mention.resolve(bot.id).context, /"B" bot/);
});

test("getBot returns the bot or null", () => {
  const { store, rpc } = fakeBb();
  const bot = store.save(undefined, { name: "B", emoji: "", instructions: "", starterPrompt: "", model: null, permissionMode: null, environment: null, projectId: null, avatarCorner: "top-right", workerModel: null });
  assert.equal((rpc.getBot!({ botId: bot.id } as never) as { bot: { id: string } }).bot.id, bot.id);
  assert.deepEqual(rpc.getBot!({ botId: "nope" } as never), { bot: null });
});

test("createInitiative starts a coordinator in the bot workspace and roles follow the tree", async () => {
  const { store, rpc, configure, provider, cli, spawned, threads, dispatch } = fakeBb();
  const model = { providerId: "claude-code", model: "opus", reasoningLevel: "high", serviceTier: "default" };
  const result = await (rpc.createInitiative!({ request: request("Ship initiative bots\nmore detail"), bot: { ...base, model } } as never) as Promise<{ threadId: string; botId: string }>);
  const bot = store.get(result.botId)!;
  assert.equal(bot.name, "Ship initiative bots");
  assert.equal(bot.coordinatorThreadId, result.threadId);
  assert.deepEqual(spawned[0]!.environment, { type: "provider", environmentProviderId: "bots-workspace", inputs: { botId: bot.id } });
  assert.equal(spawned[0]!.model, "opus");

  const made = await provider.create({ inputs: { botId: bot.id }, projectCheckout: { path: "/repo" } });
  assert.equal(made.path, bot.workspacePath);
  assert.equal(existsSync(made.path!), true);

  const coordinator = configure({ thread: { id: result.threadId, parentThreadId: null, sourceThreadId: null }, project: { id: "proj_1", name: "bb-plugins" } });
  assert.deepEqual(coordinator.skills, ["bot-coordinator"]);
  assert.match(coordinator.instructions!, /tracker\.md/);
  assert.match(coordinator.instructions!, /checkout at `\/repo`/);
  assert.ok(coordinator.instructions!.length <= 4096);

  // A worker spawned with --parent-self inherits the bot.
  threads.set("w1", { id: "w1", parentThreadId: result.threadId, sourceThreadId: null });
  dispatch({ thread: { id: "w1", status: "pending", originPluginId: null, parentThreadId: result.threadId, sourceThreadId: null }, input: { blocks: [{ type: "text", text: "do it", mentions: [] }] } });
  const worker = configure({ thread: { id: "w1", parentThreadId: result.threadId, sourceThreadId: null }, project: { id: "proj_1", name: "bb-plugins" } });
  assert.deepEqual(worker.skills, []);
  assert.match(worker.instructions!, /worker/);

  const role = (threadId: string) => cli.run(["role", threadId], {}).then((r) => JSON.parse(r.stdout!));
  assert.deepEqual(await role(result.threadId), { threadId: result.threadId, role: "coordinator", coordinator: true, botId: bot.id, botName: bot.name, workspace: bot.workspacePath });
  assert.equal((await role("w1")).role, "worker");
  assert.equal((await role("stranger")).role, "none");
  assert.equal((await cli.run(["done", "w1"], {})).exitCode, 0);
  assert.deepEqual(store.get(bot.id)!.doneThreads, ["w1"]);
});

test("createInitiative promotes an existing thread under the coordinator", async () => {
  const { store, rpc, updated } = fakeBb();
  const result = await (rpc.createInitiative!({ request: request("Take over @thread:thr_old"), bot: base, promoteThreadId: "thr_old" } as never) as Promise<{ threadId: string; botId: string }>);
  assert.equal(store.binding("thr_old"), result.botId);
  assert.deepEqual(updated, [{ threadId: "thr_old", parentThreadId: result.threadId }]);
});

test("createInitiative refuses an empty brief", async () => {
  const { rpc, store } = fakeBb();
  await assert.rejects(rpc.createInitiative!({ request: request("  "), bot: base } as never) as Promise<unknown>, /brief/);
  assert.equal(store.list().length, 0);
});

test("createInitiative input accepts the New bot dialog's unnamed draft", () => {
  const input = spawnContract.createInitiative.input.parse({ request: request("Ship it"), bot: base });
  assert.equal(input.bot.name, "");
  assert.throws(() => spawnContract.createInitiative.input.parse({ request: request("Ship it"), bot: { ...base, name: "x".repeat(200) } }));
});
