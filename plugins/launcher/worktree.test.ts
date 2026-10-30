import assert from "node:assert/strict";
import { test } from "node:test";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { autoBranchName, branchNameError, inputsSchema } from "./named-worktree.ts";
import { createWorktree, defaultBase, findWt, git, legacyAttemptRoot, planWorktree, removeWorktree, resolveRoot, runWtSetup, validateBranchName, validateNewBranch, worktreeDirName } from "./worktree.ts";

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "named-worktree-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, "repo"), data = path.join(root, "data");
  await fs.mkdir(source);
  await git(source, ["init", "-b", "main"]);
  await git(source, ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-m", "initial"]);
  return { root, source, data, wtRoot: path.join(root, "worktrees") };
}

test("inputs accept empty names and bases for automatic choices and impose no prefix", () => {
  for (const value of [null, {}, { name: "-foo", baseBranch: "main" }, { name: "foo" }, { name: "foo", baseBranch: "main", extra: 1 }]) {
    assert.equal(inputsSchema.safeParse(value).success, false);
  }
  assert.deepEqual(inputsSchema.parse({ name: "feature/foo", baseBranch: "origin/main" }), { name: "feature/foo", baseBranch: "origin/main" });
  assert.deepEqual(inputsSchema.parse({ name: "", baseBranch: "" }), { name: "", baseBranch: "" });
  for (const name of ["", "-foo", "@{-1}"]) assert.ok(branchNameError(name));
  assert.equal(branchNameError("feature/foo"), null);
});

test("auto names drop the thread ID from bb's suggestion", () => {
  const id = "thr_ab12cd34ef", now = new Date("2026-10-29T14:05:09Z");
  assert.equal(autoBranchName(`fix-login-flow-${id}`, id, "", now), "fix-login-flow");
  assert.equal(autoBranchName(`arthur/fix-login-flow-${id}`, id, "arthur/", now), "arthur/fix-login-flow");
  assert.equal(autoBranchName(`sawyer/wt-fix-${id}`, id, "sawyer/wt-", now), "sawyer/wt-fix");
  assert.equal(autoBranchName(`sawyer/wt-${id}`, id, "sawyer/wt-", now), "sawyer/wt-thread-20261029-140509");
  assert.equal(autoBranchName(id, id, "", now), "thread-20261029-140509");
  assert.equal(autoBranchName("custom", id, "", now), "custom");
});

test("Git validates literal branch names and rejects existing branches", async (t) => {
  const { source } = await fixture(t);
  for (const name of ["bad name", " foo", "foo..bar", "foo.lock", "foo/", "HEAD", "@{-1}", "-f"]) {
    await assert.rejects(validateBranchName(source, name));
  }
  await validateBranchName(source, "someone/feature");
  await assert.rejects(validateNewBranch(source, { name: "main", baseBranch: "main" }), /already exists/);
  await assert.rejects(validateNewBranch(source, { name: "new", baseBranch: "missing" }));
});

test("worktrees live at <root>/<repository>/<branch>", async (t) => {
  const { source, data, wtRoot } = await fixture(t);
  const inputs = { name: "feature/test", baseBranch: "main" };
  const plan = await planWorktree(data, wtRoot, "attempt-1", source, inputs);
  assert.equal(plan.target, path.join(await fs.realpath(path.dirname(wtRoot)), "worktrees", "repo", "feature-test"));
  assert.equal(worktreeDirName("a/b//c"), "a-b-c");
  assert.equal(worktreeDirName("..."), "worktree");
});

