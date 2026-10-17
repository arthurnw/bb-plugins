import { execFile } from "node:child_process";
import { constants, existsSync } from "node:fs";
import * as fs from "node:fs/promises";
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

/** Checks that `inputs` can create a new branch; returns the base commit. */
export async function validateNewBranch(source: string, inputs: NamedWorktreeInputs, signal?: AbortSignal) {
  await validateBranchName(source, inputs.name, signal);
  if (await branchExists(source, inputs.name, signal)) throw new Error(`Branch "${inputs.name}" already exists. Choose a new branch name.`);
  return git(source, ["rev-parse", "--verify", "--end-of-options", `${inputs.baseBranch}^{commit}`], signal);
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

export async function createWorktree(dataDir: string, pathKey: string, source: string,
  inputs: NamedWorktreeInputs, restore: boolean, signal?: AbortSignal) {
  const root = attemptRoot(dataDir, pathKey), target = targetPath(dataDir, pathKey, source);
  // A replay of this attempt resumes its own registered worktree.
  const resumed = await readState(root) !== null && await registeredBranch(source, target, signal) === inputs.name;
  if (!resumed) {
    if (restore && !await branchExists(source, inputs.name, signal)) throw new Error(`Cannot restore: branch "${inputs.name}" no longer exists.`);
    const base = restore ? null : await validateNewBranch(source, inputs, signal);
    await fs.mkdir(root, { recursive: true });
    // Written before git runs so cleanup can find a partially created worktree.
    await fs.writeFile(path.join(root, "attempt.json"), JSON.stringify({ source, target, ...inputs }));
    await git(source, base === null ? ["worktree", "add", "--", target, inputs.name]
      : ["worktree", "add", "-b", inputs.name, "--", target, base], signal);
  }
  await copyIncluded(source, target, signal);
  return target;
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
