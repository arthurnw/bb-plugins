import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";
import { branchNameError, type NamedWorktreeInputs } from "./named-worktree.ts";

export function git(cwd: string, args: string[], signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    // Wait for the child to close on abort before core starts removing its files.
    const child = execFile("git", args, { cwd, maxBuffer: 8 * 1024 * 1024, timeout: 60_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }, (error, stdout, stderr) => {
      signal?.removeEventListener("abort", abort);
      if (timer) clearTimeout(timer);
      if (signal?.aborted) reject(signal.reason);
      else if (error) reject(new Error(stderr.trim() || error.message));
      else resolve(stdout.trimEnd());
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const abort = () => {
      child.kill("SIGTERM");
      timer = setTimeout(() => child.kill("SIGKILL"), 1_000);
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

export async function validateBranchName(source: string, name: string, signal?: AbortSignal) {
  const error = branchNameError(name);
  if (error) throw new Error(error);
  try { await git(source, ["check-ref-format", "--branch", name], signal); }
  catch (error) {
    signal?.throwIfAborted();
    throw new Error(`Invalid branch name: ${JSON.stringify(name)}.`, { cause: error });
  }
}

async function branchExists(source: string, name: string, signal?: AbortSignal) {
  return (await git(source, ["for-each-ref", "--format=%(refname)", `refs/heads/${name}`], signal))
    .split("\n").includes(`refs/heads/${name}`);
}

export async function validateNewBranch(source: string, inputs: NamedWorktreeInputs, signal?: AbortSignal) {
  await validateBranchName(source, inputs.name, signal);
  if (await branchExists(source, inputs.name, signal)) throw new Error(`Branch "${inputs.name}" already exists. Choose a new branch name.`);
  await git(source, ["rev-parse", "--verify", "--end-of-options", `${inputs.baseBranch}^{commit}`], signal);
}

export function attemptRoot(dataDir: string, pathKey: string) {
  if (!/^[A-Za-z0-9_][A-Za-z0-9._-]*$/.test(pathKey)) throw new Error("Invalid worktree path key.");
  return path.join(dataDir, "worktrees", pathKey);
}

export function targetPath(dataDir: string, pathKey: string, source: string) {
  const name = path.basename(source).replace(/\.git$/, "");
  const safe = /^[A-Za-z0-9._][A-Za-z0-9._-]*$/.test(name) && name !== "." && name !== ".."
    && !name.endsWith(".") && !/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name) && name.length <= 200;
  const directory = safe ? name : `${name.normalize("NFKD").replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 170) || "repo"}-${createHash("sha256").update(name).digest("hex").slice(0, 16)}`;
  return path.join(attemptRoot(dataDir, pathKey), directory);
}

async function readState(root: string) {
  try { return JSON.parse(await fs.readFile(path.join(root, "attempt.json"), "utf8")) as {
    source: string; target: string; name: string; baseBranch: string;
  }; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function registeredBranch(source: string, target: string, signal?: AbortSignal) {
  const list = await git(source, ["worktree", "list", "--porcelain", "-z"], signal);
  const canonical = await fs.realpath(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return target;
    throw error;
  });
  const entry = list.split("\0\0").find((entry) => entry.split("\0")[0] === `worktree ${canonical}`);
  return entry === undefined ? null : entry.split("\0").find((line) => line.startsWith("branch "))?.slice("branch refs/heads/".length) ?? "";
}

async function copyIncluded(source: string, target: string, signal?: AbortSignal) {
  try { await fs.access(path.join(source, ".worktreeinclude")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  const files = await git(source, ["ls-files", "--others", "--ignored", "--exclude-from=.worktreeinclude", "-z"], signal);
  const root = await fs.realpath(target);
  for (const file of files.split("\0").filter(Boolean)) {
    signal?.throwIfAborted();
    const from = path.join(source, file), to = path.join(root, file);
    // Match built-in behavior: skip symlinks and never overwrite checkout files.
    if ((await fs.lstat(from)).isSymbolicLink()) continue;
    await fs.mkdir(path.dirname(to), { recursive: true });
    const parent = await fs.realpath(path.dirname(to));
    const relative = path.relative(root, parent);
    if (relative.startsWith("..") || path.isAbsolute(relative)) continue;
    try { await fs.copyFile(from, to, constants.COPYFILE_EXCL); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  }
}

export async function createWorktree(dataDir: string, pathKey: string, source: string,
  inputs: NamedWorktreeInputs, restore: boolean, signal?: AbortSignal) {
  await validateBranchName(source, inputs.name, signal);
  const root = attemptRoot(dataDir, pathKey), target = targetPath(dataDir, pathKey, source);
  const state = await readState(root);
  if (state && (state.source !== source || state.target !== target || state.name !== inputs.name || state.baseBranch !== inputs.baseBranch)) {
    throw new Error("Worktree attempt inputs changed; refusing to reuse its directory.");
  }
  // A replay may resume only this attempt's registered worktree, never someone else's branch.
  const resumed = state !== null && await registeredBranch(source, target, signal) === inputs.name;
  if (!resumed) {
    if (restore) {
      if (!await branchExists(source, inputs.name, signal)) throw new Error(`Cannot restore: branch "${inputs.name}" no longer exists.`);
    } else await validateNewBranch(source, inputs, signal);
    const base = restore ? inputs.name : await git(source, ["rev-parse", "--verify", "--end-of-options", `${inputs.baseBranch}^{commit}`], signal);
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, "attempt.json.tmp"), JSON.stringify({ source, target, ...inputs }));
    await fs.rename(path.join(root, "attempt.json.tmp"), path.join(root, "attempt.json"));
    await git(source, restore ? ["worktree", "add", "--", target, base]
      : ["worktree", "add", "-b", inputs.name, "--", target, base], signal);
  }
  await copyIncluded(source, target, signal);
  return target;
}

export async function removeWorktree(dataDir: string, pathKey: string,
  killProcesses: (target: string) => Promise<unknown>, signal?: AbortSignal) {
  const root = attemptRoot(dataDir, pathKey), state = await readState(root);
  if (!state) {
    // Git mutations begin only after the attempt record is atomically installed.
    signal?.throwIfAborted();
    await fs.rm(root, { recursive: true, force: true });
    return;
  }
  if (state.target !== targetPath(dataDir, pathKey, state.source)) throw new Error("Invalid worktree cleanup path.");
  signal?.throwIfAborted();
  await killProcesses(state.target);
  if (await registeredBranch(state.source, state.target, signal) !== null) {
    await git(state.source, ["worktree", "remove", "--force", "--", state.target], signal);
  }
  signal?.throwIfAborted();
  await fs.rm(root, { recursive: true, force: true });
}
