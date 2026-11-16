// Initiative bots: one coordinator thread per bot, and workers below it.
// Pure helpers, so the server and tests share them.
import { NAME_MAX, oneLine, ownerOf, type Bot, type OwnerLookup } from "@arthurnw/bb-shared/bots";
import type { ModelSelection } from "@arthurnw/bb-shared/selection";

export const COORDINATOR_SKILL = "bot-coordinator";
export const WORKSPACE_PROVIDER = "bots-workspace";

export type ThreadRole =
  | { kind: "coordinator"; bot: Bot }
  | { kind: "worker"; bot: Bot }
  | { kind: "persona"; bot: Bot };

type Thread = { id: string; parentThreadId: string | null; sourceThreadId: string | null };

/**
 * A thread's role comes from its place in the tree: the bot's coordinator
 * thread, any other thread owned by an initiative bot (a descendant, or a
 * promoted thread), or a thread of a persona bot.
 */
export function roleOf(store: OwnerLookup & { get(botId: string): Bot | null; coordinatedBy(threadId: string): Bot | null }, thread: Thread): ThreadRole | null {
  const coordinated = store.coordinatedBy(thread.id);
  if (coordinated) return { kind: "coordinator", bot: coordinated };
  const botId = ownerOf(store, thread);
  const bot = botId === null ? null : store.get(botId);
  if (!bot) return null;
  return { kind: bot.coordinatorThreadId === null ? "persona" : "worker", bot };
}

/** A bot name from the brief's first non-empty line, unique among `taken` (case-insensitive). */
export function nameFromBrief(brief: string, taken: readonly string[]): string {
  // Mentions and markdown markers read badly as a name.
  const line = oneLine((brief.split("\n").find((item) => item.trim()) ?? "").replace(/@\S+/g, "")).replace(/^[#>*\-\s]+/, "");
  const words = line.split(" ");
  let base = "";
  for (const word of words) {
    if ((base ? `${base} ${word}` : word).length > NAME_MAX - 4) break;
    base = base ? `${base} ${word}` : word;
  }
  base = base || line.slice(0, NAME_MAX - 4) || "Initiative";
  const used = new Set(taken.map((name) => name.toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) if (!used.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
}

const modelFlags = (model: ModelSelection) =>
  `--provider ${model.providerId} --model ${model.model} --reasoning-level ${model.reasoningLevel}${model.serviceTier && model.serviceTier !== "default" ? ` --service-tier ${model.serviceTier}` : ""}`;

export interface CoordinatorContext {
  projectId: string;
  projectName: string;
  /** The project's checkout on this machine, when known. */
  checkoutPath: string | null;
}

/** Short instructions for the coordinator thread; the method lives in the coordinator skill. */
export function coordinatorInstructions(bot: Bot, context: CoordinatorContext): string {
  const workspace = bot.workspacePath ?? "(not provisioned)";
  const lines = [
    `# Initiative bot: ${oneLine(bot.name)}`,
    `You are the coordinator of the "${oneLine(bot.name)}" initiative. Load the \`${COORDINATOR_SKILL}\` skill now and follow it: it says how you plan, delegate to worker threads, review, and keep state.`,
    "",
    `- Bot workspace (your working directory, the only place you write files): \`${workspace}\``,
    `- State files: \`${workspace}/tracker.md\` (current state) and \`${workspace}/log.md\` (history). Read tracker.md before anything else. If it does not exist, your first task is writing it from the brief.`,
    `- Project: ${oneLine(context.projectName)} (\`${context.projectId}\`)${context.checkoutPath ? `; checkout at \`${context.checkoutPath}\` (read it at \`origin/main\`; never edit it)` : ""}.`,
    bot.workerModel
      ? `- Default worker model: \`${modelFlags(bot.workerModel)}\`. Use another model or Launcher preset when a task calls for it.`
      : "- Default worker model: the project's default. Pick a model per task when it matters.",
    "- You never edit code. Every change goes to a worker thread (`bb thread spawn --parent-self`), one per PR, in its own worktree.",
    `- After a compaction, reread tracker.md, the log.md entries since tracker.md's status date, and live \`gh\`/git state for each listed PR.`,
  ];
  return lines.join("\n");
}

/** Instructions for any other thread of an initiative bot. */
export function workerInstructions(bot: Bot): string {
  const lines = [
    `# Initiative bot: ${oneLine(bot.name)} (worker)`,
    `This thread is a worker of the "${oneLine(bot.name)}" initiative. Its coordinator is thread ${bot.coordinatorThreadId}.`,
    "",
    "- Stay in your worktree and work toward one PR.",
    "- Report to your parent (the coordinator) when you are done, blocked, or failed. bb sends your final response to it; make that response the report.",
    "- If the user steered you directly, say in your report what they asked and what you changed.",
    `- Don't write the bot's state files${bot.workspacePath ? ` in \`${bot.workspacePath}\`` : ""}; only the coordinator does.`,
  ];
  return lines.join("\n");
}

/** The first message of a coordinator: the user's brief, plus how to start. */
export const COORDINATOR_KICKOFF = "This is the brief for a new initiative. Start by writing tracker.md in the bot workspace from it, following the bot-coordinator skill, then tell the user the plan and any open questions.";
