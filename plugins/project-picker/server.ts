// Quick Compose RPC adapted from Sawyer Hood’s Quick Compose; see THIRD_PARTY_LICENSES.md.
import { defineRpcContract, type BbPluginApi, type NewThreadRequest } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { hostContract } from "./contract.ts";
import { autoBranchName, inputsSchema, PROVIDER_ID, type NamedWorktreeInputs } from "./named-worktree.ts";

export const quickComposeRpcContract = defineRpcContract({
  // Forwarded unchanged; `threads.spawn` validates the request.
  createThread: {
    input: z.object({ request: z.custom<NewThreadRequest>() }),
    output: z.object({ threadId: z.string() }),
  },
  // A fork keeps the source's provider and model, so only these request fields apply.
  forkThread: {
    input: z.object({ sourceThreadId: z.string().min(1), request: z.custom<NewThreadRequest>() }),
    output: z.object({ threadId: z.string() }),
  },
});

const TIMEOUT_MS = 900_000;

export default async function plugin(bb: BbPluginApi) {
  bb.rpc.register(quickComposeRpcContract, {
    async createThread({ request }) {
      const thread = await bb.sdk.threads.spawn(request);
      return { threadId: thread.id };
    },
    async forkThread({ sourceThreadId, request }) {
      const thread = await bb.sdk.threads.fork({ sourceThreadId, input: request.input, environment: request.environment,
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
