import { z } from "zod";
import { branchNameError } from "./named-worktree.ts";

export const EXISTING_PROVIDER_ID = "existing-branch";

/** `ref` is what the user typed: a PR number or URL, or a branch name. */
export const existingInputsSchema = z.object({
  ref: z.string().min(1),
}).strict();
export type ExistingInputs = z.infer<typeof existingInputsSchema>;

export type ParsedRef =
  | { kind: "pr"; number: number; url: string | null }
  | { kind: "branch"; name: string }
  | { kind: "invalid"; reason: string };

/** `123`, `#123` and `.../pull/123` are PRs; anything else is a branch, with a leading `origin/` dropped. */
export function parseRef(text: string): ParsedRef {
  const ref = text.trim();
  if (ref === "") return { kind: "invalid", reason: "Enter a PR number, a PR URL, or a branch name." };
  const number = /^#?(\d+)$/.exec(ref);
  if (number) return { kind: "pr", number: Number(number[1]), url: null };
  const url = /^https?:\/\/[^\s/]+\/[^\s/]+\/[^\s/]+\/pull\/(\d+)(?:[/?#].*)?$/.exec(ref);
  if (url) return { kind: "pr", number: Number(url[1]), url: ref };
  const name = ref.replace(/^origin\//, "");
  const error = branchNameError(name);
  return error ? { kind: "invalid", reason: error } : { kind: "branch", name };
}

export const prInfoSchema = z.object({
  number: z.number(),
  title: z.string(),
  state: z.enum(["OPEN", "CLOSED", "MERGED"]),
  baseRefName: z.string(),
  headRefName: z.string(),
  /** True when the head branch lives in a fork. */
  isCrossRepository: z.boolean(),
  url: z.string(),
});
export type PrInfo = z.infer<typeof prInfoSchema>;

/** What a ref resolved to on the host. `branch` is the local branch the worktree will have checked out. */
export const resolvedSchema = z.object({
  kind: z.enum(["pr", "branch"]),
  branch: z.string(),
  pr: prInfoSchema.nullable(),
  /** The ref to diff against: the PR's base, or the project's default branch. */
  base: z.string(),
  /** Where `branch` is already checked out, if anywhere. */
  busyAt: z.string().nullable(),
});
export type Resolved = z.infer<typeof resolvedSchema>;
