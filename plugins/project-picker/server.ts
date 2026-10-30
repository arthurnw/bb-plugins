// Quick Compose RPC adapted from Sawyer Hood’s Quick Compose; see THIRD_PARTY_LICENSES.md.
import { defineRpcContract, type BbPluginApi, type NewThreadRequest } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { hostContract } from "./contract.ts";
import type { ModelPreset, ModelSelection } from "./presets.ts";
import { autoBranchName, inputsSchema, PROVIDER_ID, type NamedWorktreeInputs } from "./named-worktree.ts";
import { resolveDefaultPresets, type Catalog, type CatalogModel } from "./default-presets.ts";
import { modelKey } from "./presets.ts";
import { modelStateSchema, presetsSchema, savedModelStateSchema, selectionSchema } from "./presets.schema.ts";

export const quickComposeRpcContract = defineRpcContract({
  // Forwarded unchanged; `threads.spawn` validates the request.
  createThread: {
    input: z.object({ request: z.custom<NewThreadRequest>() }),
    output: z.object({ threadId: z.string() }),
  },
  // A fork keeps the source's provider and model, so only these request fields apply.
  forkThread: {
    input: z.object({ sourceThreadId: z.string().min(1), sourceSeqEnd: z.number().int().nonnegative().optional(),
      request: z.custom<NewThreadRequest>() }),
    output: z.object({ threadId: z.string() }),
  },
  getModelState: { input: z.object({}), output: modelStateSchema },
  savePresets: { input: z.object({ presets: presetsSchema }), output: modelStateSchema },
  setSelection: { input: z.object({ selection: selectionSchema }), output: modelStateSchema },
});

const TIMEOUT_MS = 900_000;
const MODEL_STATE_KEY = "model-state.v1";

