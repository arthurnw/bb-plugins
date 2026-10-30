// Frontend-safe preset model. The zod schema lives in presets.schema.ts so the
// app bundle does not pull zod in. Adapted from Ultra Launcher; see
// THIRD_PARTY_LICENSES.md.
export type ReasoningLevel = string;
export const MAX_PRESETS = 30;

export interface ModelSelection {
  providerId: string;
  model: string;
  reasoningLevel: ReasoningLevel;
  serviceTier: string;
}
export interface ModelPreset extends ModelSelection {
  id: string;
  name: string;
}
export interface ModelState {
  presets: ModelPreset[];
  /** The last model chosen in the overlay; null until one is chosen. */
  selection: ModelSelection | null;
  /** Catalog display names by `modelKey`; a model missing here shows its id. */
  names: Record<string, string>;
}
export const modelKey = (value: Pick<ModelSelection, "providerId" | "model">) => `${value.providerId}::${value.model}`;

const EFFORT_LABELS: Record<string, string> = {
  none: "None", low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max", ultra: "Ultra", ultracode: "Ultra code",
};
export const effortLabel = (level: string) => EFFORT_LABELS[level] ?? level;
export const modelSpec = (value: ModelSelection, names: Record<string, string> = {}) =>
  `${names[modelKey(value)] ?? value.model} · ${effortLabel(value.reasoningLevel)}`;

export function sameModel(a: ModelSelection, b: { providerId: string; model: string; reasoningLevel: string; serviceTier?: string }): boolean {
  return a.providerId === b.providerId && a.model === b.model && a.reasoningLevel === b.reasoningLevel
    && a.serviceTier === (b.serviceTier ?? "default");
}

export function findPreset(presets: readonly ModelPreset[], selection: ModelSelection | null): ModelPreset | undefined {
  return selection ? presets.find((preset) => sameModel(preset, selection)) : undefined;
}

/** Case-insensitive match of every query word against a preset's name and model. */
export function filterPresets(presets: readonly ModelPreset[], query: string, names: Record<string, string> = {}): ModelPreset[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return presets.filter((preset) => {
    const haystack = `${preset.name} ${preset.providerId} ${modelSpec(preset, names)} ${preset.model}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}
