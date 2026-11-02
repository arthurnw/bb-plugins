// Finds a provider session's transcript files on this machine and prices them.
import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  Accumulator,
  addClaudeTranscript,
  addCodexRollout,
  addPiSession,
  parsePriceTable,
  type CostReport,
  type PriceSource,
  type PriceTable,
} from "./cost.ts";
import type { Provider } from "./providers.ts";


export interface CostRequest {
  provider: Provider;
  sessionIds: string[];
  /** bb's data directory, where the Pi bridge keeps its sessions. */
  bbDataDir: string | null;
}
export interface CostResult extends CostReport {
  /** Session ids with no transcript on this machine. */
  missing: string[];
}

const home = homedir();
const claudeDir = process.env.CLAUDE_CONFIG_DIR || join(home, ".claude");
const codexDir = process.env.CODEX_HOME || join(home, ".codex");
const piPrices = join(process.env.PI_CODING_AGENT_DIR || join(home, ".pi", "agent"), "models-store.json");

const PRICE_SOURCES: Record<Provider, PriceSource[]> = {
  pi: [],
  "claude-code": ["anthropic"],
  codex: ["openai-codex", "openai"],
};

const cache = new Map<string, { fingerprint: string; result: CostResult }>();

export async function computeCost(request: CostRequest): Promise<CostResult> {
  const files = new Set<string>();
  const missing: string[] = [];
  for (const id of request.sessionIds) {
    const found = await findFiles(request, id);
    if (found.length === 0) missing.push(id);
    for (const file of found) files.add(file);
  }
  const paths = [...files].sort();
  const fingerprint = (await Promise.all([piPrices, ...paths].map(statKey))).join("|");
  const key = `${request.provider}:${request.sessionIds.join(",")}`;
  const hit = cache.get(key);
  if (hit?.fingerprint === fingerprint) return hit.result;

  const acc = new Accumulator(await loadPrices(), PRICE_SOURCES[request.provider]);
  const parse = { pi: addPiSession, "claude-code": addClaudeTranscript, codex: addCodexRollout }[request.provider];
  for (const path of paths) {
    const text = await readFile(path, "utf8").catch(() => null);
    if (text === null) continue;
    acc.files += 1;
    parse(text.split("\n"), acc);
  }
  const result = { ...acc.report(), missing };
  cache.set(key, { fingerprint, result });
  return result;
}

async function findFiles(request: CostRequest, id: string): Promise<string[]> {
  switch (request.provider) {
    case "pi":
      return findPi(request.bbDataDir, id);
    case "claude-code":
      return findClaude(id);
    case "codex":
      return findCodex(id);
  }
}

function findPi(bbDataDir: string | null, id: string): string[] {
  const dirs = [bbDataDir, join(home, ".bb")].filter((d): d is string => !!d);
  for (const dir of dirs) {
    const path = join(dir, "pi-bridge-sessions", `${id}.jsonl`);
    if (existsSync(path)) return [path];
  }
  return [];
}

/** `projects/<cwd>/<id>.jsonl` plus subagent transcripts in `<id>/subagents/`. */
async function findClaude(id: string): Promise<string[]> {
  const root = join(claudeDir, "projects");
  const projects = await readdir(root).catch(() => []);
  for (const project of projects) {
    const transcript = join(root, project, `${id}.jsonl`);
    if (!existsSync(transcript)) continue;
    const subagentDir = join(root, project, id, "subagents");
    const subagents = (await readdir(subagentDir).catch(() => []))
      .filter((name) => name.endsWith(".jsonl"))
      .map((name) => join(subagentDir, name));
    return [transcript, ...subagents];
  }
  return [];
}

/** The rollout for `id` and every subagent thread it spawned, via Codex's state DB. */
function findCodex(id: string): string[] {
  const dbPath = join(codexDir, "state_5.sqlite");
  if (!existsSync(dbPath)) return [];
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const rollout = db.prepare("SELECT rollout_path FROM threads WHERE id = ?");
    const children = db.prepare("SELECT child_thread_id FROM thread_spawn_edges WHERE parent_thread_id = ?");
    const files: string[] = [];
    const seen = new Set<string>();
    const queue = [id];
    while (queue.length > 0) {
      const threadId = queue.shift()!;
      if (seen.has(threadId)) continue;
      seen.add(threadId);
      const row = rollout.get(threadId) as { rollout_path?: string } | undefined;
      const path = row?.rollout_path ? resolveRollout(row.rollout_path) : null;
      if (path) files.push(path);
      for (const child of children.all(threadId) as { child_thread_id: string }[]) queue.push(child.child_thread_id);
    }
    return files;
  } finally {
    db.close();
  }
}

/** Archiving moves a rollout to `archived_sessions/` without always updating the DB path. */
function resolveRollout(path: string): string | null {
  if (existsSync(path)) return path;
  const archived = join(codexDir, "archived_sessions", path.split("/").pop()!);
  return existsSync(archived) ? archived : null;
}

let prices: { key: string; table: PriceTable } | null = null;
async function loadPrices(): Promise<PriceTable> {
  const key = await statKey(piPrices);
  if (prices?.key === key) return prices.table;
  const text = await readFile(piPrices, "utf8").catch(() => null);
  let table: PriceTable = {};
  try {
    table = text ? parsePriceTable(JSON.parse(text)) : {};
  } catch {
    // Leave the table empty; every model then reports as unpriced.
  }
  prices = { key, table };
  return table;
}

async function statKey(path: string): Promise<string> {
  const s = await stat(path).catch(() => null);
  return s ? `${path}:${s.size}:${s.mtimeMs}` : `${path}:-`;
}
