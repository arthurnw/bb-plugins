// Shows a Pi thread's permission-gate mode above the composer and lets the user
// switch it. Pi's bb-bridge extension reports the mode with
// `bb permission-gate report <mode>` and long-polls `bb permission-gate wait`
// for modes picked in the chip.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { MODE_CHANGED, type ModeChanged, type PermissionMode, permissionModes } from "./shared";

const modeSchema = z.enum(permissionModes);

export const rpcContract = defineRpcContract({
  mode_get: {
    input: z.object({ threadId: z.string().min(1) }),
    output: z.object({ mode: modeSchema.nullable() }),
  },
  mode_set: {
    input: z.object({ threadId: z.string().min(1), mode: modeSchema }),
    output: z.object({ delivered: z.boolean() }),
  },
});

const usage = [
  "Usage:",
  "  bb permission-gate report <protected|permissive|yolo> [--thread <id>]",
  "  bb permission-gate show [--thread <id>]",
  "  bb permission-gate wait [--mode <current>] [--thread <id>]",
].join("\n");

/** How long one `wait` call blocks before returning `{ mode: null }`. */
const WAIT_MS = 25_000;
/** A Pi process that polled this recently is between polls, not gone. */
const POLL_GAP_MS = 5_000;

interface ThreadLink {
  waiters: Set<(mode: PermissionMode | null) => void>;
  pending: PermissionMode | null;
  lastPoll: number;
}

export default async function plugin(bb: BbPluginApi) {
  async function readMode(threadId: string): Promise<PermissionMode | null> {
    const metadata = await bb.sdk.threads.getPluginMetadata({ threadId });
    const parsed = modeSchema.safeParse(metadata.mode);
    return parsed.success ? parsed.data : null;
  }

  async function recordMode(threadId: string, mode: PermissionMode): Promise<void> {
    if ((await readMode(threadId)) === mode) return;
    await bb.sdk.threads.updatePluginMetadata({ threadId, set: { mode } });
    bb.realtime.publish(MODE_CHANGED, { threadId, mode } satisfies ModeChanged);
  }

  // In memory: a plugin reload drops pending picks, and Pi's poll reconnects.
  const links = new Map<string, ThreadLink>();
  const linkFor = (threadId: string): ThreadLink => {
    let link = links.get(threadId);
    if (!link) {
      link = { waiters: new Set(), pending: null, lastPoll: 0 };
      links.set(threadId, link);
    }
    return link;
  };

  /** Hands a picked mode to the thread's Pi process; false when none is polling. */
  function deliver(threadId: string, mode: PermissionMode): boolean {
    const link = linkFor(threadId);
    if (link.waiters.size > 0) {
      for (const resolve of link.waiters) resolve(mode);
      link.waiters.clear();
      return true;
    }
    if (Date.now() - link.lastPoll < POLL_GAP_MS) {
      link.pending = mode;
      return true;
    }
    return false;
  }

  function waitForPick(threadId: string, signal?: AbortSignal): Promise<PermissionMode | null> {
    const link = linkFor(threadId);
    link.lastPoll = Date.now();
    if (link.pending) {
      const mode = link.pending;
      link.pending = null;
      return Promise.resolve(mode);
    }
    return new Promise((resolve) => {
      const finish = (mode: PermissionMode | null) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        link.waiters.delete(finish);
        link.lastPoll = Date.now();
        resolve(mode);
      };
      const onAbort = () => finish(null);
      const timer = setTimeout(() => finish(null), WAIT_MS);
      signal?.addEventListener("abort", onAbort, { once: true });
      link.waiters.add(finish);
    });
  }

  bb.onDispose(() => {
    for (const link of links.values()) for (const resolve of link.waiters) resolve(null);
    links.clear();
  });

  bb.rpc.register(rpcContract, {
    mode_get: async ({ threadId }) => ({ mode: await readMode(threadId) }),
    mode_set: async ({ threadId, mode }) => ({ delivered: deliver(threadId, mode) }),
  });

  bb.cli.register({
    name: "permission-gate",
    summary: "Record or show a Pi thread's permission-gate mode (used by Pi's bb-bridge extension)",
    commands: [
      {
        name: "report",
        summary: "Record the thread's current permission-gate mode",
        usage: "bb permission-gate report <protected|permissive|yolo> [--thread <id>]",
      },
      {
        name: "wait",
        summary: "Wait up to 25s for a mode picked in bb; prints it, or null on timeout. --mode also records the current mode",
        usage: "bb permission-gate wait [--mode <current>] [--thread <id>]",
      },
      {
        name: "show",
        summary: "Print the thread's recorded permission-gate mode",
        usage: "bb permission-gate show [--thread <id>]",
      },
    ],
    async run(argv, ctx) {
      const json = argv.includes("--json");
      const args = argv.filter((arg) => arg !== "--json");
      const flags = new Map<string, string | undefined>();
      const positionals: string[] = [];
      for (let i = 0; i < args.length; i++) {
        const arg = args[i] ?? "";
        if (arg === "--thread" || arg === "--mode") flags.set(arg, args[++i]);
        else positionals.push(arg);
      }
      const threadId = flags.get("--thread") ?? ctx.threadId;
      const [command, value] = positionals;
      const fail = (message: string) =>
        json
          ? { exitCode: 1, stdout: JSON.stringify({ ok: false, error: { code: "usage", message, hint: usage } }), stderr: message }
          : { exitCode: 1, stderr: `${message}\n${usage}` };

      if (command === undefined || command === "help" || command === "--help") return { exitCode: 0, stdout: usage };
      if (!threadId) return fail("No thread: run inside a BB thread or pass --thread <id>.");

      if (command === "report") {
        const parsed = modeSchema.safeParse(value);
        if (!parsed.success) return fail(`Unknown mode: ${value ?? "(missing)"}`);
        await recordMode(threadId, parsed.data);
        return { exitCode: 0, stdout: json ? JSON.stringify({ threadId, mode: parsed.data }) : parsed.data };
      }
      if (command === "show") {
        const mode = await readMode(threadId);
        return { exitCode: 0, stdout: json ? JSON.stringify({ threadId, mode }) : (mode ?? "unknown") };
      }
      if (command === "wait") {
        // Each poll carries Pi's current mode, so a missed report or a stray
        // process's report is corrected within one poll.
        if (flags.has("--mode")) {
          const current = modeSchema.safeParse(flags.get("--mode"));
          if (!current.success) return fail(`Unknown mode: ${flags.get("--mode") ?? "(missing)"}`);
          await recordMode(threadId, current.data);
        }
        const mode = await waitForPick(threadId, ctx.signal);
        return { exitCode: 0, stdout: json ? JSON.stringify({ threadId, mode }) : (mode ?? "null") };
      }
      return fail(`Unknown command: ${command}`);
    },
  });
}
