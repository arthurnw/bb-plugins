import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { cliCommand, defineCli, defineRpcContract, PluginCliError, type BbPluginApi, type NewThreadRequest } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { BotStore, BotStoreError, MIGRATIONS, type SqlDb } from "./bot-store.ts";
import {
  BOT_MENTION_PLUGINS, BOTS_PLUGIN_ID, BRIEF_MAX, findBotMention, handoffSource, hasNoBotMarker, MENTION_PROVIDER, NO_BOT_TEXT, ownerOf, renderInstructions,
  TRUSTED_ORIGIN_PLUGINS, botDraft, withBotMention, withoutBotMentions, type Bot,
} from "@arthurnw/bb-shared/bots";
import { botsRpcContract, initiativeDraftSchema } from "@arthurnw/bb-shared/bots/schema";
import { GUARD_FILE, GUARD_SCRIPT, guardSettings } from "./guard-script.ts";
import { COORDINATOR_SKILL, coordinatorInstructions, coordinatorKickoff, nameFromBrief, roleOf, workerInstructions, WORKSPACE_PROVIDER, workspaceDirName, type ThreadRole } from "./initiative.ts";

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
  /**
   * Creates an initiative bot and starts its coordinator in the bot workspace
   * with the composer's request as the brief. `promoteThreadId` becomes the
   * bot's first worker. A null `bot.model` takes the composer's model; a null
   * `bot.workerModel` takes the coordinator's.
   */
  createInitiative: {
    input: z.object({ request: z.custom<NewThreadRequest>(), bot: initiativeDraftSchema, avatar: z.string().max(200).optional(),
      promoteThreadId: z.string().min(1).optional() }),
    output: z.object({ threadId: z.string(), botId: z.string() }),
  },
});
const trusted = (pluginId: string | null | undefined) => pluginId != null && (TRUSTED_ORIGIN_PLUGINS as readonly string[]).includes(pluginId);
const LIST_ORDER_KEY = "list-order.v1";

const workspaceInputs = z.object({ botId: z.string().min(1) });

/** What `bb bots role` prints, and what enforcement hooks read. */
export function roleReport(threadId: string, role: ThreadRole | null) {
  return {
    threadId,
    role: role?.kind ?? "none",
    coordinator: role?.kind === "coordinator",
    botId: role?.bot.id ?? null,
    botName: role?.bot.name ?? null,
    workspace: role && role.kind !== "persona" ? role.bot.workspacePath : null,
  };
}

/** The machine the composer's environment names, if any. */
const hostIn = (environment: NewThreadRequest["environment"]) =>
  environment?.type === "host" ? environment.hostId
    : environment?.type === "provider" && environment.machine?.type === "existing" ? environment.machine.hostId : undefined;

const briefText = (input: NewThreadRequest["input"]) =>
  input.filter((block) => block.type === "text" && block.visibility !== "agent-only").map((block) => (block as { text: string }).text).join("\n");

