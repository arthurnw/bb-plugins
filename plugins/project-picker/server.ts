// Quick Compose RPC adapted from Sawyer Hood’s Quick Compose; see THIRD_PARTY_LICENSES.md.
import {
  defineRpcContract,
  type BbPluginApi,
  type NewThreadRequest,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import { hostContract } from "./contract.ts";
import { inputsSchema, PROVIDER_ID } from "./named-worktree.ts";

// The composer's NewThreadRequest, checked for its load-bearing fields and
// otherwise forwarded unchanged; `threads.spawn` validates the full shape.
const newThreadRequestShape = z.object({
  projectId: z.string().min(1),
  providerId: z.string().min(1),
  model: z.string().min(1),
  input: z.array(z.unknown()).min(1),
  environment: z.object({ type: z.string() }),
});
export const newThreadRequestSchema = z.custom<NewThreadRequest>(
  (value) => newThreadRequestShape.safeParse(value).success,
  "Expected a new thread request from the composer",
);

export const quickComposeRpcContract = defineRpcContract({
  createThread: {
    input: z.object({ request: newThreadRequestSchema }).strict(),
    output: z.object({ threadId: z.string() }).strict(),
  },
});

export default async function plugin(bb: BbPluginApi) {
  bb.rpc.register(quickComposeRpcContract, {
    async createThread({ request }) {
      const thread = await bb.sdk.threads.spawn(request);
      return { threadId: thread.id };
    },
  });

  const host = bb.hosts.experimental_client({ contract: hostContract });
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
    async create(context) {
      const input = { sourcePath: context.projectCheckout.path, pathKey: context.pathKey, inputs: context.inputs, restore: false };
      const options = { hostId: context.host.id, signal: context.signal, timeoutMs: 900_000 };
      const { path } = await host.call("target", input, options);
      if (!await context.experimental_claimPath(path)) return { status: "failed", message: "Worktree directory is already in use." };
      context.report.step(`Creating branch ${context.inputs.name} from ${context.inputs.baseBranch}`);
      await host.call("create", input, options);
      return { status: "created", path, ownsPath: true, mergeBaseBranch: context.inputs.baseBranch };
    },
    async restore(context) {
      const name = context.previous.environment.branchName;
      if (name === null) return { status: "failed", message: "The removed worktree had no branch to restore." };
      const input = { sourcePath: context.projectCheckout.path, pathKey: context.pathKey,
        inputs: { ...context.inputs, name }, restore: true };
      const options = { hostId: context.host.id, signal: context.signal, timeoutMs: 900_000 };
      const { path } = await host.call("target", input, options);
      if (!await context.experimental_claimPath(path)) return { status: "failed", message: "Worktree directory is already in use." };
      context.report.step(`Restoring branch ${name}`);
      await host.call("create", input, options);
      return { status: "created", path, ownsPath: true, mergeBaseBranch: context.inputs.baseBranch };
    },
    async remove(context) {
      if (context.hostId === null) return { status: "failed", message: "The worktree machine is unknown." };
      context.report.step("Removing named worktree (keeping its branch)");
      return host.call("remove", { pathKey: context.pathKey },
        { hostId: context.hostId, signal: context.signal, timeoutMs: 900_000 });
    },
  });
}
