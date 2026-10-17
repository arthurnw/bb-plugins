// Quick Compose RPC adapted from Sawyer Hood’s Quick Compose; see THIRD_PARTY_LICENSES.md.
import { defineRpcContract, type BbPluginApi, type NewThreadRequest } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { hostContract } from "./contract.ts";
import { inputsSchema, PROVIDER_ID, type NamedWorktreeInputs } from "./named-worktree.ts";

export const quickComposeRpcContract = defineRpcContract({
  // Forwarded unchanged; `threads.spawn` validates the request.
  createThread: {
    input: z.object({ request: z.custom<NewThreadRequest>() }),
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
  });

  const host = bb.hosts.experimental_client({ contract: hostContract });

  async function provision(context: {
    projectCheckout: { path: string }; host: { id: string }; pathKey: string; signal: AbortSignal;
    experimental_claimPath(path: string): Promise<boolean>; report: { step(message: string): void };
  }, inputs: NamedWorktreeInputs, restore: boolean, step: string) {
    const input = { sourcePath: context.projectCheckout.path, pathKey: context.pathKey, inputs, restore };
    const options = { hostId: context.host.id, signal: context.signal, timeoutMs: TIMEOUT_MS };
    const { path } = await host.call("target", input, options);
    if (!await context.experimental_claimPath(path)) return { status: "failed" as const, message: "Worktree directory is already in use." };
    context.report.step(step);
    await host.call("create", input, options);
    return { status: "created" as const, path, ownsPath: true, mergeBaseBranch: inputs.baseBranch };
  }

  bb.experimental_environments.register({
    id: PROVIDER_ID,
    displayName: "Named worktree",
    description: "Create a Git worktree with a branch name and base branch you choose.",
    icon: "FolderGit",
    requires: { gitCheckout: true },
    inputs: inputsSchema,
    policy: { pathKeys: "per-attempt" },
    async validate(context) {
      const { error } = await host.call("validate", { sourcePath: context.projectCheckout.path, inputs: context.inputs },
        { hostId: context.host.id });
      return error === null ? { action: "accept" } : { action: "refuse", message: error };
    },
    create: (context) => provision(context, context.inputs, false,
      `Creating branch ${context.inputs.name} from ${context.inputs.baseBranch}`),
    async restore(context) {
      const name = context.previous.environment.branchName;
      if (name === null) return { status: "failed", message: "The removed worktree had no branch to restore." };
      return provision(context, { ...context.inputs, name }, true, `Restoring branch ${name}`);
    },
    async remove(context) {
      if (context.hostId === null) return { status: "failed", message: "The worktree machine is unknown." };
      context.report.step("Removing named worktree (keeping its branch)");
      return host.call("remove", { pathKey: context.pathKey },
        { hostId: context.hostId, signal: context.signal, timeoutMs: TIMEOUT_MS });
    },
  });
}