export function registerBots(bb: BbPluginApi) {
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  const store = new BotStore(db as unknown as SqlDb);
  bb.log.info(`loaded ${store.list().length} bots`);
  // Beside the plugin's data.db: <bb data>/plugins/bots/workspaces/<name>-<id prefix>.
  // The path is fixed when the bot is created; bots from before then use their id.
  const workspacesRoot = join(dirname((db as unknown as { name: string }).name), "workspaces");
  const workspaceFor = (botId: string) => store.get(botId)?.workspacePath ?? join(workspacesRoot, botId);
  // Bots whose coordinator is being spawned; the dispatch hook claims the thread before its session starts.
  const pendingCoordinators = new Set<string>();
  const guardPath = join(dirname(workspacesRoot), "hooks", GUARD_FILE);
  void mkdir(dirname(guardPath), { recursive: true }).then(() => writeFile(guardPath, GUARD_SCRIPT, { mode: 0o755 }))
    .catch((error) => bb.log.warn(`could not write the coordinator guard: ${error instanceof Error ? error.message : String(error)}`));
  const publish = () => bb.realtime.publish("bots", { changedAt: Date.now() });
  const known = (botId: string) => store.get(botId) !== null;

  bb.agents.configure((ctx) => {
    const role = roleOf(store, ctx.thread);
    if (!role) return { tools: [], skills: [] };
    if (role.kind === "coordinator") {
      return { tools: [], skills: [COORDINATOR_SKILL], instructions: coordinatorInstructions(role.bot,
        { projectId: ctx.project.id, projectName: ctx.project.name, checkoutPath: store.checkoutPath(role.bot.id) }) };
    }
    if (role.kind === "worker") return { tools: [], skills: [], instructions: workerInstructions(role.bot) };
    return { tools: [], skills: [], instructions: renderInstructions(role.bot) };
  });

  // A binding is fixed before the first turn starts, because tools and
  // instructions apply only when a provider session is constructed.
  bb.experimental_hooks.on("message.dispatch", (ctx) => {
    const { thread } = ctx;
    if (thread.status !== "pending") return { action: "proceed" };
    const mentioned = findBotMention(ctx.input.blocks, BOT_MENTION_PLUGINS, known);
    if (mentioned !== null && thread.originPluginId === BOTS_PLUGIN_ID && pendingCoordinators.has(mentioned)) {
      claimCoordinator(mentioned, thread.id);
      return { action: "proceed" };
    }
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

  function claimCoordinator(botId: string, threadId: string) {
    pendingCoordinators.delete(botId);
    if (store.get(botId)?.coordinatorThreadId === threadId) return;
    store.bind(threadId, botId, "assign");
    store.setCoordinator(botId, threadId, workspaceFor(botId));
    publish();
  }

  async function roleOfThread(threadId: string): Promise<ThreadRole | null> {
    if (store.coordinatedBy(threadId) || store.hasBinding(threadId) || store.detached(threadId)) {
      return roleOf(store, { id: threadId, parentThreadId: null, sourceThreadId: null });
    }
    return roleOf(store, await bb.sdk.threads.get({ threadId }));
  }

  // A persistent, non-git directory per bot that holds the coordinator's state
  // files. It is never retired, so an archived coordinator resumes with them.
  bb.experimental_environments.register({
    id: WORKSPACE_PROVIDER,
    displayName: "Bot workspace",
    description: "An initiative bot's own directory for its coordinator's state files. Created by Bots: new bot.",
    icon: "Bot",
    inputs: workspaceInputs,
    policy: { retireGraceMs: null, pathKeys: "per-thread" },
    validate: ({ inputs }) => store.get(inputs.botId) ? { action: "accept" } : { action: "refuse", message: "That bot no longer exists." },
    experimental_existingPath: (inputs) => workspaceFor(inputs.botId),
    async create(context) {
      return provisionWorkspace(context.inputs.botId, context.projectCheckout?.path ?? null);
    },
    async restore(context) {
      return provisionWorkspace(context.inputs.botId, context.projectCheckout?.path ?? null);
    },
    // Keeps the files: they are the initiative's state.
    remove: async () => ({ status: "removed" }),
  });

  /** The machine of the project's default checkout. */
  async function defaultHostId(projectId: string | null) {
    if (!projectId) return undefined;
    const { sources } = await bb.sdk.projects.get({ projectId });
    const local = sources.filter((source) => source.type === "local_path");
    return (local.find((source) => source.isDefault) ?? local[0])?.hostId;
  }

  async function provisionWorkspace(botId: string, checkoutPath: string | null) {
    if (!store.get(botId)) return { status: "failed" as const, message: "That bot no longer exists." };
    const path = workspaceFor(botId);
    await mkdir(path, { recursive: true });
    if (checkoutPath && store.checkoutPath(botId) !== checkoutPath) store.setCheckoutPath(botId, checkoutPath);
    return { status: "created" as const, path, ownsPath: false, mergeBaseBranch: null };
  }

  bb.cli.register(defineCli({
    name: "bots",
    summary: "Initiative bots: thread roles and worker state",
    commands: {
      role: cliCommand({
        summary: "Print a thread's bot role as JSON: coordinator, worker, persona, or none, with the bot workspace",
        positionals: [{ name: "threadId", description: "Thread id; defaults to the calling thread (BB_THREAD_ID)" }],
        async run({ positionals }, ctx) {
          const threadId = positionals.threadId ?? ctx.threadId;
          if (!threadId) throw new PluginCliError("Pass a thread id.", { code: "missing_thread" });
          return { exitCode: 0, stdout: `${JSON.stringify(roleReport(threadId, await roleOfThread(threadId)))}\n` };
        },
      }),
      done: cliCommand({
        summary: "Mark a worker thread finished (merged or closed) so the thread list collapses it",
        positionals: [{ name: "threadId", description: "The worker thread", required: true }],
        options: { undo: { type: "boolean", description: "Mark it not finished again" } },
        async run({ positionals, options }) {
          const threadId = positionals.threadId!;
          const role = await roleOfThread(threadId);
          if (role?.kind !== "worker") throw new PluginCliError("That thread is not a worker of an initiative bot.", { code: "not_worker" });
          store.setDone(role.bot.id, threadId, !options.undo);
          publish();
          return { exitCode: 0, stdout: `${options.undo ? "Reopened" : "Marked done"}: ${threadId}\n` };
        },
      }),
      rename: cliCommand({
        summary: "Rename the bot a coordinator thread runs",
        positionals: [{ name: "name", description: "The new name, quoted if it has spaces", required: true }],
        options: { thread: { type: "string", description: "The coordinator thread; defaults to the calling thread (BB_THREAD_ID)" } },
        async run({ positionals, options }, ctx) {
          const threadId = options.thread ?? ctx.threadId;
          if (!threadId) throw new PluginCliError("Pass --thread.", { code: "missing_thread" });
          const bot = store.coordinatedBy(threadId);
          if (!bot) throw new PluginCliError("That thread is not an initiative bot's coordinator.", { code: "not_coordinator" });
          try {
            const saved = store.save(bot.id, { ...botDraft(bot), name: positionals.name!.trim() });
            publish();
            return { exitCode: 0, stdout: `Renamed to ${saved.name}\n` };
          } catch (error) {
            if (error instanceof BotStoreError) throw new PluginCliError(error.message, { code: "invalid_name" });
            throw error;
          }
        },
      }),
      hook: cliCommand({
        summary: "Print the ~/.claude/settings.json entry for the Claude Code hook that stops coordinators editing outside their workspace",
        async run() {
          return { exitCode: 0, stdout: `${JSON.stringify(guardSettings(guardPath), null, 2)}\n` };
        },
      }),
      list: cliCommand({
        summary: "List initiative bots with their coordinator thread and workspace",
        async run() {
          const rows = store.list().filter((bot) => bot.coordinatorThreadId !== null)
            .map((bot) => ({ botId: bot.id, name: bot.name, coordinatorThreadId: bot.coordinatorThreadId, workspace: bot.workspacePath, projectId: bot.projectId }));
          return { exitCode: 0, stdout: `${JSON.stringify(rows, null, 2)}\n` };
        },
      }),
    },
  }));

  // A bot lives as long as its coordinator: deleting the thread deletes the bot
  // (its workspace files stay). Archiving keeps it.
  bb.events.on("thread.deleted", ({ thread }) => {
    const bot = store.coordinatedBy(thread.id);
    if (bot && store.delete(bot.id)) {
      bb.log.info(`deleted bot ${bot.id}: its coordinator ${thread.id} was deleted`);
      publish();
    }
  });
  // Coordinators deleted while Bots was not running. bb.sdk answers only once
  // the server listens, so this waits a moment after load.
  const sweep = setTimeout(async () => {
    for (const bot of store.list()) {
      if (bot.coordinatorThreadId === null) continue;
      try { await bb.sdk.threads.get({ threadId: bot.coordinatorThreadId }); }
      catch (error) {
        if (!/\b404\b|not found/i.test(String(error))) continue;
        store.delete(bot.id);
        bb.log.info(`deleted bot ${bot.id}: its coordinator ${bot.coordinatorThreadId} no longer exists`);
        publish();
      }
    }
  }, 10_000);
  sweep.unref?.();

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
      const role = await roleOfThread(threadId);
      if (!role) return { botId: null, source: "none" as const, instructions: null };
      const instructions = role.kind === "persona" ? renderInstructions(role.bot) : role.kind === "worker" ? workerInstructions(role.bot) : null;
      return { botId: role.bot.id, source: store.hasBinding(threadId) ? "own" as const : "inherited" as const, instructions };
    },
    getListOrder: async () => ({ order: (await bb.storage.kv.get<string[]>(LIST_ORDER_KEY)) ?? [] }),
    setListOrder: async ({ order }) => {
      await bb.storage.kv.set(LIST_ORDER_KEY, order);
      publish();
      return { order };
    },
  }, { experimental_discoverable: true, experimental_description: "Bots: initiative bots with a coordinator thread, and saved launch configurations." });

  bb.rpc.register(spawnContract, {
    async createThread({ request, placement, botId }) {
      // An explicit choice replaces any bot pill already in the draft, so the thread gets one.
      const input: NewThreadRequest["input"] = botId ? withBotMention(withoutBotMentions(request.input, BOT_MENTION_PLUGINS), store.require(botId), BOTS_PLUGIN_ID)
        : botId === null ? [...withoutBotMentions(request.input, BOT_MENTION_PLUGINS), { type: "text", text: NO_BOT_TEXT, mentions: [], visibility: "agent-only" }]
        : request.input;
      const thread = await bb.sdk.threads.spawn({ ...request, input, ...placement });
      return { threadId: thread.id };
    },
    async createInitiative({ request, bot: draft, avatar, promoteThreadId }) {
      const brief = briefText(request.input);
      if (!brief.trim()) throw new BotStoreError("Write a brief for the bot.");
      if (brief.length > BRIEF_MAX) throw new BotStoreError(`The brief is limited to ${BRIEF_MAX} characters.`);
      const projectId = draft.projectId ?? request.projectId;
      const name = draft.name.trim() || nameFromBrief(brief, store.list().map((item) => item.name));
      // The composer's model picker chooses the coordinator unless the draft names one;
      // workers default to the coordinator's model.
      const fromComposer = { providerId: request.providerId, model: request.model, reasoningLevel: request.reasoningLevel, serviceTier: request.serviceTier ?? "default" };
      const coordinatorModel = draft.model ?? fromComposer;
      const saved = store.save(undefined, { ...draft, name, projectId, model: coordinatorModel, workerModel: draft.workerModel ?? coordinatorModel }, avatar);
      const bot = store.setWorkspacePath(saved.id, join(workspacesRoot, workspaceDirName(name, saved.id)));
      publish();
      pendingCoordinators.add(bot.id);
      const model = draft.model;
      // The bot's pill goes in the hidden kickoff block: the dispatch hook needs it to bind the
      // coordinator, and in the visible brief it would repeat the name taken from the brief.
      const input: NewThreadRequest["input"] = [
        ...withoutBotMentions(request.input, BOT_MENTION_PLUGINS),
        ...withBotMention([{ type: "text" as const, text: coordinatorKickoff(draft.name.trim() ? null : name), mentions: [], visibility: "agent-only" as const }], bot, BOTS_PLUGIN_ID),
      ];
      let threadId: string;
      try {
        const hostId = hostIn(request.environment) ?? await defaultHostId(projectId);
        if (!hostId) throw new BotStoreError("This project has no checkout on a machine, so the bot has nowhere to run.");
        const thread = await bb.sdk.threads.spawn({
          ...request, input, projectId,
          // The composer's session options belong to its own provider; a chosen coordinator model drops them.
          ...(model ? { providerId: model.providerId, model: model.model, reasoningLevel: model.reasoningLevel, serviceTier: model.serviceTier, sessionOptions: undefined,
            executionInputSources: { ...request.executionInputSources, providerId: "explicit", model: "explicit", reasoningLevel: "explicit", serviceTier: "explicit" } } : {}),
          environment: { type: "provider", environmentProviderId: WORKSPACE_PROVIDER, inputs: { botId: bot.id }, machine: { type: "existing", hostId } },
        });
        threadId = thread.id;
      } catch (error) {
        pendingCoordinators.delete(bot.id);
        store.delete(bot.id);
        publish();
        throw error;
      }
      claimCoordinator(bot.id, threadId);
      if (promoteThreadId) await promote(bot, threadId, promoteThreadId);
      return { threadId, botId: bot.id };
    },
  });

  /** Makes an existing thread the bot's first worker, keeping its branch and worktree. */
  async function promote(bot: Bot, coordinatorThreadId: string, threadId: string) {
    store.bind(threadId, bot.id, "assign");
    publish();
    try {
      await bb.sdk.threads.update({ threadId, parentThreadId: coordinatorThreadId });
    } catch (error) {
      // The binding still makes it a worker; the coordinator tracks it in tracker.md.
      bb.log.warn(`could not move ${threadId} under ${coordinatorThreadId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

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
