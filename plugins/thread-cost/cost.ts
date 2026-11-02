// Pure cost math and transcript parsers. No file system access, so tests can
// feed lines directly. Rates are USD per million tokens, matching Pi's model
// registry (~/.pi/agent/models-store.json).

export interface Rates {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}
export interface ModelCost extends Rates {
  tiers?: (Rates & { inputTokensAbove: number })[];
}
export type PriceSource = "anthropic" | "openai-codex" | "openai";
export type PriceTable = Partial<Record<PriceSource, Record<string, ModelCost>>>;

/** Token counts in Pi's shape: `input` excludes cache reads and writes. */
export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cacheWrite1h: number;
}

export interface ModelTotals extends Omit<Usage, "cacheWrite1h"> {
  model: string;
  requests: number;
  /** Null when no price is known for this model. */
  usd: number | null;
}
export interface CostReport {
  /** Sum of priced models only. */
  usd: number;
  models: ModelTotals[];
  unpricedModels: string[];
  files: number;
}

/** Same formula as Pi's `calculateCost`, so Pi and non-Pi threads agree. */
export function priceUsage(cost: ModelCost, usage: Usage): number {
  const promptTokens = usage.input + usage.cacheRead + usage.cacheWrite;
  let rates: Rates = cost;
  let matched = -1;
  for (const tier of cost.tiers ?? []) {
    if (promptTokens > tier.inputTokensAbove && tier.inputTokensAbove > matched) {
      rates = tier;
      matched = tier.inputTokensAbove;
    }
  }
  // Anthropic charges 2x base input for 1h cache writes.
  const longWrite = usage.cacheWrite1h;
  const shortWrite = usage.cacheWrite - longWrite;
  return (
    rates.input * usage.input +
    rates.output * usage.output +
    rates.cacheRead * usage.cacheRead +
    rates.cacheWrite * shortWrite +
    rates.input * 2 * longWrite
  ) / 1_000_000;
}

export function lookupPrice(table: PriceTable, sources: PriceSource[], model: string): ModelCost | null {
  const candidates = [model, model.replace(/-\d{8}$/, "")];
  for (const source of sources) {
    for (const id of candidates) {
      const cost = table[source]?.[id];
      if (cost) return cost;
    }
  }
  return null;
}

/** Parses ~/.pi/agent/models-store.json: `{ [provider]: { models: [{ id, cost }] } }`. */
export function parsePriceTable(json: unknown): PriceTable {
  const table: PriceTable = {};
  if (!isRecord(json)) return table;
  for (const source of ["anthropic", "openai-codex", "openai"] as const) {
    const entry = json[source];
    const models = isRecord(entry) ? entry.models : undefined;
    if (!Array.isArray(models)) continue;
    const byId: Record<string, ModelCost> = {};
    for (const model of models) {
      if (isRecord(model) && typeof model.id === "string" && isRecord(model.cost)) {
        byId[model.id] = model.cost as unknown as ModelCost;
      }
    }
    table[source] = byId;
  }
  return table;
}

export class Accumulator {
  private readonly byModel = new Map<string, ModelTotals>();
  private readonly unpriced = new Set<string>();
  private readonly table: PriceTable;
  private readonly sources: PriceSource[];
  files = 0;

  constructor(table: PriceTable, sources: PriceSource[]) {
    this.table = table;
    this.sources = sources;
  }

  /** `usd` overrides the price lookup when the transcript already carries a cost. */
  add(model: string, usage: Usage, usd?: number) {
    let cost = usd ?? null;
    if (cost === null) {
      const price = lookupPrice(this.table, this.sources, model);
      if (price) cost = priceUsage(price, usage);
      else this.unpriced.add(model);
    }
    const totals = this.byModel.get(model) ?? {
      model, requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, usd: 0,
    };
    totals.requests += 1;
    totals.input += usage.input;
    totals.output += usage.output;
    totals.cacheRead += usage.cacheRead;
    totals.cacheWrite += usage.cacheWrite;
    totals.usd = cost === null || totals.usd === null ? null : totals.usd + cost;
    this.byModel.set(model, totals);
  }

  /** Adds a flat USD amount (e.g. server-side tool fees) to a model's total. */
  addFee(model: string, usd: number) {
    const totals = this.byModel.get(model);
    if (totals && totals.usd !== null) totals.usd += usd;
  }

  report(): CostReport {
    const models = [...this.byModel.values()].sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0));
    return {
      usd: models.reduce((sum, m) => sum + (m.usd ?? 0), 0),
      models,
      unpricedModels: [...this.unpriced],
      files: this.files,
    };
  }
}

