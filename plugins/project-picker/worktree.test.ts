import assert from "node:assert/strict";
import { test } from "node:test";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { branchNameError, inputsSchema } from "./named-worktree.ts";
import { attemptRoot, createWorktree, git, removeWorktree, targetPath, validateBranchName, validateNewBranch } from "./worktree.ts";

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "named-worktree-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, "repo"), data = path.join(root, "data");
  await fs.mkdir(source);
  await git(source, ["init", "-b", "main"]);
  await git(source, ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-m", "initial"]);
  return { root, source, data };
}

test("inputs require an explicit name and base without imposing a prefix", () => {
  for (const value of [null, {}, { name: "", baseBranch: "main" }, { name: "foo" }, { name: "foo", baseBranch: "main", extra: 1 }]) {
    assert.equal(inputsSchema.safeParse(value).success, false);
  }
  assert.deepEqual(inputsSchema.parse({ name: "feature/foo", baseBranch: "origin/main" }), { name: "feature/foo", baseBranch: "origin/main" });
  for (const name of ["", " foo", "foo ", "-foo", "@{-1}", "foo\0bar"]) assert.ok(branchNameError(name));
  assert.equal(branchNameError("feature/foo"), null);
});

test("Git validates literal branch names and rejects existing branches", async (t) => {
  const { source } = await fixture(t);
  for (const name of ["bad name", "foo..bar", "foo.lock", "foo/", "HEAD", "@{-1}", "-f"]) {
    await assert.rejects(validateBranchName(source, name));
  }
  await validateBranchName(source, "someone/feature");
  await assert.rejects(validateNewBranch(source, { name: "main", baseBranch: "main" }), /already exists/);
  await assert.rejects(validateNewBranch(source, { name: "new", baseBranch: "missing" }));
});

test("managed paths stay within the attempt directory", () => {
  for (const key of ["../escape", ".", "..", "/tmp", "a/b", "a\\b"]) assert.throws(() => attemptRoot("/data", key));
  assert.equal(targetPath("/data", "attempt-1", "/repo/project.git"), "/data/worktrees/attempt-1/project");
  assert.ok(targetPath("/data", "attempt-1", "/repo/project with spaces").startsWith("/data/worktrees/attempt-1/"));
});

test("create, replay, preserve commits, remove and restore", async (t) => {
  const { source, data } = await fixture(t);
  await git(source, ["branch", "base"]);
  await fs.writeFile(path.join(source, ".worktreeinclude"), "local.txt\nlink.txt\n");
  await fs.writeFile(path.join(source, "local.txt"), "local-only");
  await fs.symlink("local.txt", path.join(source, "link.txt"));
  const inputs = { name: "feature/test", baseBranch: "base" };
  const target = await createWorktree(data, "first", source, inputs, false);
  assert.equal(await git(target, ["branch", "--show-current"]), inputs.name);
  assert.equal(await git(target, ["rev-parse", "HEAD"]), await git(source, ["rev-parse", "base"]));
  assert.equal(await fs.readFile(path.join(target, "local.txt"), "utf8"), "local-only");
  await assert.rejects(fs.lstat(path.join(target, "link.txt")), { code: "ENOENT" });
  await fs.writeFile(path.join(target, "local.txt"), "edited");
  assert.equal(await createWorktree(data, "first", source, inputs, false), target);
  assert.equal(await fs.readFile(path.join(target, "local.txt"), "utf8"), "edited");
  await assert.rejects(createWorktree(data, "second", source, inputs, false), /already exists/);
  await git(target, ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-m", "keep me"]);
  const commit = await git(target, ["rev-parse", "HEAD"]);
  const killed: string[] = [];
  await removeWorktree(data, "first", async (directory) => { killed.push(directory); });
  assert.deepEqual(killed, [target]);
  await assert.rejects(fs.access(target), { code: "ENOENT" });
  assert.equal(await git(source, ["rev-parse", inputs.name]), commit);
  await removeWorktree(data, "first", async () => { assert.fail("already removed"); });
  const restored = await createWorktree(data, "restored", source, inputs, true);
  assert.equal(await git(restored, ["rev-parse", "HEAD"]), commit);
  await git(restored, ["checkout", "--detach"]);
  await removeWorktree(data, "restored", async () => {});
  assert.equal((await git(source, ["worktree", "list", "--porcelain"])).includes(restored), false);
  await git(source, ["branch", "-D", inputs.name]);
  await assert.rejects(createWorktree(data, "missing", source, inputs, true), /no longer exists/);
});

test("failed provisioning can be cleaned without a returned path", async (t) => {
  const { source, data } = await fixture(t);
  const inputs = { name: "test/partial", baseBranch: "main" };
  await fs.writeFile(path.join(source, ".worktreeinclude"), "missing-dir/file\n");
  const target = await createWorktree(data, "partial", source, inputs, false);
  // Simulate interruption after git creates the checkout, before core attaches it.
  await removeWorktree(data, "partial", async () => {});
  await assert.rejects(fs.access(target), { code: "ENOENT" });
  const controller = new AbortController();
  controller.abort(new Error("cancelled"));
  await assert.rejects(createWorktree(data, "cancelled", source, { ...inputs, name: "other" }, false, controller.signal), /cancelled/);
});

test("cleanup removes an interrupted attempt record before Git ran", async (t) => {
  const { data } = await fixture(t);
  const root = attemptRoot(data, "interrupted");
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, "attempt.json.tmp"), '{"source":');
  await removeWorktree(data, "interrupted", async () => { assert.fail("no checkout exists"); });
  await assert.rejects(fs.access(root), { code: "ENOENT" });
});
