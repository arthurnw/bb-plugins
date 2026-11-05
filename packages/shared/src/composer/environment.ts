import { BOT_ENVIRONMENTS, type BotEnvironment } from "../bots.ts";

/** Seeds the project checkout on a chosen machine; no machine leaves the composer's default. */
export function checkoutOn(hostId: string | null) {
  return hostId ? { type: "host" as const, hostId, workspace: { type: "unmanaged" as const, path: null } } : undefined;
}

/**
 * The environment a handoff or new thread starts in when nothing else seeds
 * one: the source thread's environment while the project is unchanged,
 * otherwise a project checkout.
 */
export function reuseOrCheckout(projectId: string | null, source: { projectId: string | null; environmentId: string | null }, hostId: string | null) {
  return projectId === source.projectId && source.environmentId
    ? { type: "reuse" as const, environmentId: source.environmentId }
    : checkoutOn(hostId);
}

/** The initial prompt of a handoff: a mention of the source thread, then the starter text. */
export function handoffPrompt(sourceThreadId: string | null, starter: string): string | undefined {
  return (sourceThreadId ? `@thread:${sourceThreadId} ` : "") + starter || undefined;
}

/** Environment providers the Launcher plugin registers. */
export const NAMED_WORKTREE_PROVIDER = "named-worktree";
export const EXISTING_BRANCH_PROVIDER = "existing-branch";

/** The environments a bot may use: Named worktree and Existing branch / PR need the Launcher's providers. */
export const availableEnvironments = (launcher: boolean): readonly BotEnvironment[] => launcher ? BOT_ENVIRONMENTS : ["checkout"];

/** The composer environment a bot asks for, or undefined to keep the composer's own default. */
export function environmentFor(kind: BotEnvironment | null, hostId: string | null, launcher: boolean) {
  if (kind === null || !availableEnvironments(launcher).includes(kind)) return undefined;
  if (kind === "checkout") return checkoutOn(hostId);
  const machine = hostId ? { machine: { type: "existing" as const, hostId } } : {};
  return { type: "provider" as const, environmentProviderId: kind === "named-worktree" ? NAMED_WORKTREE_PROVIDER : EXISTING_BRANCH_PROVIDER, inputs: null, ...machine };
}
