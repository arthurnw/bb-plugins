import {
  definePluginApp,
  experimental_useRpcKeyedQuery,
  type ExperimentalThreadContextSegmentProps,
} from "@get-bb/plugin-sdk/app";
import { formatTokens, formatUsd } from "./format.ts";
import { rpcContract, type ThreadCost } from "./rpc.ts";

function useThreadCost(threadId: string): ThreadCost | null | undefined {
  return experimental_useRpcKeyedQuery({
    contract: rpcContract,
    method: "threadCosts",
    keys: [threadId],
  }).data?.[threadId];
}

function tooltip(cost: ThreadCost): string {
  const own = cost.own!;
  const lines = ["Estimated API cost at list prices"];
  for (const m of own.models) lines.push(`${m.model}: ${m.usd === null ? "no price" : formatUsd(m.usd)}`);
  if (cost.childCount > 0) lines.push(`With ${cost.childCount} child threads: ${formatUsd(cost.totalUsd)}`);
  if (own.unpricedModels.length > 0) lines.push(`No price for ${own.unpricedModels.join(", ")}`);
  return lines.join("\n");
}

function CostSummary({ threadId, onToggle }: ExperimentalThreadContextSegmentProps) {
  const cost = useThreadCost(threadId);
  if (!cost?.own || cost.own.files === 0) return null;
  const incomplete = cost.own.unpricedModels.length > 0;
  return (
    <button
      type="button"
      onClick={onToggle}
      title={tooltip(cost)}
      aria-label={`Estimated cost ${formatUsd(cost.own.usd)}`}
      className="flex min-h-6 items-center gap-1 rounded px-2 py-1 text-xs tabular-nums text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground"
    >
      {formatUsd(cost.own.usd)}
      {incomplete ? "+" : null}
      {cost.childCount > 0 ? <span className="opacity-70">({formatUsd(cost.totalUsd)} total)</span> : null}
    </button>
  );
}

function CostDetails({ threadId, isExpanded }: ExperimentalThreadContextSegmentProps) {
  const cost = useThreadCost(threadId);
  if (!isExpanded || !cost?.own) return null;
  return (
    <div className="px-2 py-1 text-xs text-muted-foreground">
      <table className="tabular-nums">
        <thead>
          <tr className="text-left">
            {["Model", "Requests", "Input", "Cache read", "Cache write", "Output", "Cost"].map((h) => (
              <th key={h} className="pr-4 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cost.own.models.map((m) => (
            <tr key={m.model}>
              <td className="pr-4">{m.model}</td>
              <td className="pr-4">{m.requests}</td>
              <td className="pr-4">{formatTokens(m.input)}</td>
              <td className="pr-4">{formatTokens(m.cacheRead)}</td>
              <td className="pr-4">{formatTokens(m.cacheWrite)}</td>
              <td className="pr-4">{formatTokens(m.output)}</td>
              <td className="pr-4">{m.usd === null ? "no price" : formatUsd(m.usd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 opacity-70">
        List-price estimate from the session transcript, priced with Pi's model table.
        {cost.childCount > 0 ? ` Child threads add ${formatUsd(cost.totalUsd - cost.own.usd)}.` : ""}
      </p>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_threadContextSegment({
    id: "cost",
    title: "Cost",
    group: "9_cost",
    summary: CostSummary,
    details: CostDetails,
  });
});
