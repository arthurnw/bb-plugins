import assert from "node:assert/strict";
import { test } from "node:test";
import { Accumulator, addClaudeTranscript, addCodexRollout, addPiSession, priceUsage, type PriceTable } from "./cost.ts";

const opus = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 };
const sol = {
  input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5,
  tiers: [{ inputTokensAbove: 272000, input: 4, output: 15, cacheRead: 0.2, cacheWrite: 5 }],
};
const table: PriceTable = { anthropic: { "claude-opus-5-5": opus }, "openai-codex": { "gpt-6.1-sol": sol } };
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
const lines = (...entries: unknown[]) => entries.map((e) => JSON.stringify(e));

test("matches Claude Code's total_cost_usd for a 1h-cache session", () => {
  // Claude Code reported $0.3598372 for these tokens (costBasis "list").
  const usd = priceUsage(opus, { input: 4, output: 171, cacheRead: 54446, cacheWrite: 43189, cacheWrite1h: 43189 });
  close(usd, 0.3598372);
});

test("uses the higher tier once the prompt exceeds its threshold", () => {
  close(priceUsage(sol, { input: 300_000, output: 1_000, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0 }), (300_000 * 4 + 1_000 * 15) / 1e6);
});

test("Claude: counts each message id once and adds web search fees", () => {
  const usage = { input_tokens: 10, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, server_tool_use: { web_search_requests: 2 } };
  const acc = new Accumulator(table, ["anthropic"]);
  addClaudeTranscript(lines(
    { type: "assistant", message: { id: "m1", model: "claude-opus-5-5", usage } },
    { type: "assistant", message: { id: "m1", model: "claude-opus-5-5", usage } },
    { type: "assistant", message: { id: "m2", model: "<synthetic>", usage } },
  ), acc);
  const report = acc.report();
  assert.equal(report.models[0]!.requests, 1);
  close(report.usd, (10 * 4 + 100 * 20) / 1e6 + 0.02);
});

test("Codex: prices token_usage_record with the turn's model, excluding cached input", () => {
  const acc = new Accumulator(table, ["openai-codex"]);
  addCodexRollout(lines(
    { type: "turn_context", payload: { turn_id: "t1", model: "gpt-6.1-sol" } },
    { type: "token_usage_record", payload: { turn_id: "t1", usage: { input_tokens: 1000, cached_input_tokens: 800, output_tokens: 50 } } },
    { type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 1 }, last_token_usage: { input_tokens: 999999 } } } },
  ), acc);
  close(acc.report().usd, (200 * 2 + 800 * 0.1 + 50 * 10) / 1e6);
});

test("Codex: falls back to token_count events and skips repeats", () => {
  const count = (total: number) => ({
    type: "event_msg",
    payload: { type: "token_count", info: { total_token_usage: { total_tokens: total }, last_token_usage: { input_tokens: 100, output_tokens: 10 } } },
  });
  const acc = new Accumulator(table, ["openai-codex"]);
  addCodexRollout(lines({ type: "turn_context", payload: { model: "gpt-6.1-sol" } }, count(110), count(110), count(220)), acc);
  assert.equal(acc.report().models[0]!.requests, 2);
});

test("Pi: sums the recorded cost and reports unknown models as unpriced elsewhere", () => {
  const acc = new Accumulator(table, []);
  addPiSession(lines(
    { type: "message", message: { role: "assistant", model: "x", usage: { input: 1, output: 1, cost: { total: 0.5 } } } },
    { type: "message", message: { role: "user" } },
  ), acc);
  close(acc.report().usd, 0.5);
  const unpriced = new Accumulator(table, ["anthropic"]);
  addClaudeTranscript(lines({ type: "assistant", message: { id: "a", model: "mystery", usage: { output_tokens: 5 } } }), unpriced);
  assert.deepEqual(unpriced.report().unpricedModels, ["mystery"]);
});
