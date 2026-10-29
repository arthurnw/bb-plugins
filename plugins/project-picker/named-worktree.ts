import { z } from "zod";

export const PROVIDER_ID = "named-worktree";

// Git checks the rest on the host; `check-ref-format --branch` would expand `@{-1}`.
export function branchNameError(name: string): string | null {
  if (!name) return "Enter a new branch name.";
  if (name.startsWith("-") || name.includes("@{")) return "Enter a literal Git branch name, without revision shorthand.";
  return null;
}

/**
 * An empty `name` asks the provider to name the branch from the thread title;
 * an empty `baseBranch` means the project's default branch.
 */
export const inputsSchema = z.object({
  name: z.string().refine((name) => name === "" || branchNameError(name) === null, { message: "Enter a new Git branch name." }),
  baseBranch: z.string(),
}).strict();
export type NamedWorktreeInputs = z.infer<typeof inputsSchema>;

/**
 * bb's suggested branch name without its thread ID. bb suggests
 * `<prefix><title-slug>-<thread id>`, or `<prefix><thread id>` when the title
 * gives no slug; the second case falls back to a timestamp.
 */
export function autoBranchName(suggested: string, threadId: string, prefix: string, now = new Date()): string {
  if (!suggested.endsWith(threadId)) return suggested;
  const stem = suggested.slice(0, -threadId.length);
  if (stem.length > prefix.length + 1 && stem.endsWith("-")) return stem.slice(0, -1);
  const stamp = now.toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
  return `${prefix}thread-${stamp}`;
}
