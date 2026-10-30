import { test } from "node:test";
import assert from "node:assert/strict";
import { filterPresets, findPreset, modelSpec, sameModel, type ModelPreset } from "./presets.ts";
import { resolveDefaultPresets } from "./default-presets.ts";
import { savedModelStateSchema as modelStateSchema } from "./presets.schema.ts";

const preset = (id: string, name: string, model: string, reasoningLevel = "high", serviceTier = "default"): ModelPreset =>
  ({ id, name, providerId: "claude-code", model, reasoningLevel, serviceTier });

test("a selection matches a preset only on provider, model, effort, and tier", () => {
  const a = preset("a", "Daily", "opus");
  assert.equal(sameModel(a, { ...a }), true);
  assert.equal(sameModel(a, { ...a, serviceTier: undefined }), true);
  assert.equal(sameModel(a, { ...a, reasoningLevel: "low" }), false);
  assert.equal(sameModel(a, { ...a, serviceTier: "fast" }), false);
  assert.equal(findPreset([a], null), undefined);
  assert.equal(findPreset([preset("b", "Quick", "sonnet"), a], { ...a }), a);
});

test("preset filtering matches every word against name and model", () => {
  const presets = [preset("a", "Daily coding", "opus"), preset("b", "Quick fix", "sonnet", "medium")];
  assert.deepEqual(filterPresets(presets, "").map((p) => p.id), ["a", "b"]);
  assert.deepEqual(filterPresets(presets, "quick son").map((p) => p.id), ["b"]);
  assert.deepEqual(filterPresets(presets, "medium").map((p) => p.id), ["b"]);
  assert.deepEqual(filterPresets(presets, "nothing"), []);
});

test("default presets keep rungs the catalog offers and drop the rest", () => {
  const catalog = new Map([["claude-code", [
    { id: "claude-opus-5", supportedReasoningEfforts: [{ reasoningEffort: "high" }], defaultReasoningEffort: "high" },
  ]]]);
  const presets = resolveDefaultPresets(catalog);
  assert.deepEqual(presets.map((p) => p.id), ["default:daily"]);
  assert.equal(presets[0]?.model, "claude-opus-5");
  assert.deepEqual(resolveDefaultPresets(new Map()), []);
});

test("model names replace ids in the spec and in filtering", () => {
  const a = preset("a", "Daily", "claude-opus-5");
  const names = { "claude-code::claude-opus-5": "Opus 5" };
  assert.equal(modelSpec(a, names), "Opus 5 · High");
  assert.equal(modelSpec(a), "claude-opus-5 · High");
  assert.equal(modelSpec({ ...a, serviceTier: "fast" }, names), "Opus 5 · High · Fast");
  assert.deepEqual(filterPresets([a], "opus 5", names), [a]);
});

test("model state rejects duplicate preset ids and defaults the service tier", () => {
  const a = { id: "a", name: "A", providerId: "p", model: "m", reasoningLevel: "high" };
  assert.equal(modelStateSchema.safeParse({ presets: [a, a], selection: null }).success, false);
  const parsed = modelStateSchema.parse({ presets: [a], selection: { providerId: "p", model: "m", reasoningLevel: "low" } });
  assert.equal(parsed.presets[0]?.serviceTier, "default");
  assert.equal(parsed.selection?.serviceTier, "default");
});