export default async function plugin(bb: BbPluginApi) {
  // Starter presets come from the live catalog so every row can run on this
  // machine. A provider whose catalog fails to load contributes nothing.
  async function loadCatalog(): Promise<Catalog> {
    const providers = await bb.sdk.providers.list();
    const entries = await Promise.all(providers.filter((provider) => provider.available)
      .map(async (provider): Promise<[string, readonly CatalogModel[]]> => {
        try {
          const result = await bb.sdk.providers.models({ providerId: provider.id });
          return [provider.id, result.modelLoadError ? [] : result.models];
        } catch (error) {
          bb.log.warn(`catalog for ${provider.id} unavailable: ${error instanceof Error ? error.message : String(error)}`);
          return [provider.id, []];
        }
      }));
    return new Map(entries);
  }
  // The catalog only supplies starter presets and display names, so a few
  // minutes of staleness is fine and keeps each overlay open cheap.
  let catalogCache: { at: number; catalog: Catalog } | null = null;
  async function catalog(): Promise<Catalog> {
    if (catalogCache && Date.now() - catalogCache.at < 5 * 60_000) return catalogCache.catalog;
    const loaded = await loadCatalog();
    if ([...loaded.values()].some((models) => models.length > 0)) catalogCache = { at: Date.now(), catalog: loaded };
    return loaded;
  }
  async function withNames(state: { presets: ModelPreset[]; selection: ModelSelection | null }) {
    const names: Record<string, string> = {};
    for (const [providerId, models] of await catalog()) {
      for (const model of models) if (model.displayName) names[modelKey({ providerId, model: model.id })] = model.displayName;
    }
    return { ...state, names };
  }
  // Writes are serialized so a selection change cannot overwrite a preset edit.
  let queue: Promise<unknown> = Promise.resolve();
  const exclusive = <T,>(operation: () => Promise<T>): Promise<T> => {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  };
  async function readModelState() {
    const saved = await bb.storage.kv.get(MODEL_STATE_KEY);
    if (saved != null) return savedModelStateSchema.parse(saved);
    const presets = resolveDefaultPresets(await catalog());
    // An empty result (no catalog yet) is not saved, so the next read tries again.
    const state = { presets, selection: null };
    if (presets.length > 0) await bb.storage.kv.set(MODEL_STATE_KEY, state);
    return state;
  }
  async function writeModelState(state: Awaited<ReturnType<typeof readModelState>>) {
    const parsed = savedModelStateSchema.parse(state);
    await bb.storage.kv.set(MODEL_STATE_KEY, parsed);
    return withNames(parsed);
  }

  bb.rpc.register(quickComposeRpcContract, {
    getModelState: () => exclusive(async () => withNames(await readModelState())),
    savePresets: ({ presets }) => exclusive(async () => writeModelState({ ...await readModelState(), presets })),
    setSelection: ({ selection }) => exclusive(async () => writeModelState({ ...await readModelState(), selection })),
    async createThread({ request }) {
      const thread = await bb.sdk.threads.spawn(request);
      return { threadId: thread.id };
    },
    async forkThread({ sourceThreadId, sourceSeqEnd, request }) {
      const thread = await bb.sdk.threads.fork({ sourceThreadId, sourceSeqEnd, input: request.input, environment: request.environment,
        permissionMode: request.permissionMode });
      return { threadId: thread.id };
    },
  });

  const host = bb.hosts.experimental_client({ contract: hostContract });

  async function provision(context: {
    projectCheckout: { path: string }; host: { id: string }; pathKey: string; signal: AbortSignal;
    experimental_claimPath(path: string): Promise<boolean>; report: { step(message: string): void; log(text: string): void };
  }, inputs: NamedWorktreeInputs, mode: { restore: boolean; autoName: boolean }, step: string) {
    const input = { sourcePath: context.projectCheckout.path, pathKey: context.pathKey, inputs, ...mode };
    const options = { hostId: context.host.id, signal: context.signal, timeoutMs: TIMEOUT_MS };
    const { path } = await host.call("target", input, options);
    if (!await context.experimental_claimPath(path)) return { status: "failed" as const, message: "Worktree directory is already in use." };
    context.report.step(step);
    const { name, baseBranch, wtSetup } = await host.call("create", input, options);
    if (mode.autoName) context.report.step(`Created branch ${name}`);
    if (wtSetup.status !== "missing") {
      if (wtSetup.output) context.report.log(wtSetup.output);
      context.report.step(wtSetup.status === "done" ? "wt setup finished" : "wt setup failed; the worktree is kept");
    }
    return { status: "created" as const, path, ownsPath: true, mergeBaseBranch: baseBranch };
  }

  bb.experimental_environments.register({
    id: PROVIDER_ID,
    displayName: "Named worktree",
    description: "Create a Git worktree from a base branch you choose, named by you or from the thread title.",
    icon: "FolderGit",
    requires: { gitCheckout: true },
    inputs: inputsSchema,
    policy: { pathKeys: "per-attempt" },
    async validate(context) {
      const { error } = await host.call("validate", { sourcePath: context.projectCheckout.path, inputs: context.inputs },
        { hostId: context.host.id });
      return error === null ? { action: "accept" } : { action: "refuse", message: error };
    },
    async create(context) {
      const { inputs } = context;
      if (inputs.name !== "") {
        return provision(context, inputs, { restore: false, autoName: false }, `Creating branch ${inputs.name} from ${inputs.baseBranch || "the default branch"}`);
      }
      const { generalSettings } = await bb.sdk.system.config();
      const name = autoBranchName(context.suggestedBranchName, context.thread.id, generalSettings.managedBranchPrefix);
      return provision(context, { ...inputs, name }, { restore: false, autoName: true }, `Creating a branch from ${inputs.baseBranch || "the default branch"}`);
    },
    async restore(context) {
      const name = context.previous.environment.branchName;
      if (name === null) return { status: "failed", message: "The removed worktree had no branch to restore." };
      return provision(context, { ...context.inputs, name }, { restore: true, autoName: false }, `Restoring branch ${name}`);
    },
    async remove(context) {
      if (context.hostId === null) return { status: "failed", message: "The worktree machine is unknown." };
      context.report.step("Removing named worktree (keeping its branch)");
      return host.call("remove", { pathKey: context.pathKey },
        { hostId: context.hostId, signal: context.signal, timeoutMs: TIMEOUT_MS });
    },
  });
}
