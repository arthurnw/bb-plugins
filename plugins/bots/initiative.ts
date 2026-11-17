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

// Words that carry no meaning in a name.
const FILLER = new Set(("a an the this that these those it its is are was were be been am i im we you me us my our your "
  + "of to for in on at by with from into about and or but so as just please let lets can could would should will want need "
  + "some any here there do does make create build start help go get try").split(" "));

/**
 * A short placeholder name from the brief's first non-empty line: up to three
 * words that are not filler, in title case, unique among `taken`
 * (case-insensitive). The coordinator replaces it with a better one.
 */
export function nameFromBrief(brief: string, taken: readonly string[]): string {
  // Mentions and markdown markers read badly as a name.
  const line = oneLine((brief.split("\n").find((item) => item.trim()) ?? "").replace(/@\S+/g, "")).replace(/^[#>*\-\s]+/, "");
  const words = line.split(/[^\p{L}\p{N}'-]+/u).filter(Boolean);
  const content = words.filter((word) => !FILLER.has(word.toLowerCase().replace(/'/g, "")));
  let base = "";
  for (const word of (content.length > 0 ? content : words).slice(0, 3)) {
    const next = base ? `${base} ${word}` : word;
    if (next.length > NAME_MAX - 4) break;
    base = next;
  }
  base = base.replace(/(^|\s)(\p{Ll})/gu, (_, space: string, letter: string) => space + letter.toUpperCase()) || "Initiative";
  const used = new Set(taken.map((name) => name.toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) if (!used.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
}

/**
 * A readable folder name for a bot workspace: the name's first words as a slug,
 * plus the start of the bot id so two bots with the same name stay apart.
 */
export function workspaceDirName(name: string, botId: string): string {
  let slug = "";
  for (const word of name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean)) {
    if ((slug ? `${slug}-${word}` : word).length > 40) break;
    slug = slug ? `${slug}-${word}` : word;
  }
  const suffix = botId.replace(/[^a-z0-9]/gi, "").slice(0, 4).toLowerCase();
  return slug ? `${slug}-${suffix}` : `bot-${suffix}`;
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

/** The kickoff, plus a request to name the bot when the user left the name to Bots. */
export function coordinatorKickoff(placeholderName: string | null): string {
  if (placeholderName === null) return COORDINATOR_KICKOFF;
  return `${COORDINATOR_KICKOFF}\n\nFirst, name the bot: its name "${placeholderName}" is a placeholder taken from the brief. Pick a short noun phrase of one to three words, in title case, that names the initiative (like "Workflow Test" or "Billing Migration"), and run \`bb bots rename "<name>"\`. Don't mention the renaming to the user.`;
}
