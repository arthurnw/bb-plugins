import { experimental_defineHostEntry, experimental_killProcessesWithCwdUnder } from "@get-bb/plugin-sdk/host";
import { hostContract } from "./contract.ts";
import { createWorktree, removeWorktree, runWtSetup, targetPath, validateNewBranch } from "./worktree.ts";

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    async validate({ sourcePath, inputs }, context) {
      try { await validateNewBranch(sourcePath, inputs, context.signal); return { error: null }; }
      catch (error) { context.signal.throwIfAborted(); return { error: error instanceof Error ? error.message : String(error) }; }
    },
    async target({ pathKey, sourcePath }, context) {
      return { path: targetPath(context.experimental_paths.dataDir, pathKey, sourcePath) };
    },
    async create({ pathKey, sourcePath, inputs, restore, autoName }, context) {
      const created = await createWorktree(context.experimental_paths.dataDir, pathKey, sourcePath, inputs,
        { restore, autoName, signal: context.signal });
      return { ...created, wtSetup: await runWtSetup(created.path, context.signal) };
    },
    async remove({ pathKey }, context) {
      await removeWorktree(context.experimental_paths.dataDir, pathKey,
        (target) => experimental_killProcessesWithCwdUnder({ directories: [target] }), context.signal);
      return { status: "removed" as const };
    },
  },
});
