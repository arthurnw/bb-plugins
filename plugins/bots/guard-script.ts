// The Claude Code PreToolUse hook that keeps coordinator threads from editing
// files outside their bot workspace. The server writes it to a stable path in
// the plugin's data directory, because a plugin's install location varies.
// Plain JavaScript in a string: it runs under `node` without this package.

export const GUARD_FILE = "coordinator-guard.mjs";

export const GUARD_SCRIPT = String.raw`#!/usr/bin/env node
// Bots: deny Edit, Write, and NotebookEdit outside the bot workspace in an
// initiative bot's coordinator thread. Written by the Bots plugin; edits are
// overwritten when the plugin loads.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

const threadId = process.env.BB_THREAD_ID;
if (!threadId) process.exit(0);

let input;
try { input = JSON.parse(readFileSync(0, "utf8")); } catch { process.exit(0); }
const target = input?.tool_input?.file_path ?? input?.tool_input?.notebook_path;
if (typeof target !== "string" || target === "") process.exit(0);

let role;
try {
  const out = execFileSync(process.env.BB_CLI || "bb", ["bots", "role", threadId], { encoding: "utf8", timeout: 8000, stdio: ["ignore", "pipe", "ignore"] });
  role = JSON.parse(out);
} catch {
  // Bots is not running or bb is unreachable: no role to enforce.
  process.exit(0);
}
if (!role?.coordinator) process.exit(0);

// Resolves symlinks in the deepest part of the path that exists.
const real = (path) => {
  let head = resolve(path);
  const tail = [];
  while (!existsSync(head) && dirname(head) !== head) { tail.unshift(head.slice(dirname(head).length + 1)); head = dirname(head); }
  try { head = realpathSync(head); } catch {}
  return resolve(head, ...tail);
};
const inside = (root, path) => {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

const workspace = role.workspace ? real(role.workspace) : null;
const path = real(isAbsolute(target) ? target : resolve(input.cwd ?? process.cwd(), target));
if (workspace && inside(workspace, path)) process.exit(0);
if (inside(real(process.env.TMPDIR || "/tmp"), path) || inside(real("/tmp"), path)) process.exit(0);

process.stdout.write(JSON.stringify({ hookSpecificOutput: {
  hookEventName: "PreToolUse",
  permissionDecision: "deny",
  permissionDecisionReason: "This thread coordinates the \"" + role.botName + "\" initiative and never edits code. Write only in the bot workspace (" + (role.workspace ?? "none") + "); start a worker thread with bb thread spawn --parent-self for code changes.",
} }));
`;

/** The ~/.claude/settings.json entry that runs the guard. */
export function guardSettings(scriptPath: string) {
  return {
    hooks: {
      PreToolUse: [{
        matcher: "Edit|Write|NotebookEdit",
        hooks: [{ type: "command", command: `[ -z "$BB_THREAD_ID" ] || node '${scriptPath.replace(/'/g, "'\\''")}'`, timeout: 15, onFailure: "block" }],
      }],
    },
  };
}
