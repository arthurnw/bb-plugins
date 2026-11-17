// Starters: saved ways to start a thread (name, model, starter prompt,
// instructions, project, environment, permission mode). They replace the Bots
// plugin's persona bots, which are imported once. Frontend-safe: no zod.
import { oneLine, type Bot, type BotEnvironment, type PermissionMode } from "@arthurnw/bb-shared/bots";
import type { ModelSelection } from "@arthurnw/bb-shared/selection";

export const STARTERS_MAX = 50;
export const STARTER_NAME_MAX = 40;
export const STARTER_TEXT_MAX = 2000;
/** Where a thread records its Starter, under the Launcher's plugin metadata. */
export const STARTER_METADATA_KEY = "starterId";

export interface StarterDraft {
  name: string;
  emoji: string;
  model: ModelSelection | null;
  starterPrompt: string;
  instructions: string;
  projectId: string | null;
  environment: BotEnvironment | null;
  permissionMode: PermissionMode | null;
}
export interface Starter extends StarterDraft {
  id: string;
  /** The persona bot this Starter was imported from. */
  importedFrom: string | null;
}

export const emptyStarter = (name: string): StarterDraft =>
  ({ name, emoji: "", model: null, starterPrompt: "", instructions: "", projectId: null, environment: null, permissionMode: null });

/** The Starter's addition to a thread's instructions. */
export function starterInstructions(starter: Pick<Starter, "name" | "instructions">): string | null {
  if (!starter.instructions.trim()) return null;
  return [
    `# Starter: ${oneLine(starter.name)}`,
    `The user started this thread with the "${oneLine(starter.name)}" starter. Its instructions add to the user's and the project's instructions and do not override them.`,
    `## Starter instructions\n${starter.instructions.trim()}`,
  ].join("\n\n");
}

/**
 * Adds a Starter for every persona bot (one without a coordinator thread) not
 * yet imported, after the existing Starters and in the bots' order. Returns
 * null when nothing is new.
 */
export function importPersonaBots(starters: readonly Starter[], bots: readonly Bot[], newId: () => string): Starter[] | null {
  const imported = new Set(starters.map((starter) => starter.importedFrom).filter((id): id is string => id !== null));
  const names = new Set(starters.map((starter) => starter.name.toLowerCase()));
  const added: Starter[] = [];
  for (const bot of bots) {
    if (bot.coordinatorThreadId !== null || imported.has(bot.id)) continue;
    let name = bot.name.slice(0, STARTER_NAME_MAX);
    for (let n = 2; names.has(name.toLowerCase()); n++) name = `${bot.name.slice(0, STARTER_NAME_MAX - 3)} ${n}`;
    names.add(name.toLowerCase());
    added.push({ id: newId(), importedFrom: bot.id, name, emoji: bot.emoji, model: bot.model, starterPrompt: bot.starterPrompt,
      instructions: bot.instructions, projectId: bot.projectId, environment: bot.environment, permissionMode: bot.permissionMode });
  }
  if (added.length === 0) return null;
  return [...starters, ...added].slice(0, Math.max(STARTERS_MAX, starters.length));
}

/** The Starter id a submission or thread metadata names, if any. */
export function starterIdIn(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const id = (value as Record<string, unknown>)[STARTER_METADATA_KEY];
  return typeof id === "string" && id !== "" ? id : null;
}
