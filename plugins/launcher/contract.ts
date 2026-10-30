import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { resolvedSchema } from "./existing-branch.ts";
import { inputsSchema } from "./named-worktree.ts";

// `root` is the raw "Worktree root" setting; each host expands and checks it.
const source = z.object({ sourcePath: z.string().min(1), inputs: inputsSchema, root: z.string() });
const launch = source.extend({ pathKey: z.string().min(1), restore: z.boolean(), autoName: z.boolean() });
const wtSetup = z.discriminatedUnion("status", [
  z.object({ status: z.enum(["done", "failed"]), output: z.string() }),
  z.object({ status: z.literal("missing") }),
]);
const existing = z.object({ sourcePath: z.string().min(1), ref: z.string().min(1) });
const existingLaunch = existing.extend({ pathKey: z.string().min(1), root: z.string() });
export const refChoicesSchema = z.object({
  prs: z.array(z.object({ number: z.number(), title: z.string(), headRefName: z.string(), isCrossRepository: z.boolean(), state: z.enum(["OPEN", "CLOSED", "MERGED"]) })),
  branches: z.array(z.string()),
  prError: z.string().nullable(),
});
export const hostContract = defineRpcContract({
  validate: { input: source, output: z.object({ error: z.string().nullable() }) },
  target: { input: launch, output: z.object({ path: z.string() }) },
  create: { input: launch, output: z.object({ path: z.string(), name: z.string(), baseBranch: z.string(), wtSetup }) },
  // `resolved` is null with `error` set when the ref cannot be used.
  resolveRef: { input: existing, output: z.object({ resolved: resolvedSchema.nullable(), error: z.string().nullable() }) },
  listRefs: { input: z.object({ sourcePath: z.string().min(1) }), output: refChoicesSchema },
  existingTarget: { input: existingLaunch, output: z.object({ path: z.string() }) },
  existingCreate: { input: existingLaunch, output: z.object({ path: z.string(), name: z.string(), baseBranch: z.string(), wtSetup }) },
  remove: { input: z.object({ pathKey: z.string().min(1) }), output: z.object({ status: z.literal("removed") }) },
});
