import { experimental_defineHostEntry, experimental_killProcessesWithCwdUnder } from "@get-bb/plugin-sdk/host";
import { hostContract } from "./contract.ts";
import { createExisting, listRefs, resolveRef } from "./existing-worktree.ts";
import { createWorktree, planWorktree, removeWorktree, resolveRoot, runWtSetup, validateNewBranch } from "./worktree.ts";

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    async validate({ sourcePath, inputs, root }, context) {
      try {
        await resolveRoot(root, { dataDir: context.experimental_paths.dataDir, source: sourcePath });
        await validateNewBranch(sourcePath, inputs, context.signal);
        return { error: null };
      }
      catch (error) { context.signal.throwIfAborted(); return { error: error instanceof Error ? error.message : String(error) }; }
    },
    async target({ pathKey, sourcePath, inputs, root, restore, autoName }, context) {
      const { target } = await planWorktree(context.experimental_paths.dataDir, root, pathKey, sourcePath, inputs,
        { restore, autoName, signal: context.signal });
      return { path: target };
    },
    async create({ pathKey, sourcePath, inputs, root, restore, autoName }, context) {
      const created = await createWorktree(context.experimental_paths.dataDir, root, pathKey, sourcePath, inputs,
        { restore, autoName, signal: context.signal });
      return { ...created, wtSetup: await runWtSetup(created.path, context.signal) };
    },
    async resolveRef({ sourcePath, ref }, context) {
      try { return { resolved: await resolveRef(sourcePath, ref, { signal: context.signal }), error: null }; }
      catch (error) { context.signal.throwIfAborted(); return { resolved: null, error: error instanceof Error ? error.message : String(error) }; }
    },
    listRefs: ({ sourcePath }, context) => listRefs(sourcePath, { signal: context.signal }),
    async existingTarget({ pathKey, sourcePath, ref, root }, context) {
      const resolved = await resolveRef(sourcePath, ref, { signal: context.signal });
      const { target } = await planWorktree(context.experimental_paths.dataDir, root, pathKey, sourcePath,
        { name: resolved.branch, baseBranch: "" }, { signal: context.signal });
      return { path: target };
    },
    async existingCreate({ pathKey, sourcePath, ref, root }, context) {
      const resolved = await resolveRef(sourcePath, ref, { signal: context.signal });
      const created = await createExisting(context.experimental_paths.dataDir, root, pathKey, sourcePath, resolved, { signal: context.signal });
      return { ...created, wtSetup: await runWtSetup(created.path, context.signal) };
    },
    async remove({ pathKey }, context) {
      await removeWorktree(context.experimental_paths.dataDir, pathKey,
        (target) => experimental_killProcessesWithCwdUnder({ directories: [target] }), context.signal);
      return { status: "removed" as const };
    },
  },
});
