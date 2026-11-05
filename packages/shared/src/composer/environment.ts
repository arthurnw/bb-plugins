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
