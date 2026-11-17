import { z } from "zod";
import { BOT_ENVIRONMENTS } from "@arthurnw/bb-shared/bots";
import { selectionSchema } from "@arthurnw/bb-shared/selection/schema";
import { STARTER_NAME_MAX, STARTER_TEXT_MAX, STARTERS_MAX, type Starter, type StarterDraft } from "./starters.ts";

export const starterDraftSchema: z.ZodType<StarterDraft, unknown> = z.object({
  name: z.string().trim().min(1).max(STARTER_NAME_MAX),
  emoji: z.string().trim().max(16).default(""),
  model: selectionSchema.nullable().default(null),
  starterPrompt: z.string().max(STARTER_TEXT_MAX).default(""),
  instructions: z.string().max(STARTER_TEXT_MAX).default(""),
  projectId: z.string().min(1).nullable().default(null),
  environment: z.enum(BOT_ENVIRONMENTS).nullable().default(null),
  permissionMode: z.enum(["accept-edits", "auto", "full"]).nullable().default(null),
});

export const starterSchema: z.ZodType<Starter, unknown> = z.intersection(starterDraftSchema,
  z.object({ id: z.string().min(1), importedFrom: z.string().nullable().default(null) }));

export const startersSchema = z.array(starterSchema).max(STARTERS_MAX * 2).superRefine((starters, ctx) => {
  const names = new Set<string>();
  for (const starter of starters) {
    const key = starter.name.toLowerCase();
    if (names.has(key)) ctx.addIssue({ code: "custom", message: `Two starters are named "${starter.name}".` });
    names.add(key);
  }
});
