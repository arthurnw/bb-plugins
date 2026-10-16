import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { inputsSchema } from "./named-worktree.ts";

const source = z.object({ sourcePath: z.string().min(1), inputs: inputsSchema });
const launch = source.extend({ pathKey: z.string().min(1), restore: z.boolean() });
export const hostContract = defineRpcContract({
  validate: { input: source, output: z.object({ error: z.string().nullable() }) },
  target: { input: launch, output: z.object({ path: z.string() }) },
  create: { input: launch, output: z.object({ path: z.string() }) },
  remove: { input: z.object({ pathKey: z.string().min(1) }), output: z.object({ status: z.literal("removed") }) },
});
