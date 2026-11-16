import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GUARD_SCRIPT, guardSettings } from "./guard-script.ts";

// A fake `bb` that answers `bb bots role` with a fixed report.
function setup(roleFor: (workspace: string) => object | null) {
  const dir = mkdtempSync(join(tmpdir(), "bots-guard-"));
  const workspace = join(dir, "ws");
  mkdirSync(workspace);
  const role = roleFor(workspace);
  const script = join(dir, "guard.mjs");
  writeFileSync(script, GUARD_SCRIPT);
  const bb = join(dir, "bb");
  writeFileSync(bb, role === null ? "#!/bin/sh\nexit 3\n" : `#!/bin/sh\necho '${JSON.stringify(role)}'\n`, { mode: 0o755 });
  const run = (filePath: string, threadId = "thr_c") => {
    const result = spawnSync("node", [script], { input: JSON.stringify({ tool_name: "Edit", tool_input: { file_path: filePath }, cwd: workspace }),
      env: { ...process.env, BB_CLI: bb, BB_THREAD_ID: threadId, TMPDIR: join(dir, "tmp") }, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout ? JSON.parse(result.stdout).hookSpecificOutput.permissionDecision : "allow";
  };
  return { dir, workspace, run };
}

test("a coordinator may write only in its workspace and temp directories", () => {
  const { workspace, run } = setup((ws) => ({ coordinator: true, workspace: ws, botName: "B" }));
  assert.equal(run(join(workspace, "tracker.md")), "allow");
  assert.equal(run("log.md"), "allow");
  assert.equal(run(join(workspace, "..", "src", "a.ts")), "deny");
  assert.equal(run("/tmp/scratch.txt"), "allow");
  const unprovisioned = setup(() => ({ coordinator: true, workspace: null, botName: "B" }));
  assert.equal(unprovisioned.run(join(unprovisioned.dir, "x.ts")), "deny");
});

test("other threads, no thread, and an unreachable bb are allowed", () => {
  assert.equal(setup(() => ({ coordinator: false, workspace: null })).run("/repo/a.ts"), "allow");
  assert.equal(setup(() => null).run("/repo/a.ts"), "allow");
  assert.equal(setup(() => ({ coordinator: true, workspace: "/ws" })).run("/repo/a.ts", ""), "allow");
});

test("the settings entry runs the guard only in bb threads and blocks when it fails", () => {
  const hook = guardSettings("/data/it's/guard.mjs").hooks.PreToolUse[0]!;
  assert.equal(hook.matcher, "Edit|Write|NotebookEdit");
  assert.equal(hook.hooks[0]!.onFailure, "block");
  assert.match(hook.hooks[0]!.command, /^\[ -z "\$BB_THREAD_ID" \] \|\| node '\/data\/it'\\''s\/guard\.mjs'$/);
});
