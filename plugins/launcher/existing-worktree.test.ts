import assert from "node:assert/strict";
import { test } from "node:test";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { existingInputsSchema, parseRef, reviewPrompt, type PrInfo } from "./existing-branch.ts";
import { checkoutBlocker, createExisting, listRefs, resolveRef, type Gh } from "./existing-worktree.ts";
import { git } from "./worktree.ts";

const commit = (cwd: string, message: string) =>
  git(cwd, ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-m", message]);

/** A clone of a bare origin that has `main` and `feature/x` (pushed, not checked out locally). */
async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "existing-branch-test-")));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const origin = path.join(root, "origin.git"), source = path.join(root, "repo"), data = path.join(root, "data");
  await git(root, ["init", "--bare", "-b", "main", origin]);
  await git(root, ["clone", "--quiet", origin, source]);
  await git(source, ["checkout", "-b", "main"]).catch(() => {});
  await commit(source, "initial");
  await git(source, ["push", "--quiet", "-u", "origin", "main"]);
  await git(source, ["remote", "set-head", "origin", "main"]);
  await git(source, ["checkout", "-b", "feature/x"]);
  await commit(source, "feature");
  await git(source, ["push", "--quiet", "origin", "feature/x"]);
  await git(source, ["checkout", "main"]);
  await git(source, ["branch", "-D", "feature/x"]);
  return { root, source, data, wtRoot: path.join(root, "worktrees") };
}

const pr = (over: Partial<PrInfo> = {}): PrInfo => ({ number: 7, title: "Add x", state: "OPEN", baseRefName: "main",
  headRefName: "feature/x", isCrossRepository: false, url: "https://github.com/o/r/pull/7", ...over });
const noGh: Gh = async () => { throw new Error("gh unavailable"); };
const ghWith = (info: PrInfo): Gh => async (_cwd, args) => args[1] === "list" ? JSON.stringify([info]) : JSON.stringify(info);

test("refs parse as PR numbers, PR URLs, or branch names", () => {
  assert.deepEqual(parseRef("123"), { kind: "pr", number: 123, url: null });
  assert.deepEqual(parseRef(" #45 "), { kind: "pr", number: 45, url: null });
  assert.deepEqual(parseRef("https://github.com/o/r/pull/9/files"), { kind: "pr", number: 9, url: "https://github.com/o/r/pull/9/files" });
  assert.deepEqual(parseRef("origin/feature/x"), { kind: "branch", name: "feature/x" });
  assert.deepEqual(parseRef("contrib:patch-1"), { kind: "branch", name: "contrib:patch-1" });
  for (const bad of ["", "  ", "-x", "@{-1}"]) assert.equal(parseRef(bad).kind, "invalid");
  assert.equal(existingInputsSchema.safeParse({ ref: "", review: false }).success, false);
  assert.equal(existingInputsSchema.safeParse({ ref: "1", review: true, extra: 1 }).success, false);
});

