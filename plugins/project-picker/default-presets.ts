// Adapted from Ultra Launcher (Dillion Verma); see THIRD_PARTY_LICENSES.md.
import type { ModelPreset } from "./presets.ts";

// Starter presets, ordered most-used first. Each rung lists candidate
// provider/model/effort combinations in preference order; the first one the
// host's catalog actually offers wins, so a Codex-only or Claude-only install
// still gets a sensible ladder rather than rows that error on selection.
//
// Sources (September 2026):
// - Anthropic effort docs: start at xhigh for coding/agentic work, high as the
//   floor for intelligence-sensitive tasks, medium for cost-sensitive work, max
//   only when evals show headroom. Fable 5.1 defaults to High in Claude Code.
// - Anthropic model guidance / claudefa.st: Opus 5 is the everyday default on
//   Claude Code; Fable 5.1 is the escalation for multi-hour autonomous runs;
//   Sonnet 5 covers routine fixes, tests and review; Haiku is the cheap lane.
// - OpenAI GPT-5.6 tiers + Codex knowledge base: Sol for architecture, security
//   review and multi-file refactors (high effort for anything security-
//   sensitive); Terra for standard feature work at medium; Luna at low for
//   docs, formatting and quick edits; GPT-6 Astra for the hardest end-to-end
//   work (Codex ships "Astra Extra High" as a power option).
// - Community consensus (Morph, CodeRabbit): build with one lab, review with
//   the other — hence a Codex-first review rung beside the Claude-first build
//   rungs.

type Level = ModelPreset["reasoningLevel"];

interface DefaultCandidate {
  providerId: string;
  /** Catalog ids to try, in order; BB has renamed ids before (e.g. the `[1m]` suffix). */
  models: readonly string[];
  reasoningLevel: Level;
}

interface DefaultRung {
  /** Stable id so a remembered selection survives a restore. */
  id: string;
  name: string;
  candidates: readonly DefaultCandidate[];
}

const claude = (models: readonly string[], reasoningLevel: Level): DefaultCandidate => ({
  providerId: "claude-code",
  models,
  reasoningLevel,
});
const codex = (models: readonly string[], reasoningLevel: Level): DefaultCandidate => ({
  providerId: "codex",
  models,
  reasoningLevel,
});

const OPUS = ["claude-opus-5[1m]", "claude-opus-5"];
const SONNET = ["claude-sonnet-5"];
const FABLE = ["claude-fable-5-1"];
const HAIKU = ["claude-haiku-4-5-20251001", "claude-haiku-4-5"];
const ASTRA = ["gpt-6-astra"];
const SOL = ["gpt-5.6-sol"];
const TERRA = ["gpt-5.6-terra"];
const LUNA = ["gpt-5.6-luna"];

export const DEFAULT_RUNGS: readonly DefaultRung[] = [
  { id: "default:daily", name: "Daily coding", candidates: [claude(OPUS, "high"), codex(ASTRA, "medium")] },
  { id: "default:quick-fix", name: "Quick fix", candidates: [claude(SONNET, "medium"), codex(TERRA, "medium")] },
  { id: "default:hard", name: "Hard problem", candidates: [claude(OPUS, "xhigh"), codex(ASTRA, "xhigh")] },
  { id: "default:long-run", name: "Long autonomous run", candidates: [claude(FABLE, "high"), codex(ASTRA, "max")] },
  { id: "default:review", name: "Code review", candidates: [codex(SOL, "high"), claude(SONNET, "high")] },
  { id: "default:astra", name: "Build a feature", candidates: [codex(ASTRA, "xhigh")] },
  { id: "default:cheap", name: "Cheap & fast", candidates: [codex(LUNA, "low"), claude(HAIKU, "low")] },
];

/** The slice of BB's execution-options catalog the resolver reads. */
export interface CatalogModel {
  id: string;
  displayName?: string;
  supportedReasoningEfforts: readonly { reasoningEffort: string }[];
  defaultReasoningEffort: string;
}
export type Catalog = ReadonlyMap<string, readonly CatalogModel[]>;

/**
 * Turn the rung table into concrete presets for one host. Rungs with no
 * available candidate are dropped; combinations that resolve identically (a
 * single-provider install collapses several rungs onto one model) keep only
 * their first occurrence; an unsupported effort falls back to the model's own
 * default rather than producing a preset the composer would reject.
 */
export function resolveDefaultPresets(catalog: Catalog): ModelPreset[] {
  const seen = new Set<string>();
  const presets: ModelPreset[] = [];
  for (const rung of DEFAULT_RUNGS) {
    const resolved = resolveRung(rung, catalog);
    if (!resolved) continue;
    const key = `${resolved.providerId}::${resolved.model}::${resolved.reasoningLevel}`;
    if (seen.has(key)) continue;
    seen.add(key);
    presets.push(resolved);
  }
  return presets;
}

function resolveRung(rung: DefaultRung, catalog: Catalog): ModelPreset | null {
  for (const candidate of rung.candidates) {
    const models = catalog.get(candidate.providerId);
    if (!models?.length) continue;
    const model = candidate.models.map((id) => models.find((item) => item.id === id)).find(Boolean);
    if (!model) continue;
    const supported = model.supportedReasoningEfforts.some(
      (effort) => effort.reasoningEffort === candidate.reasoningLevel,
    );
    return {
      id: rung.id,
      name: rung.name,
      providerId: candidate.providerId,
      model: model.id,
      reasoningLevel: supported ? candidate.reasoningLevel : (model.defaultReasoningEffort as Level),
      serviceTier: "default",
    };
  }
  return null;
}
