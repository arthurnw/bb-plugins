// The `plannotator_inbox` agent tool for BB threads whose agent cannot load
// Plannotator's own tool (Claude Code and Codex run through their SDKs in BB),
// and Plannotator's reply wake for each thread that used it, so the person's
// replies start a turn in that thread.
//
// The Inbox protocol lives in vendor/ (copied unchanged from
// @plannotator/pi-extension's generated/inbox).
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { homedir } from "node:os";
import { InboxAgentConnection, InboxWake, discoverInboxTools } from "./vendor/agent-link.ts";
import { inboxAgentTool, inboxReminderText } from "./vendor/connection.ts";

/** Providers this plugin serves. Pi is left out: its Plannotator extension has the tool and the wake. */
const PROVIDERS: Record<string, { host: string; name: string }> = {
  "claude-code": { host: "claude-code", name: "Claude Code" },
  codex: { host: "codex", name: "Codex" },
};

const BUSY_STATUSES = new Set(["active", "pending", "starting", "stopping"]);
const WAKE_KEY_PREFIX = "wake:";
const PRUNE_EVERY_MS = 10 * 60_000;

interface WakeRecord {
  providerId: string;
  cwd: string;
  usedAt: number;
}

export interface AgentToolOptions {
  dataDir: string;
  /** Command that starts the Inbox; undefined uses the vendored default (PATH, then ~/.local/bin). */
  plannotatorCommand?: string;
}

/** Registers the tool and the reply wakes. Returns false when no Inbox has run on this machine yet. */
export async function registerAgentTool(bb: BbPluginApi, { dataDir, plannotatorCommand }: AgentToolOptions): Promise<boolean> {
  const tools = await discoverInboxTools(dataDir);
  const spec = tools && inboxAgentTool(tools);
  if (!tools || !spec) {
    bb.log.warn("No Plannotator Inbox found; the plannotator_inbox tool is off until the plugin reloads after the Inbox has run once.");
    return false;
  }

  const connections = new Map<string, InboxAgentConnection>();
  const connectionFor = (providerId: string): InboxAgentConnection | null => {
    const provider = PROVIDERS[providerId];
    if (!provider) return null;
    let connection = connections.get(providerId);
    if (!connection) {
      connection = new InboxAgentConnection({ dataDir, host: provider.host, agentName: provider.name, tools, command: plannotatorCommand });
      connections.set(providerId, connection);
    }
    return connection;
  };

  const wakes = new Map<string, InboxWake>();
  let servicesRunning = false;

  const startWake = (threadId: string, record: WakeRecord): InboxWake | null => {
    const existing = wakes.get(threadId);
    if (existing && !existing.isDisposed) return existing;
    const connection = connectionFor(record.providerId);
    if (!connection) return null;
    const send = async (text: string, mode: "queue-if-active" | "steer") => {
      await bb.sdk.threads.send({ threadId, mode, input: [{ type: "text", text, mentions: [] }] });
    };
    const wake = new InboxWake(connection, threadId, {
      async isBusy() {
        const thread = await bb.sdk.threads.get({ threadId });
        return BUSY_STATUSES.has(thread.status) || thread.queuedMessageCount > 0;
      },
      deliver: (text) => send(text, "queue-if-active"),
      steer: (text) => send(text, "steer"),
      notify: (message) => bb.log.warn(`[${threadId}] ${message}`),
      projectPath: () => record.cwd,
    });
    wakes.set(threadId, wake);
    if (servicesRunning) wake.start();
    return wake;
  };

  const stopWake = async (threadId: string) => {
    wakes.get(threadId)?.dispose();
    wakes.delete(threadId);
    await bb.storage.kv.delete(WAKE_KEY_PREFIX + threadId);
  };

  bb.agents.registerTool({
    name: spec.name,
    description: spec.description,
    instructions: [
      inboxReminderText(spec.name, { wakes: true }),
      "In BB, use this tool rather than a `plannotator-inbox` MCP server: only replies to messages sent with this tool come back to this thread by themselves.",
    ].join("\n"),
    presentation: { label: { pending: "Calling the Plannotator Inbox", completed: "Called the Plannotator Inbox" } },
    parameters: spec.inputSchema,
    async execute(params, { threadId }) {
      const result = await bb.sdk.threads.get({ threadId, include: "environment" });
      const providerId = result.providerId;
      const connection = connectionFor(providerId);
      if (!connection) {
        return { content: [{ type: "text", text: `plannotator_inbox from this plugin does not serve ${providerId} threads.` }], isError: true };
      }
      const cwd = ("environment" in result && result.environment?.path) || homedir();
      const record: WakeRecord = { providerId, cwd, usedAt: Date.now() };
      await bb.storage.kv.set(WAKE_KEY_PREFIX + threadId, record);
      const wake = startWake(threadId, record);
      wake?.touch();
      const answer = await connection.callTool(params, { sessionId: threadId, cwd, wakes: wake !== null });
      return { content: [{ type: "text", text: answer.text }], isError: answer.isError };
    },
  });

  bb.agents.configure((context) => ({
    tools: context.provider.id in PROVIDERS ? [spec.name] : [],
    skills: [],
  }));

  bb.background.service("reply-wakes", {
    async start(signal) {
      servicesRunning = true;
      for (const key of await bb.storage.kv.list(WAKE_KEY_PREFIX)) {
        const record = await bb.storage.kv.get<WakeRecord>(key);
        if (record) startWake(key.slice(WAKE_KEY_PREFIX.length), record);
      }
      for (const wake of wakes.values()) wake.start();
      bb.log.info(`watching ${wakes.size} thread(s) for Inbox replies`);
      try {
        while (!signal.aborted) {
          await prune();
          await sleep(PRUNE_EVERY_MS, signal);
        }
      } finally {
        servicesRunning = false;
        for (const wake of wakes.values()) wake.dispose();
        wakes.clear();
      }
    },
  });
  return true;

  /** Stop watching threads that were archived or deleted. */
  async function prune() {
    const ids = [...wakes.keys()];
    for (let i = 0; i < ids.length; i += 200) {
      const batch = ids.slice(i, i + 200);
      const threads = await bb.sdk.threads.list({ threadIds: batch, archived: false });
      const live = new Set(threads.map((thread) => thread.id));
      for (const id of batch) if (!live.has(id)) await stopWake(id);
    }
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}
