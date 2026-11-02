import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { hostContract, type CostResultData } from "./contract.ts";
import { costTag, rpcContract, type ThreadCost } from "./rpc.ts";
import { isProvider } from "./providers.ts";
import { formatUsd } from "./format.ts";

export default function plugin(bb: BbPluginApi) {
  const host = bb.hosts.experimental_client({ contract: hostContract });

  async function ownCost(threadId: string): Promise<{ provider: string; own: CostResultData | null } | null> {
    const thread = await bb.sdk.threads.get({ threadId });
    const provider = thread.providerId;
    if (!isProvider(provider)) return { provider, own: null };
    if (!thread.environmentId) return null;
    const environment = await bb.sdk.environments.get({ environmentId: thread.environmentId });
    const sessionIds = await providerSessionIds(threadId);
    if (sessionIds.length === 0) return { provider, own: null };
    const own = await host.call(
      "cost",
      { provider, sessionIds, bbDataDir: bb.server.experimental_dataDir },
      { hostId: environment.hostId },
    );
    return { provider, own };
  }

  /** Every provider session the thread has used; clearing context or restarting can add more. */
  async function providerSessionIds(threadId: string): Promise<string[]> {
    const ids = new Set<string>();
    let afterSeq: string | undefined;
    for (;;) {
      const page = await bb.sdk.threads.events.list({ threadId, types: ["thread/identity"], limit: "100", afterSeq });
      for (const event of page) if (event.type === "thread/identity") ids.add(event.data.providerThreadId);
      if (page.length < 100) return [...ids];
      afterSeq = String(page[page.length - 1]!.seq);
    }
  }

  async function threadCost(threadId: string): Promise<ThreadCost | null> {
    const [self, tree] = await Promise.all([
      ownCost(threadId),
      bb.sdk.threads.experimental_listDescendants({ threadIds: [threadId], includeArchived: true, includeHidden: true }),
    ]);
    if (!self) return null;
    const childIds = tree.threads.find((t) => t.threadId === threadId)?.descendantIds ?? [];
    const children = await Promise.all(childIds.map((id) => ownCost(id).catch(() => null)));
    const childUsd = children.reduce((sum, child) => sum + (child?.own?.usd ?? 0), 0);
    return { ...self, totalUsd: (self.own?.usd ?? 0) + childUsd, childCount: childIds.length };
  }

  bb.rpc.register(rpcContract, {
    async threadCosts({ keys }) {
      const entries = await Promise.all(keys.map(async (threadId) => {
        try {
          return [threadId, await threadCost(threadId)] as const;
        } catch (error) {
          bb.log.warn(`cost for ${threadId} failed: ${error instanceof Error ? error.message : String(error)}`);
          return [threadId, null] as const;
        }
      }));
      return Object.fromEntries(entries);
    },
  });

  // A finished turn changes this thread's cost and every ancestor's total.
  bb.events.on("thread.idle", async ({ thread }) => {
    const { threads } = await bb.sdk.threads.experimental_listAncestors({ threadIds: [thread.id] });
    const ancestors = threads.find((t) => t.threadId === thread.id)?.ancestorIds ?? [];
    bb.rpc.experimental_invalidate([thread.id, ...ancestors].map(costTag));
  });

  const usage = "Usage: bb thread-cost show [thread-id] [--json]";
  bb.cli.register({
    name: "thread-cost",
    summary: "Show a thread's estimated API cost at list prices",
    commands: [{ name: "show", summary: "Cost of a thread (default: the calling thread)", usage }],
    async run(argv, ctx) {
      const json = argv.includes("--json");
      const [command, ...args] = argv.filter((arg) => arg !== "--json");
      if (command !== "show" || args.length > 1) return { exitCode: command === undefined ? 1 : 0, stdout: usage };
      const threadId = args[0] ?? ctx.threadId;
      if (!threadId) return { exitCode: 1, stderr: `No thread id given and not running inside a thread.\n${usage}` };
      const cost = await threadCost(threadId);
      if (json) return { exitCode: 0, stdout: JSON.stringify(cost) };
      return { exitCode: 0, stdout: describe(threadId, cost) };
    },
  });
}

function describe(threadId: string, cost: ThreadCost | null): string {
  if (!cost) return `${threadId}: no environment, so no transcript to read.`;
  if (!cost.own) return `${threadId}: ${cost.provider} threads aren't supported.`;
  const lines = [`${threadId} (${cost.provider}): ${formatUsd(cost.own.usd)}`];
  for (const m of cost.own.models) {
    lines.push(`  ${m.model}: ${m.usd === null ? "no price" : formatUsd(m.usd)} over ${m.requests} requests`);
  }
  if (cost.childCount > 0) lines.push(`  with ${cost.childCount} child threads: ${formatUsd(cost.totalUsd)}`);
  if (cost.own.unpricedModels.length > 0) lines.push(`  no price for: ${cost.own.unpricedModels.join(", ")}`);
  if (cost.own.missing.length > 0) lines.push(`  no transcript for sessions: ${cost.own.missing.join(", ")}`);
  return lines.join("\n");
}
