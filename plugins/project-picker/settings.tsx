import { experimental_ProviderModelPicker as ProviderModelPicker, useRpc } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import type { quickComposeRpcContract } from "./server";
import { MAX_PRESETS, modelSpec, sameModel, type ModelPreset, type ModelSelection, type ModelState } from "./presets";

const button: CSSProperties = { padding: "4px 10px", border: "1px solid var(--border)", borderRadius: 6, background: "transparent", color: "var(--foreground)", cursor: "pointer", fontSize: 13 };
const iconButton: CSSProperties = { ...button, padding: "2px 8px", color: "var(--muted-foreground)" };
const input: CSSProperties = { flex: "1 1 160px", minWidth: 0, padding: "5px 8px", border: "1px solid var(--border)", borderRadius: 6, background: "transparent", color: "var(--foreground)", fontSize: 13 };

export function PresetSettings() {
  const rpc = useRpc<typeof quickComposeRpcContract>();
  const [state, setState] = useState<ModelState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);

  const load = useCallback(() => rpc.call("getModelState", {}).then(setState, (e) => setError(String(e))), [rpc]);
  useEffect(() => { void load(); }, [load]);

  // Updates the list at once and rolls back to the saved list if saving fails.
  async function commit(presets: ModelPreset[]) {
    if (!state) return;
    setState({ ...state, presets });
    setError(null);
    try { setState(await rpc.call("savePresets", { presets })); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); void load(); }
  }
  const update = (id: string, patch: Partial<ModelPreset>) =>
    commit(state!.presets.map((preset) => preset.id === id ? { ...preset, ...patch } : preset));
  const move = (index: number, by: -1 | 1) => {
    const next = [...state!.presets];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item!);
    return commit(next);
  };

  async function restore() {
    setBusy(true);
    setError(null);
    try { setState(await rpc.call("restoreDefaultPresets", {})); setConfirmRestore(false); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  if (!state) return <p style={{ fontSize: 13, color: "var(--muted-foreground)" }}>{error ?? "Loading presets…"}</p>;
  const { presets, names } = state;
  // A new preset starts as a copy of the last used model; change it in its row.
  const template: ModelSelection | undefined = state.selection ?? presets[0];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
      <p style={{ margin: 0, color: "var(--muted-foreground)" }}>
        Shown first in the floating composer's model picker (Mod+Shift+M). {presets.length} of {MAX_PRESETS}.
      </p>
      {presets.length === 0 && <p style={{ margin: 0, color: "var(--muted-foreground)" }}>No presets yet.</p>}
      {presets.map((preset, index) => (
        <div key={preset.id} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <input
            defaultValue={preset.name}
            key={`${preset.id}:${preset.name}`}
            aria-label={`Name of preset ${preset.name}`}
            maxLength={80}
            onBlur={(e) => { const name = e.target.value.trim(); if (name && name !== preset.name) void update(preset.id, { name }); else e.target.value = preset.name; }}
            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
            style={input}
          />
          <span style={{ flex: "0 0 230px", display: "flex", justifyContent: "flex-end" }}>
          <ProviderModelPicker
            value={preset}
            onChange={(value) => {
              // The picker re-reports its own value while it loads; only real changes are saved.
              if (sameModel(preset, value)) return;
              void update(preset.id, { providerId: value.providerId, model: value.model, reasoningLevel: value.reasoningLevel, serviceTier: value.serviceTier ?? "default" });
            }}
          />
          </span>
          <span title={modelSpec(preset, names)} style={{ display: "inline-flex", gap: 4 }}>
            <button type="button" aria-label={`Move ${preset.name} up`} disabled={index === 0} onClick={() => void move(index, -1)} style={iconButton}>↑</button>
            <button type="button" aria-label={`Move ${preset.name} down`} disabled={index === presets.length - 1} onClick={() => void move(index, 1)} style={iconButton}>↓</button>
            <button type="button" aria-label={`Delete preset ${preset.name}`} onClick={() => void commit(presets.filter((item) => item.id !== preset.id))} style={iconButton}>Delete</button>
          </span>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
        <button type="button" style={button} disabled={!template || presets.length >= MAX_PRESETS}
          title={template ? undefined : "Choose a model in the floating composer first"}
          onClick={() => template && void commit([...presets, { ...template, id: crypto.randomUUID(), name: "New preset" }])}>
          Add preset
        </button>
        {confirmRestore ? (
          <>
            <span style={{ color: "var(--muted-foreground)" }}>Replace all presets with the defaults?</span>
            <button type="button" style={button} disabled={busy} onClick={() => void restore()}>Replace</button>
            <button type="button" style={button} disabled={busy} onClick={() => setConfirmRestore(false)}>Cancel</button>
          </>
        ) : (
          <button type="button" style={button} onClick={() => setConfirmRestore(true)}>Restore defaults</button>
        )}
      </div>
      {error && <p role="alert" style={{ margin: 0, color: "var(--destructive, #e5484d)" }}>{error}</p>}
    </div>
  );
}
