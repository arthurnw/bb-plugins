import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { parseRef, prInfoSchema, type PrInfo, type Resolved } from "./existing-branch.ts";
import { branchExists, copyIncluded, defaultBase, git, planWorktree, registeredBranch } from "./worktree.ts";

const execFileAsync = promisify(execFile);

export type Gh = (cwd: string, args: string[], signal?: AbortSignal) => Promise<string>;

export const gh: Gh = async (cwd, args, signal) => {
  try {
    const { stdout } = await execFileAsync("gh", args, { cwd, signal, maxBuffer: 8 * 1024 * 1024, timeout: 60_000,
      env: { ...process.env, GH_PROMPT_DISABLED: "1", GIT_TERMINAL_PROMPT: "0" } });
    return stdout.trimEnd();
  } catch (error) {
    signal?.throwIfAborted();
    const { stderr, code } = error as { stderr?: string; code?: string };
    throw new Error(code === "ENOENT" ? "The gh CLI is not installed." : stderr?.trim() || (error as Error).message);
  }
};

const PR_FIELDS = "number,title,state,baseRefName,headRefName,isCrossRepository,url";

/** The directory where `branch` is checked out in any worktree of `source` (including the source itself), or null. */
export async function branchCheckedOutAt(source: string, branch: string, signal?: AbortSignal): Promise<string | null> {
  const list = await git(source, ["worktree", "list", "--porcelain", "-z"], signal);
  for (const entry of list.split("\0\0")) {
    const lines = entry.split("\0");
    if (lines.includes(`branch refs/heads/${branch}`)) return lines[0]!.slice("worktree ".length);
  }
  return null;
}

async function fetchBranch(source: string, name: string, signal?: AbortSignal) {
  await git(source, ["fetch", "--quiet", "origin", name], signal).catch(() => signal?.throwIfAborted());
}

