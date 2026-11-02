import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { costResultSchema } from "./contract.ts";

const threadCostSchema = z.object({
  provider: z.string(),
  /** Null for providers this plugin can't read. */
  own: costResultSchema.nullable(),
  /** Own cost plus every descendant thread's. */
  totalUsd: z.number(),
  childCount: z.number(),
});
export type ThreadCost = z.infer<typeof threadCostSchema>;

export const costTag = (threadId: string) => `cost:${threadId}`;

export const rpcContract = defineRpcContract({
  threadCosts: {
    input: z.object({ keys: z.array(z.string()) }),
    output: z.record(z.string(), threadCostSchema.nullable()),
    keyTags: (key) => [costTag(key)],
  },
});