test("create, replay, preserve commits, remove and restore", async (t) => {
  const { source, data, wtRoot } = await fixture(t);
  await git(source, ["branch", "base"]);
  await fs.writeFile(path.join(source, ".worktreeinclude"), "local.txt\nlink.txt\n");
  await fs.writeFile(path.join(source, "local.txt"), "local-only");
  await fs.symlink("local.txt", path.join(source, "link.txt"));
  const inputs = { name: "feature/test", baseBranch: "base" };
  const target = (await createWorktree(data, wtRoot, "first", source, inputs, { restore: false })).path;
  assert.equal(await git(target, ["branch", "--show-current"]), inputs.name);
  assert.equal(await git(target, ["rev-parse", "HEAD"]), await git(source, ["rev-parse", "base"]));
  assert.equal(await fs.readFile(path.join(target, "local.txt"), "utf8"), "local-only");
  await assert.rejects(fs.lstat(path.join(target, "link.txt")), { code: "ENOENT" });
  await fs.writeFile(path.join(target, "local.txt"), "edited");
  assert.equal((await createWorktree(data, wtRoot, "first", source, inputs, { restore: false })).path, target);
  assert.equal(await fs.readFile(path.join(target, "local.txt"), "utf8"), "edited");
  await assert.rejects(createWorktree(data, wtRoot, "second", source, inputs), /already exists/);
  await git(target, ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-m", "keep me"]);
  const commit = await git(target, ["rev-parse", "HEAD"]);
  const killed: string[] = [];
  await removeWorktree(data, "first", async (directory) => { killed.push(directory); });
  assert.deepEqual(killed, [target]);
  await assert.rejects(fs.access(target), { code: "ENOENT" });
  assert.equal(await git(source, ["rev-parse", inputs.name]), commit);
  await removeWorktree(data, "first", async () => { assert.fail("already removed"); });
  const restored = (await createWorktree(data, wtRoot, "restored", source, inputs, { restore: true })).path;
  assert.equal(await git(restored, ["rev-parse", "HEAD"]), commit);
  await git(restored, ["checkout", "--detach"]);
  await removeWorktree(data, "restored", async () => {});
  assert.equal((await git(source, ["worktree", "list", "--porcelain"])).includes(restored), false);
  await git(source, ["branch", "-D", inputs.name]);
  await assert.rejects(createWorktree(data, wtRoot, "missing", source, inputs, { restore: true }), /no longer exists/);
});

test("failed provisioning can be cleaned without a returned path", async (t) => {
  const { source, data, wtRoot } = await fixture(t);
  const inputs = { name: "test/partial", baseBranch: "main" };
  await fs.writeFile(path.join(source, ".worktreeinclude"), "missing-dir/file\n");
  const target = (await createWorktree(data, wtRoot, "partial", source, inputs, { restore: false })).path;
  // Simulate interruption after git creates the checkout, before core attaches it.
  await removeWorktree(data, "partial", async () => {});
  await assert.rejects(fs.access(target), { code: "ENOENT" });
  const controller = new AbortController();
  controller.abort(new Error("cancelled"));
  await assert.rejects(createWorktree(data, wtRoot, "cancelled", source, { ...inputs, name: "other" }, { signal: controller.signal }), /cancelled/);
});

test("cleanup removes a legacy attempt directory without a record", async (t) => {
  const { data } = await fixture(t);
  const root = legacyAttemptRoot(data, "interrupted");
  await fs.mkdir(root, { recursive: true });
  await removeWorktree(data, "interrupted", async () => { assert.fail("no checkout exists"); });
  await assert.rejects(fs.access(root), { code: "ENOENT" });
});

test("auto names take a free suffix and keep it on replay", async (t) => {
  const { source, data, wtRoot } = await fixture(t);
  await git(source, ["branch", "topic"]);
  const inputs = { name: "topic", baseBranch: "main" };
  await assert.rejects(createWorktree(data, wtRoot, "explicit", source, inputs), /already exists/);
  const first = await createWorktree(data, wtRoot, "auto", source, inputs, { autoName: true });
  assert.equal(first.name, "topic-2");
  assert.equal(await git(first.path, ["branch", "--show-current"]), "topic-2");
  assert.deepEqual(await createWorktree(data, wtRoot, "auto", source, inputs, { autoName: true }), first);
  assert.equal((await createWorktree(data, wtRoot, "again", source, inputs, { autoName: true })).name, "topic-3");
});

test("wt setup runs in the worktree and reports failure without throwing", async (t) => {
  const { root } = await fixture(t);
  const bin = path.join(root, "bin"), wt = path.join(bin, "wt");
  await fs.mkdir(bin);
  await fs.writeFile(wt, '#!/bin/sh\necho "$1 $2 $(pwd)"\n[ "$WT_FAIL" = 1 ] && exit 3\nexit 0\n', { mode: 0o755 });
  assert.equal(findWt({ PATH: bin }, root), wt);
  assert.equal(findWt({ PATH: "" }, root), null);
  assert.deepEqual(await runWtSetup(root, undefined, null), { status: "missing" });
  const done = await runWtSetup(root, undefined, wt);
  assert.equal(done.status, "done");
  assert.match((done as { output: string }).output, new RegExp(`^setup ${root}`));
  process.env.WT_FAIL = "1";
  t.after(() => { delete process.env.WT_FAIL; });
  assert.equal((await runWtSetup(root, undefined, wt)).status, "failed");
});

test("an empty base uses origin's default branch after fetching, local when ahead, else the checkout's branch", async (t) => {
  const { root, source, data, wtRoot } = await fixture(t);
  assert.equal(await defaultBase(source), "main");
  const remote = path.join(root, "remote.git"), clone = path.join(root, "clone");
  await git(root, ["clone", "--quiet", "--bare", source, remote]);
  await git(root, ["clone", "--quiet", remote, clone]);
  await git(source, ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-m", "newer"]);
  await git(source, ["push", "--quiet", remote, "main"]);
  assert.equal(await defaultBase(clone), "origin/main");
  const created = await createWorktree(data, wtRoot, "default", clone, { name: "topic", baseBranch: "" });
  assert.equal(created.baseBranch, "origin/main");
  assert.equal(await git(created.path, ["rev-parse", "HEAD"]), await git(source, ["rev-parse", "main"]));
  await git(clone, ["merge", "--quiet", "--ff-only", "origin/main"]);
  await git(clone, ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-m", "local only"]);
  assert.equal(await defaultBase(clone, { fetch: true }), "main");
});

test("a changed root does not move or orphan a launch", async (t) => {
  const { root, source, data, wtRoot } = await fixture(t);
  const other = path.join(root, "other");
  const inputs = { name: "topic", baseBranch: "main" };
  const created = await createWorktree(data, wtRoot, "k-1", source, inputs);
  // Replay and removal use the recorded root, not the setting.
  assert.equal((await createWorktree(data, other, "k-1", source, inputs)).path, created.path);
  await removeWorktree(data, "k-1", async () => {}, undefined);
  await assert.rejects(fs.access(created.path), { code: "ENOENT" });
  assert.equal((await git(source, ["worktree", "list", "--porcelain"])).includes("topic"), false);
  await assert.rejects(fs.access(path.dirname(created.path)), { code: "ENOENT" });
  assert.equal((await createWorktree(data, other, "k-2", source, { name: "topic2", baseBranch: "main" })).path.startsWith(await fs.realpath(other)), true);
});

test("restore reuses the freed directory and a taken directory gets a suffix", async (t) => {
  const { source, data, wtRoot } = await fixture(t);
  const a = await createWorktree(data, wtRoot, "a", source, { name: "x/y", baseBranch: "main" });
  await git(source, ["branch", "x-y"]);
  const b = await createWorktree(data, wtRoot, "b", source, { name: "x-y", baseBranch: "main" }, { restore: true });
  assert.equal(b.path, `${a.path}-2`);
  await removeWorktree(data, "a", async () => {});
  const c = await createWorktree(data, wtRoot, "c", source, { name: "x/y", baseBranch: "main" }, { restore: true });
  assert.equal(c.path, a.path);
});

test("removal refuses to delete anything that is not a worktree inside the recorded root", async (t) => {
  const { root, source, data, wtRoot } = await fixture(t);
  await assert.rejects(removeWorktree(data, "../escape", async () => {}), /Invalid path key/);
  const { target } = await planWorktree(data, wtRoot, "guard", source, { name: "topic", baseBranch: "main" });
  await fs.mkdir(target, { recursive: true });
  await fs.writeFile(path.join(target, "precious.txt"), "keep");
  await assert.rejects(removeWorktree(data, "guard", async () => {}), /not a Git worktree/);
  assert.equal(await fs.readFile(path.join(target, "precious.txt"), "utf8"), "keep");
  // A tampered record pointing outside its root is refused too.
  const file = path.join(data, "attempts", "guard.json");
  const record = JSON.parse(await fs.readFile(file, "utf8"));
  await fs.writeFile(file, JSON.stringify({ ...record, target: path.join(root, "elsewhere", "x"), root: wtRoot }));
  await assert.rejects(removeWorktree(data, "guard", async () => {}), /Refusing to delete/);
});

test("a legacy attempt created before the setting still removes its worktree", async (t) => {
  const { source, data } = await fixture(t);
  const legacy = legacyAttemptRoot(data, "old"), target = path.join(legacy, "repo");
  await fs.mkdir(legacy, { recursive: true });
  await git(source, ["worktree", "add", "-b", "old-branch", "--", target, "main"]);
  await fs.writeFile(path.join(legacy, "attempt.json"), JSON.stringify({ source, target, name: "old-branch", baseBranch: "main" }));
  await removeWorktree(data, "old", async () => {});
  await assert.rejects(fs.access(legacy), { code: "ENOENT" });
  assert.equal((await git(source, ["worktree", "list", "--porcelain"])).includes("old-branch"), false);
});

test("the root must be a dedicated directory", async (t) => {
  const { root, source, data } = await fixture(t);
  const home = path.join(root, "home");
  await fs.mkdir(home);
  const check = (setting: string) => resolveRoot(setting, { dataDir: data, source, home });
  assert.equal(await check("~/.bb/worktrees"), path.join(await fs.realpath(home), ".bb", "worktrees"));
  assert.equal(await check(""), path.join(await fs.realpath(home), ".bb", "worktrees"));
  for (const bad of ["/", "~", home, path.dirname(source), source, path.join(source, "wt"), data, path.join(data, "wt"), "relative/dir", "~user/x"]) {
    await assert.rejects(check(bad), Error, bad);
  }
});
