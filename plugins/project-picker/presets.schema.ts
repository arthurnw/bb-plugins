import { z } from "zod";
import { MAX_PRESETS, type ModelPreset, type ModelSelection, type ModelState } from "./presets.ts";

export const selectionSchema: z.ZodType<ModelSelection, unknown> = z.object({
  providerId: z.string().trim().min(1).max(256),
  model: z.string().trim().min(1).max(512),
  reasoningLevel: z.string().trim().min(1).max(64),
  serviceTier: z.string().trim().min(1).max(64).default("default"),
});
const presetSchema: z.ZodType<ModelPreset, unknown> = z.object({
  id: z.string().min(1).max(80),
  name: z.string().trim().min(1).max(80),
  providerId: z.string().trim().min(1).max(256),
  model: z.string().trim().min(1).max(512),
  reasoningLevel: z.string().trim().min(1).max(64),
  serviceTier: z.string().trim().min(1).max(64).default("default"),
});
export const presetsSchema = z.array(presetSchema).max(MAX_PRESETS)
  .refine((items) => new Set(items.map((item) => item.id)).size === items.length, "Preset IDs must be unique");
/** What is saved. */
export const savedModelStateSchema: z.ZodType<{ presets: ModelPreset[]; selection: ModelSelection | null }, unknown> = z.object({
  presets: presetsSchema,
  selection: selectionSchema.nullable(),
});
/** What the overlay reads: the saved state plus display names from the live catalog. */
export const modelStateSchema: z.ZodType<ModelState, unknown> = z.object({
  presets: presetsSchema,
  selection: selectionSchema.nullable(),
  names: z.record(z.string(), z.string()),
});
