import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { inputsSchema } from "./named-worktree.ts";

const source = z.object({ sourcePath: z.string().min(1), inputs: inputsSchema });
const launch = source.extend({ pathKey: z.string().min(1), restore: z.boolean(), autoName: z.boolean() });
const wtSetup = z.discriminatedUnion("status", [
  z.object({ status: z.enum(["done", "failed"]), output: z.string() }),
  z.object({ status: z.literal("missing") }),
]);
export const hostContract = defineRpcContract({
  validate: { input: source, output: z.object({ error: z.string().nullable() }) },
  target: { input: launch, output: z.object({ path: z.string() }) },
  create: { input: launch, output: z.object({ path: z.string(), name: z.string(), baseBranch: z.string(), wtSetup }) },
  remove: { input: z.object({ pathKey: z.string().min(1) }), output: z.object({ status: z.literal("removed") }) },
});
