import { execFile } from "node:child_process";
import { accessSync, constants, existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { branchNameError, type NamedWorktreeInputs } from "./named-worktree.ts";
import { DEFAULT_ROOT } from "./worktree-root.ts";

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

/**
 * The project's default branch, chosen like bb's built-in Worktree: origin's
 * HEAD (e.g. `origin/main`), fetched first when `fetch` is set (best effort,
 * so offline use still works), unless the local branch is ahead or has
 * diverged; then the local branch, keeping its commits. Without origin's HEAD,
 * the source checkout's current branch.
 */
export async function defaultBase(source: string, { fetch = false, signal }: { fetch?: boolean; signal?: AbortSignal } = {}) {
  const remote = await git(source, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], signal).catch(() => "");
  if (remote.startsWith("origin/")) {
    const local = remote.slice("origin/".length);
    if (fetch) await git(source, ["fetch", "--quiet", "origin", local], signal).catch(() => signal?.throwIfAborted());
    if (!await branchExists(source, local, signal)) return remote;
    const behindOrEqual = await git(source, ["merge-base", "--is-ancestor", `refs/heads/${local}`, `refs/remotes/${remote}`], signal)
      .then(() => true, () => { signal?.throwIfAborted(); return false; });
    return behindOrEqual ? remote : local;
  }
  signal?.throwIfAborted();
  return git(source, ["symbolic-ref", "--quiet", "--short", "HEAD"], signal).catch(() => "HEAD");
}

/** Checks that `inputs` can create a new branch; returns the base commit. An empty name checks only the base. */
export async function validateNewBranch(source: string, inputs: NamedWorktreeInputs, signal?: AbortSignal) {
  if (inputs.name !== "") {
    await validateBranchName(source, inputs.name, signal);
    if (await branchExists(source, inputs.name, signal)) throw new Error(`Branch "${inputs.name}" already exists. Choose a new branch name.`);
  }
  const base = inputs.baseBranch || await defaultBase(source, { signal });
  return git(source, ["rev-parse", "--verify", "--end-of-options", `${base}^{commit}`], signal);
}

/** `name`, or `name-2`, `name-3`, ... for the first that is not a branch yet. */
export async function freeBranchName(source: string, name: string, signal?: AbortSignal) {
  await validateBranchName(source, name, signal);
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? name : `${name}-${n}`;
    if (!await branchExists(source, candidate, signal)) return candidate;
  }
}

const PATH_KEY = /^[A-Za-z0-9._-]+$/;
function checkPathKey(pathKey: string) {
  if (!PATH_KEY.test(pathKey) || pathKey === "." || pathKey === "..") throw new Error(`Invalid path key: ${JSON.stringify(pathKey)}.`);
}

/** Where worktrees were kept before the root became configurable: one directory per attempt. */
export function legacyAttemptRoot(dataDir: string, pathKey: string) {
  checkPathKey(pathKey);
  return path.join(dataDir, "worktrees", pathKey);
}
const recordFile = (dataDir: string, pathKey: string) => {
  checkPathKey(pathKey);
  return path.join(dataDir, "attempts", `${pathKey}.json`);
};

/** `p` with symlinks resolved as far as it exists, so containment checks see real locations. */
async function canonical(p: string): Promise<string> {
  const rest: string[] = [];
  let current = path.resolve(p);
  while (!existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(p);
    rest.unshift(path.basename(current));
    current = parent;
  }
  return path.join(await fs.realpath(current), ...rest);
}
const within = (parent: string, child: string) => child !== parent && child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);

/**
 * Resolves the "Worktree root" setting on this host: an absolute path or `~/...`;
 * empty means the default. Refuses a root that is, contains, or sits inside the
 * user's home, the source checkout, or this plugin's data directory.
 */
export async function resolveRoot(setting: string, { dataDir, source, home = os.homedir() }: { dataDir: string; source: string; home?: string }) {
  const text = setting.trim() || DEFAULT_ROOT;
  if (/[\0\r\n]/.test(text)) throw new Error("Worktree root must be a single-line path.");
  const expanded = text === "~" ? home : text.startsWith("~/") ? path.join(home, text.slice(2)) : text;
  if (!path.isAbsolute(expanded)) throw new Error(`Worktree root must be an absolute path or start with "~/": ${JSON.stringify(text)}.`);
  const root = await canonical(expanded);
  if (root === path.parse(root).root) throw new Error("Worktree root cannot be the filesystem root.");
  const [canonicalHome, canonicalData, canonicalSource] = await Promise.all([canonical(home), canonical(dataDir), canonical(source)]);
  const overlaps = (other: string) => root === other || within(root, other) || within(other, root);
  const conflict = [canonicalData, canonicalSource].find(overlaps) ?? (root === canonicalHome || within(root, canonicalHome) ? canonicalHome : undefined);
  if (conflict) throw new Error(`Worktree root ${root} overlaps ${conflict}. Choose a dedicated directory such as ${DEFAULT_ROOT}.`);
  return root;
}

/** The checkout directory for a branch: its name with path separators flattened. */
export function worktreeDirName(name: string) {
  const dir = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").replace(/^[.-]+/, "").slice(0, 100).replace(/[. ]+$/, "");
  return dir || "worktree";
}
const repoDirName = (source: string) => path.basename(source).replace(/\.git$/, "");

