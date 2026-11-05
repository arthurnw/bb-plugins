import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveDefaultPresets } from "./default-presets.ts";

test("default presets keep rungs the catalog offers and drop the rest", () => {
  const catalog = new Map([["claude-code", [
    { id: "claude-opus-5", supportedReasoningEfforts: [{ reasoningEffort: "high" }], defaultReasoningEffort: "high" },
  ]]]);
  const presets = resolveDefaultPresets(catalog);
  assert.deepEqual(presets.map((p) => p.id), ["default:daily"]);
  assert.equal(presets[0]?.model, "claude-opus-5");
  assert.deepEqual(resolveDefaultPresets(new Map()), []);
});