test("the review prompt names the PR or branch and the base", () => {
  assert.match(reviewPrompt({ branch: "feature/x", base: "origin/main", pr: pr() }), /PR #7 "Add x".*origin\/main/s);
  assert.match(reviewPrompt({ branch: "feature/x", base: "origin/main", pr: null }), /branch feature\/x/);
});

test("a remote branch without a PR resolves against the default branch", async (t) => {
  const { source } = await fixture(t);
  const resolved = await resolveRef(source, "feature/x", { gh: noGh });
  assert.deepEqual(resolved, { kind: "branch", branch: "feature/x", pr: null, base: "origin/main", busyAt: null });
  await assert.rejects(resolveRef(source, "nope", { gh: noGh }), /No branch named "nope"/);
});

test("a branch with a PR resolves to that PR and its base", async (t) => {
  const { source } = await fixture(t);
  const resolved = await resolveRef(source, "feature/x", { gh: ghWith(pr()) });
  assert.equal(resolved.kind, "pr");
  assert.equal(resolved.pr?.number, 7);
  assert.equal(resolved.base, "origin/main");
  const byNumber = await resolveRef(source, "#7", { gh: ghWith(pr()) });
  assert.equal(byNumber.branch, "feature/x");
  await assert.rejects(resolveRef(source, "#7", { gh: noGh }), /Could not read PR #7: gh unavailable/);
});

test("a branch checked out elsewhere is reported and refused", async (t) => {
  const { source, data, wtRoot } = await fixture(t);
  await git(source, ["checkout", "-b", "busy"]);
  const resolved = await resolveRef(source, "busy", { gh: noGh });
  assert.equal(resolved.busyAt && await fs.realpath(resolved.busyAt), await fs.realpath(source));
  assert.match(checkoutBlocker(resolved) ?? "", /already checked out at/);
  await assert.rejects(createExisting(data, wtRoot, "k1", source, resolved, { gh: noGh }), /already checked out/);
});

test("a remote-only branch is checked out under the worktree root with its upstream", async (t) => {
  const { source, data, wtRoot } = await fixture(t);
  const resolved = await resolveRef(source, "feature/x", { gh: noGh });
  const created = await createExisting(data, wtRoot, "k2", source, resolved, { gh: noGh });
  assert.equal(created.path, path.join(wtRoot, "repo", "feature-x"));
  assert.equal(created.baseBranch, "origin/main");
  assert.equal(await git(created.path, ["symbolic-ref", "--short", "HEAD"]), "feature/x");
  assert.equal(await git(created.path, ["rev-parse", "--abbrev-ref", "feature/x@{upstream}"]), "origin/feature/x");
  // Replaying the same attempt resumes the registered worktree instead of failing on its own checkout.
  const again = await resolveRef(source, "feature/x", { gh: noGh });
  assert.equal(await createExisting(data, wtRoot, "k2", source, again, { gh: noGh }).then((c) => c.path), created.path);
});

test("an existing local branch is reused", async (t) => {
  const { source, data, wtRoot } = await fixture(t);
  await git(source, ["branch", "feature/x", "origin/feature/x"]);
  const created = await createExisting(data, wtRoot, "k3", source, await resolveRef(source, "feature/x", { gh: noGh }), { gh: noGh });
  assert.equal(await git(created.path, ["symbolic-ref", "--short", "HEAD"]), "feature/x");
});

test("a fork PR is checked out with gh into pr-<number>", async (t) => {
  const { source, data, wtRoot } = await fixture(t);
  const fork = pr({ number: 12, isCrossRepository: true, headRefName: "patch-1" });
  const calls: Array<{ cwd: string; args: string[] }> = [];
  const run: Gh = async (cwd, args) => {
    calls.push({ cwd, args });
    if (args[1] === "view") return JSON.stringify(fork);
    if (args[1] === "checkout") { await git(cwd, ["checkout", "-b", args[4]!]); return ""; }
    throw new Error(`unexpected gh ${args.join(" ")}`);
  };
  const resolved = await resolveRef(source, "12", { gh: run });
  assert.equal(resolved.branch, "pr-12");
  const created = await createExisting(data, wtRoot, "k4", source, resolved, { gh: run });
  assert.equal(created.path, path.join(wtRoot, "repo", "pr-12"));
  assert.deepEqual(calls.at(-1), { cwd: created.path, args: ["pr", "checkout", "12", "--branch", "pr-12"] });
  assert.equal(await git(created.path, ["symbolic-ref", "--short", "HEAD"]), "pr-12");
});

test("the picker lists open PRs and remote branches, and keeps working without gh", async (t) => {
  const { source } = await fixture(t);
  const withGh = await listRefs(source, { gh: async () => JSON.stringify([pr()]) });
  assert.deepEqual(withGh.branches.sort(), ["feature/x", "main"]);
  assert.equal(withGh.prs[0]?.number, 7);
  assert.equal(withGh.prError, null);
  const without = await listRefs(source, { gh: noGh });
  assert.deepEqual(without.prs, []);
  assert.equal(without.prError, "gh unavailable");
});