/** `<root>/<repository>/<branch>`, with `-2`, `-3`, ... when that directory is taken. */
function freeTarget(root: string, source: string, name: string) {
  const base = path.join(root, repoDirName(source), worktreeDirName(name));
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    if (!existsSync(candidate)) return candidate;
  }
}

/** What one launch decided, kept on the host so replay, restore and removal never depend on the current setting. */
export interface Attempt { source: string; root: string; target: string; name: string; baseBranch: string; legacy: boolean }

async function readJson(file: string) {
  if (!existsSync(file)) return null;
  return JSON.parse(await fs.readFile(file, "utf8")) as Omit<Attempt, "legacy" | "root"> & { root?: string };
}

export async function readAttempt(dataDir: string, pathKey: string): Promise<Attempt | null> {
  const current = await readJson(recordFile(dataDir, pathKey));
  if (current?.root) return { ...current, root: current.root, legacy: false };
  const old = await readJson(path.join(legacyAttemptRoot(dataDir, pathKey), "attempt.json"));
  return old ? { ...old, root: path.join(dataDir, "worktrees"), legacy: true } : null;
}

async function writeAttempt(dataDir: string, pathKey: string, attempt: Attempt) {
  const file = recordFile(dataDir, pathKey);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const { legacy: _legacy, ...record } = attempt;
  await fs.writeFile(file, JSON.stringify(record));
}

/**
 * Chooses and records this launch's location. A replay returns the recorded
 * choice, so a changed setting never moves a launch that already started.
 */
export async function planWorktree(dataDir: string, rootSetting: string, pathKey: string, source: string,
  inputs: NamedWorktreeInputs, { restore = false, autoName = false, signal }: CreateOptions = {}): Promise<Attempt> {
  const existing = await readAttempt(dataDir, pathKey);
  if (existing) return existing;
  const root = await resolveRoot(rootSetting, { dataDir, source });
  const name = autoName && !restore ? await freeBranchName(source, inputs.name, signal) : inputs.name;
  const attempt = { source, root, target: freeTarget(root, source, name), name, baseBranch: inputs.baseBranch, legacy: false };
  await writeAttempt(dataDir, pathKey, attempt);
  return attempt;
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

export async function createWorktree(dataDir: string, rootSetting: string, pathKey: string, source: string,
  inputs: NamedWorktreeInputs, options: CreateOptions = {}) {
  const { restore = false, autoName = false, signal } = options;
  const attempt = await planWorktree(dataDir, rootSetting, pathKey, source, inputs, options), { target } = attempt;
  let name = autoName && !restore ? attempt.name : inputs.name;
  // A replay of this attempt resumes its own registered worktree, under the name it chose.
  const resumed = await registeredBranch(source, target, signal) === name;
  const baseBranch = attempt.baseBranch || inputs.baseBranch || await defaultBase(source, { fetch: !resumed && !restore, signal });
  if (!resumed) {
    if (restore && !await branchExists(source, name, signal)) throw new Error(`Cannot restore: branch "${name}" no longer exists.`);
    if (autoName && !restore && await branchExists(source, name, signal)) name = await freeBranchName(source, inputs.name, signal);
    const base = restore ? null : await validateNewBranch(source, { name, baseBranch }, signal);
    await fs.mkdir(path.dirname(target), { recursive: true });
    // Written before git runs so cleanup can find a partially created worktree.
    if (!attempt.legacy) await writeAttempt(dataDir, pathKey, { ...attempt, name, baseBranch });
    await git(source, base === null ? ["worktree", "add", "--", target, name]
      : ["worktree", "add", "-b", name, "--", target, base], signal);
  }
  await copyIncluded(source, target, signal);
  return { path: target, name, baseBranch };
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

/** Deletes what a failed or finished checkout left under its recorded root, and nothing else. */
async function removeLeftovers({ root, target }: Attempt) {
  const parent = path.dirname(target);
  if (path.dirname(parent) !== root || !within(await canonical(root), await canonical(target))) {
    throw new Error(`Refusing to delete ${target}: it is not directly inside a repository folder of ${root}.`);
  }
  if (existsSync(target)) {
    const entries = await fs.readdir(target);
    if (entries.length > 0 && !entries.includes(".git")) throw new Error(`Refusing to delete ${target}: it is not a Git worktree.`);
    await fs.rm(target, { recursive: true, force: true });
  }
  await fs.rmdir(parent).catch(() => {});
}

export async function removeWorktree(dataDir: string, pathKey: string,
  killProcesses: (target: string) => Promise<unknown>, signal?: AbortSignal) {
  const attempt = await readAttempt(dataDir, pathKey);
  if (attempt) {
    await killProcesses(attempt.target);
    if (await registeredBranch(attempt.source, attempt.target, signal) !== null) {
      await git(attempt.source, ["worktree", "remove", "--force", "--", attempt.target], signal);
    }
  }
  signal?.throwIfAborted();
  if (attempt && !attempt.legacy) {
    await removeLeftovers(attempt);
    await fs.rm(recordFile(dataDir, pathKey), { force: true });
  } else {
    // Legacy layout: the attempt directory is inside this plugin's own data directory.
    await fs.rm(legacyAttemptRoot(dataDir, pathKey), { recursive: true, force: true });
  }
}
