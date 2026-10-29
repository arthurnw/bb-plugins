import { execFile } from "node:child_process";
import { accessSync, constants, existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { branchNameError, type NamedWorktreeInputs } from "./named-worktree.ts";

const execFileAsync = promisify(execFile);

// Aborting kills git; the promise settles only after the child exits, so core
// never removes files under a running git.
export async function git(cwd: string, args: string[], signal?: AbortSignal): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd, signal, maxBuffer: 8 * 1024 * 1024, timeout: 60_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
    return stdout.trimEnd();
  } catch (error) {
    signal?.throwIfAborted();
    throw new Error((error as { stderr?: string }).stderr?.trim() || (error as Error).message);
  }
}

export async function validateBranchName(source: string, name: string, signal?: AbortSignal) {
  const error = branchNameError(name);
  if (error) throw new Error(error);
  await git(source, ["check-ref-format", "--branch", name], signal).catch((cause) => {
    signal?.throwIfAborted();
    throw new Error(`Invalid branch name: ${JSON.stringify(name)}.`, { cause });
  });
}

async function branchExists(source: string, name: string, signal?: AbortSignal) {
  return (await git(source, ["for-each-ref", "--format=%(refname)", `refs/heads/${name}`], signal))
    .split("\n").includes(`refs/heads/${name}`);
}

/** Checks that `inputs` can create a new branch; returns the base commit. An empty name checks only the base. */
export async function validateNewBranch(source: string, inputs: NamedWorktreeInputs, signal?: AbortSignal) {
  if (inputs.name !== "") {
    await validateBranchName(source, inputs.name, signal);
    if (await branchExists(source, inputs.name, signal)) throw new Error(`Branch "${inputs.name}" already exists. Choose a new branch name.`);
  }
  return git(source, ["rev-parse", "--verify", "--end-of-options", `${inputs.baseBranch}^{commit}`], signal);
}

/** `name`, or `name-2`, `name-3`, ... for the first that is not a branch yet. */
export async function freeBranchName(source: string, name: string, signal?: AbortSignal) {
  await validateBranchName(source, name, signal);
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? name : `${name}-${n}`;
    if (!await branchExists(source, candidate, signal)) return candidate;
  }
}

export function attemptRoot(dataDir: string, pathKey: string) {
  return path.join(dataDir, "worktrees", pathKey);
}

export function targetPath(dataDir: string, pathKey: string, source: string) {
  return path.join(attemptRoot(dataDir, pathKey), path.basename(source).replace(/\.git$/, ""));
}

async function readState(root: string) {
  const file = path.join(root, "attempt.json");
  if (!existsSync(file)) return null;
  return JSON.parse(await fs.readFile(file, "utf8")) as { source: string; target: string; name: string; baseBranch: string };
}

/** The branch checked out at `target`, "" if detached, or null if `target` is not a worktree of `source`. */
async function registeredBranch(source: string, target: string, signal?: AbortSignal) {
  const list = await git(source, ["worktree", "list", "--porcelain", "-z"], signal);
  const canonical = existsSync(target) ? await fs.realpath(target) : target;
  const entry = list.split("\0\0").find((entry) => entry.split("\0")[0] === `worktree ${canonical}`);
  return entry === undefined ? null : entry.split("\0").find((line) => line.startsWith("branch "))?.slice("branch refs/heads/".length) ?? "";
}

async function copyIncluded(source: string, target: string, signal?: AbortSignal) {
  if (!existsSync(path.join(source, ".worktreeinclude"))) return;
  const files = await git(source, ["ls-files", "--others", "--ignored", "--exclude-from=.worktreeinclude", "-z"], signal);
  for (const file of files.split("\0").filter(Boolean)) {
    signal?.throwIfAborted();
    const from = path.join(source, file), to = path.join(target, file);
    // Match built-in behavior: skip symlinks and never overwrite checkout files.
    if ((await fs.lstat(from)).isSymbolicLink()) continue;
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.copyFile(from, to, constants.COPYFILE_EXCL).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
  }
}

export interface CreateOptions {
  /** Check out the existing branch `inputs.name` instead of creating one. */
  restore?: boolean;
  /** `inputs.name` is a generated stem: add a numeric suffix instead of refusing an existing branch. */
  autoName?: boolean;
  signal?: AbortSignal;
}

export async function createWorktree(dataDir: string, pathKey: string, source: string,
  inputs: NamedWorktreeInputs, { restore = false, autoName = false, signal }: CreateOptions = {}) {
  const root = attemptRoot(dataDir, pathKey), target = targetPath(dataDir, pathKey, source);
  // A replay of this attempt resumes its own registered worktree, under the name it chose.
  const state = await readState(root);
  let name = state !== null && autoName && !restore ? state.name : inputs.name;
  const resumed = state !== null && await registeredBranch(source, target, signal) === name;
  if (!resumed) {
    if (restore && !await branchExists(source, name, signal)) throw new Error(`Cannot restore: branch "${name}" no longer exists.`);
    if (autoName && !restore) name = await freeBranchName(source, inputs.name, signal);
    const base = restore ? null : await validateNewBranch(source, { ...inputs, name }, signal);
    await fs.mkdir(root, { recursive: true });
    // Written before git runs so cleanup can find a partially created worktree.
    await fs.writeFile(path.join(root, "attempt.json"), JSON.stringify({ source, target, ...inputs, name }));
    await git(source, base === null ? ["worktree", "add", "--", target, name]
      : ["worktree", "add", "-b", name, "--", target, base], signal);
  }
  await copyIncluded(source, target, signal);
  return { path: target, name };
}

/** The `wt` executable on PATH or in ~/.local/bin, or null when it is not installed. */
export function findWt(env: NodeJS.ProcessEnv = process.env, home = os.homedir()): string | null {
  const dirs = [...(env.PATH ?? "").split(path.delimiter).filter(Boolean), path.join(home, ".local", "bin")];
  for (const dir of dirs) {
    const file = path.join(dir, "wt");
    try { accessSync(file, constants.X_OK); return file; } catch {}
  }
  return null;
}

export type WtSetupResult = { status: "done" | "failed"; output: string } | { status: "missing" };

/**
 * Runs `wt setup` (local files, branch documents, Direnv, setup commands) in a
 * new worktree. Failures are returned, not thrown, so a broken setup command
 * does not cost the thread its worktree.
 */
export async function runWtSetup(target: string, signal?: AbortSignal, wt = findWt()): Promise<WtSetupResult> {
  if (wt === null) return { status: "missing" };
  try {
    const { stdout, stderr } = await execFileAsync(wt, ["setup", target], { cwd: target, signal,
      maxBuffer: 8 * 1024 * 1024, timeout: 840_000 });
    return { status: "done", output: `${stdout}${stderr}`.trim() };
  } catch (error) {
    signal?.throwIfAborted();
    const { stdout = "", stderr = "", message } = error as { stdout?: string; stderr?: string; message: string };
    return { status: "failed", output: `${stdout}${stderr}`.trim() || message };
  }
}

export async function removeWorktree(dataDir: string, pathKey: string,
  killProcesses: (target: string) => Promise<unknown>, signal?: AbortSignal) {
  const root = attemptRoot(dataDir, pathKey), state = await readState(root);
  if (state) {
    await killProcesses(state.target);
    if (await registeredBranch(state.source, state.target, signal) !== null) {
      await git(state.source, ["worktree", "remove", "--force", "--", state.target], signal);
    }
  }
  signal?.throwIfAborted();
  await fs.rm(root, { recursive: true, force: true });
}
