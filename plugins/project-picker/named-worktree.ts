import { z } from "zod";

export const PROVIDER_ID = "named-worktree";

// Git checks the rest on the host; `check-ref-format --branch` would expand `@{-1}`.
export function branchNameError(name: string): string | null {
  if (!name) return "Enter a new branch name.";
  if (name.startsWith("-") || name.includes("@{")) return "Enter a literal Git branch name, without revision shorthand.";
  return null;
}

export const inputsSchema = z.object({
  name: z.string().refine((name) => branchNameError(name) === null, { message: "Enter a new Git branch name." }),
  baseBranch: z.string().min(1, "Choose a base branch."),
}).strict();
export type NamedWorktreeInputs = z.infer<typeof inputsSchema>;
