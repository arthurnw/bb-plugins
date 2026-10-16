import { z } from "zod";

export const PROVIDER_ID = "named-worktree";

// Reject revision shorthand here; Git performs the authoritative check on the host.
export function branchNameError(name: string): string | null {
  if (!name) return "Enter a new branch name.";
  if (name !== name.trim() || name.startsWith("-") || name.includes("@{") || name.includes("\0")) {
    return "Enter a literal Git branch name, without whitespace at the ends or revision shorthand.";
  }
  return null;
}

export const inputsSchema = z.object({
  name: z.string().refine((name) => branchNameError(name) === null, { message: "Enter a new Git branch name." }),
  baseBranch: z.string().min(1, "Choose a base branch.").refine((name) => !name.startsWith("-") && !name.includes("\0")),
}).strict();
export type NamedWorktreeInputs = z.infer<typeof inputsSchema>;
