import assert from "node:assert/strict";
import { test } from "node:test";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { autoBranchName, branchNameError, inputsSchema } from "./named-worktree.ts";
import { attemptRoot, createWorktree, defaultBase, findWt, git, removeWorktree, runWtSetup, targetPath, validateBranchName, validateNewBranch } from "./worktree.ts";

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "named-worktree-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, "repo"), data = path.join(root, "data");
  await fs.mkdir(source);
  await git(source, ["init", "-b", "main"]);
  await git(source, ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-m", "initial"]);
  return { root, source, data };
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

test("worktrees live under the attempt directory, named after the repository", () => {
  assert.equal(targetPath("/data", "attempt-1", "/repo/project.git"), "/data/worktrees/attempt-1/project");
});

test("create, replay, preserve commits, remove and restore", async (t) => {
  const { source, data } = await fixture(t);
  await git(source, ["branch", "base"]);
  await fs.writeFile(path.join(source, ".worktreeinclude"), "local.txt\nlink.txt\n");
  await fs.writeFile(path.join(source, "local.txt"), "local-only");
  await fs.symlink("local.txt", path.join(source, "link.txt"));
  const inputs = { name: "feature/test", baseBranch: "base" };
  const target = (await createWorktree(data, "first", source, inputs, { restore: false })).path;
  assert.equal(await git(target, ["branch", "--show-current"]), inputs.name);
  assert.equal(await git(target, ["rev-parse", "HEAD"]), await git(source, ["rev-parse", "base"]));
  assert.equal(await fs.readFile(path.join(target, "local.txt"), "utf8"), "local-only");
  await assert.rejects(fs.lstat(path.join(target, "link.txt")), { code: "ENOENT" });
  await fs.writeFile(path.join(target, "local.txt"), "edited");
  assert.equal((await createWorktree(data, "first", source, inputs, { restore: false })).path, target);
  assert.equal(await fs.readFile(path.join(target, "local.txt"), "utf8"), "edited");
  await assert.rejects(createWorktree(data, "second", source, inputs), /already exists/);
  await git(target, ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-m", "keep me"]);
  const commit = await git(target, ["rev-parse", "HEAD"]);
  const killed: string[] = [];
  await removeWorktree(data, "first", async (directory) => { killed.push(directory); });
  assert.deepEqual(killed, [target]);
  await assert.rejects(fs.access(target), { code: "ENOENT" });
  assert.equal(await git(source, ["rev-parse", inputs.name]), commit);
  await removeWorktree(data, "first", async () => { assert.fail("already removed"); });
  const restored = (await createWorktree(data, "restored", source, inputs, { restore: true })).path;
  assert.equal(await git(restored, ["rev-parse", "HEAD"]), commit);
  await git(restored, ["checkout", "--detach"]);
  await removeWorktree(data, "restored", async () => {});
  assert.equal((await git(source, ["worktree", "list", "--porcelain"])).includes(restored), false);
  await git(source, ["branch", "-D", inputs.name]);
  await assert.rejects(createWorktree(data, "missing", source, inputs, { restore: true }), /no longer exists/);
});

test("failed provisioning can be cleaned without a returned path", async (t) => {
  const { source, data } = await fixture(t);
  const inputs = { name: "test/partial", baseBranch: "main" };
  await fs.writeFile(path.join(source, ".worktreeinclude"), "missing-dir/file\n");
  const target = (await createWorktree(data, "partial", source, inputs, { restore: false })).path;
  // Simulate interruption after git creates the checkout, before core attaches it.
  await removeWorktree(data, "partial", async () => {});
  await assert.rejects(fs.access(target), { code: "ENOENT" });
  const controller = new AbortController();
  controller.abort(new Error("cancelled"));
  await assert.rejects(createWorktree(data, "cancelled", source, { ...inputs, name: "other" }, { signal: controller.signal }), /cancelled/);
});

test("cleanup removes an attempt directory without a record", async (t) => {
  const { data } = await fixture(t);
  const root = attemptRoot(data, "interrupted");
  await fs.mkdir(root, { recursive: true });
  await removeWorktree(data, "interrupted", async () => { assert.fail("no checkout exists"); });
  await assert.rejects(fs.access(root), { code: "ENOENT" });
});

test("auto names take a free suffix and keep it on replay", async (t) => {
  const { source, data } = await fixture(t);
  await git(source, ["branch", "topic"]);
  const inputs = { name: "topic", baseBranch: "main" };
  await assert.rejects(createWorktree(data, "explicit", source, inputs), /already exists/);
  const first = await createWorktree(data, "auto", source, inputs, { autoName: true });
  assert.equal(first.name, "topic-2");
  assert.equal(await git(first.path, ["branch", "--show-current"]), "topic-2");
  assert.deepEqual(await createWorktree(data, "auto", source, inputs, { autoName: true }), first);
  assert.equal((await createWorktree(data, "again", source, inputs, { autoName: true })).name, "topic-3");
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
  const { root, source, data } = await fixture(t);
  assert.equal(await defaultBase(source), "main");
  const remote = path.join(root, "remote.git"), clone = path.join(root, "clone");
  await git(root, ["clone", "--quiet", "--bare", source, remote]);
  await git(root, ["clone", "--quiet", remote, clone]);
  await git(source, ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-m", "newer"]);
  await git(source, ["push", "--quiet", remote, "main"]);
  assert.equal(await defaultBase(clone), "origin/main");
  const created = await createWorktree(data, "default", clone, { name: "topic", baseBranch: "" });
  assert.equal(created.baseBranch, "origin/main");
  assert.equal(await git(created.path, ["rev-parse", "HEAD"]), await git(source, ["rev-parse", "main"]));
  await git(clone, ["merge", "--quiet", "--ff-only", "origin/main"]);
  await git(clone, ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-m", "local only"]);
  assert.equal(await defaultBase(clone, { fetch: true }), "main");
});
