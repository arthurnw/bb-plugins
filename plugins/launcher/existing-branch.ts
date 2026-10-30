import { z } from "zod";
import { branchNameError } from "./named-worktree.ts";

export const EXISTING_PROVIDER_ID = "existing-branch";

/** `ref` is what the user typed: a PR number or URL, or a branch name. `review` starts the thread with a guided review. */
export const existingInputsSchema = z.object({
  ref: z.string().min(1),
  review: z.boolean(),
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

/** Sent as a follow-up message when Review is on. */
export function reviewPrompt({ branch, base, pr }: { branch: string; base: string; pr: PrInfo | null }): string {
  const subject = pr ? `PR #${pr.number} "${pr.title}" (${pr.url})` : `branch ${branch}`;
  return [
    `Review ${subject}. This worktree has it checked out.`,
    `Read the changes with \`git diff $(git merge-base HEAD ${base})...HEAD\` and open the files they touch for context.`,
    "Then write a Plannotator guided review of the change: use the plannotator skill, read the guide brief with the Inbox tool's get_guide_brief action, and send the result with submit_guide.",
    "Do not edit files or push anything.",
  ].join("\n");
}