const WEB_SEARCH_USD = 0.01;

/** Pi session JSONL: assistant messages carry Pi's own computed cost. */
export function addPiSession(lines: Iterable<string>, acc: Accumulator) {
  for (const line of lines) {
    const entry = parseLine(line);
    const message = isRecord(entry?.message) ? entry.message : null;
    if (entry?.type !== "message" || message?.role !== "assistant" || !isRecord(message.usage)) continue;
    const u = message.usage;
    const cost = isRecord(u.cost) ? num(u.cost.total) : 0;
    acc.add(String(message.model ?? "unknown"), {
      input: num(u.input),
      output: num(u.output),
      cacheRead: num(u.cacheRead),
      cacheWrite: num(u.cacheWrite),
      cacheWrite1h: num(u.cacheWrite1h),
    }, cost);
  }
}

/**
 * Claude Code transcript JSONL. One API response is split across several
 * lines that repeat the same `message.id` and usage, so keep the last per id.
 */
export function addClaudeTranscript(lines: Iterable<string>, acc: Accumulator) {
  const responses = new Map<string, { model: string; usage: Record<string, unknown> }>();
  let anonymous = 0;
  for (const line of lines) {
    const entry = parseLine(line);
    const message = isRecord(entry?.message) ? entry.message : null;
    if (entry?.type !== "assistant" || !message || !isRecord(message.usage)) continue;
    const model = String(message.model ?? "unknown");
    if (model === "<synthetic>") continue;
    const id = typeof message.id === "string" ? message.id : `anon-${anonymous++}`;
    responses.set(id, { model, usage: message.usage });
  }
  for (const { model, usage: u } of responses.values()) {
    const creation = isRecord(u.cache_creation) ? u.cache_creation : {};
    acc.add(model, {
      input: num(u.input_tokens),
      output: num(u.output_tokens),
      cacheRead: num(u.cache_read_input_tokens),
      cacheWrite: num(u.cache_creation_input_tokens),
      cacheWrite1h: num(creation.ephemeral_1h_input_tokens),
    });
    const tools = isRecord(u.server_tool_use) ? u.server_tool_use : {};
    const searches = num(tools.web_search_requests);
    if (searches > 0) acc.addFee(model, searches * WEB_SEARCH_USD);
  }
}

/**
 * Codex rollout JSONL. Newer rollouts write one `token_usage_record` per
 * response; older ones only have cumulative `token_count` events, which can
 * repeat, so those are diffed against the previous total.
 */
export function addCodexRollout(lines: Iterable<string>, acc: Accumulator) {
  const modelByTurn = new Map<string, string>();
  let currentModel = "unknown";
  const records: { turnId: string | null; usage: Record<string, unknown> }[] = [];
  const counts: { model: string; usage: Record<string, unknown> }[] = [];
  let lastTotal = "";
  for (const line of lines) {
    const entry = parseLine(line);
    const payload = isRecord(entry?.payload) ? entry.payload : null;
    if (!payload) continue;
    if (entry?.type === "turn_context" && typeof payload.model === "string") {
      currentModel = payload.model;
      if (typeof payload.turn_id === "string") modelByTurn.set(payload.turn_id, payload.model);
    } else if (entry?.type === "token_usage_record" && isRecord(payload.usage)) {
      records.push({ turnId: typeof payload.turn_id === "string" ? payload.turn_id : null, usage: payload.usage });
    } else if (payload.type === "token_count" && isRecord(payload.info)) {
      const total = JSON.stringify(payload.info.total_token_usage);
      if (total === lastTotal || !isRecord(payload.info.last_token_usage)) continue;
      lastTotal = total;
      counts.push({ model: currentModel, usage: payload.info.last_token_usage });
    }
  }
  const usable = records.length > 0
    ? records.map((r) => ({ model: (r.turnId && modelByTurn.get(r.turnId)) || currentModel, usage: r.usage }))
    : counts;
  for (const { model, usage: u } of usable) {
    const cached = num(u.cached_input_tokens);
    const written = num(u.cache_write_input_tokens);
    acc.add(model, {
      input: Math.max(0, num(u.input_tokens) - cached - written),
      output: num(u.output_tokens),
      cacheRead: cached,
      cacheWrite: written,
      cacheWrite1h: 0,
    });
  }
}

function parseLine(line: string): Record<string, unknown> | null {
  if (!line) return null;
  try {
    const value: unknown = JSON.parse(line);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