const remoteBranchExists = (source: string, name: string, signal?: AbortSignal) =>
  git(source, ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${name}^{commit}`], signal).then(() => true, () => { signal?.throwIfAborted(); return false; });

/** The PR for a same-repository head branch, preferring an open one, or null (also when `gh` is unavailable). */
async function prForBranch(source: string, name: string, run: Gh, signal?: AbortSignal): Promise<PrInfo | null> {
  try {
    const rows = prInfoSchema.array().parse(JSON.parse(await run(source, ["pr", "list", "--head", name, "--state", "all", "--limit", "10", "--json", PR_FIELDS], signal)));
    const mine = rows.filter((pr) => !pr.isCrossRepository);
    return mine.find((pr) => pr.state === "OPEN") ?? mine[0] ?? null;
  } catch {
    signal?.throwIfAborted();
    return null;
  }
}

async function fromPr(source: string, pr: PrInfo, signal?: AbortSignal): Promise<Resolved> {
  const branch = pr.isCrossRepository ? `pr-${pr.number}` : pr.headRefName;
  await fetchBranch(source, pr.baseRefName, signal);
  return { kind: "pr", branch, pr, base: `origin/${pr.baseRefName}`, busyAt: await branchCheckedOutAt(source, branch, signal) };
}

/** Decides what a typed ref means and whether it can be checked out. Throws a user-readable message when it cannot. */
export async function resolveRef(source: string, text: string, { gh: run = gh, signal }: { gh?: Gh; signal?: AbortSignal } = {}): Promise<Resolved> {
  const parsed = parseRef(text);
  if (parsed.kind === "invalid") throw new Error(parsed.reason);
  if (parsed.kind === "pr") {
    const label = parsed.url ?? `#${parsed.number}`;
    let pr: PrInfo;
    try {
      pr = prInfoSchema.parse(JSON.parse(await run(source, ["pr", "view", parsed.url ?? String(parsed.number), "--json", PR_FIELDS], signal)));
    } catch (error) {
      signal?.throwIfAborted();
      throw new Error(`Could not read PR ${label}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
    return fromPr(source, pr, signal);
  }
  const pr = await prForBranch(source, parsed.name, run, signal);
  if (pr) return fromPr(source, pr, signal);
  await fetchBranch(source, parsed.name, signal);
  if (!await branchExists(source, parsed.name, signal) && !await remoteBranchExists(source, parsed.name, signal)) {
    throw new Error(`No branch named "${parsed.name}" locally or on origin.`);
  }
  return { kind: "branch", branch: parsed.name, pr: null, base: await defaultBase(source, { signal }),
    busyAt: await branchCheckedOutAt(source, parsed.name, signal) };
}

/** Why `resolved` cannot be checked out into `target` (null when it can). */
export function checkoutBlocker(resolved: Resolved, target: string | null = null): string | null {
  return resolved.busyAt !== null && resolved.busyAt !== target
    ? `Branch "${resolved.branch}" is already checked out at ${resolved.busyAt}.` : null;
}

export async function createExisting(dataDir: string, rootSetting: string, pathKey: string, source: string, resolved: Resolved,
  { gh: run = gh, signal }: { gh?: Gh; signal?: AbortSignal } = {}) {
  const { target } = await planWorktree(dataDir, rootSetting, pathKey, source, { name: resolved.branch, baseBranch: "" }, { signal });
  // A replay of this attempt resumes its own registered worktree.
  if (await registeredBranch(source, target, signal) === null) {
    const blocker = checkoutBlocker(resolved, target);
    if (blocker) throw new Error(blocker);
    await fs.mkdir(path.dirname(target), { recursive: true });
    if (resolved.pr?.isCrossRepository) {
      await git(source, ["worktree", "add", "--detach", "--", target, "HEAD"], signal);
      await run(target, ["pr", "checkout", String(resolved.pr.number), "--branch", resolved.branch], signal);
    } else {
      await fetchBranch(source, resolved.branch, signal);
      if (await branchExists(source, resolved.branch, signal)) {
        await git(source, ["worktree", "add", "--", target, resolved.branch], signal);
      } else if (await remoteBranchExists(source, resolved.branch, signal)) {
        await git(source, ["worktree", "add", "--track", "-b", resolved.branch, "--", target, `origin/${resolved.branch}`], signal);
      } else {
        throw new Error(`No branch named "${resolved.branch}" locally or on origin.`);
      }
    }
  }
  await copyIncluded(source, target, signal);
  return { path: target, name: resolved.branch, baseBranch: resolved.base };
}

export interface RefChoices {
  prs: Array<Pick<PrInfo, "number" | "title" | "headRefName" | "isCrossRepository" | "state">>;
  branches: string[];
  /** Set when open PRs could not be listed (for example, `gh` is missing or signed out). */
  prError: string | null;
}

/** Open PRs and remote branches (most recently updated first) to offer in the picker. */
export async function listRefs(source: string, { gh: run = gh, signal }: { gh?: Gh; signal?: AbortSignal } = {}): Promise<RefChoices> {
  const [prs, branches] = await Promise.all([
    run(source, ["pr", "list", "--state", "open", "--limit", "30", "--json", PR_FIELDS], signal)
      .then((text) => ({ prs: prInfoSchema.array().parse(JSON.parse(text)), prError: null as string | null }),
        (error: unknown) => { signal?.throwIfAborted(); return { prs: [], prError: error instanceof Error ? error.message : String(error) }; }),
    git(source, ["for-each-ref", "--sort=-committerdate", "--count=100", "--format=%(refname:short)", "refs/remotes/origin"], signal)
      .then((text) => text.split("\n").map((name) => name.replace(/^origin\//, "")).filter((name) => name && name !== "origin" && name !== "HEAD")),
  ]);
  return { prs: prs.prs.map(({ number, title, headRefName, isCrossRepository, state }) => ({ number, title, headRefName, isCrossRepository, state })),
    branches, prError: prs.prError };
}
