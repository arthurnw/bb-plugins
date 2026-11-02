import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { PROVIDERS } from "./providers.ts";

export const costResultSchema = z.object({
  usd: z.number(),
  models: z.array(z.object({
    model: z.string(),
    requests: z.number(),
    input: z.number(),
    output: z.number(),
    cacheRead: z.number(),
    cacheWrite: z.number(),
    usd: z.number().nullable(),
  })),
  unpricedModels: z.array(z.string()),
  missing: z.array(z.string()),
  files: z.number(),
});
export type CostResultData = z.infer<typeof costResultSchema>;

export const hostContract = defineRpcContract({
  cost: {
    input: z.object({
      provider: z.enum(PROVIDERS),
      sessionIds: z.array(z.string().min(1)),
      bbDataDir: z.string().nullable(),
    }),
    output: costResultSchema,
    experimental_retryable: true,
  },
});
