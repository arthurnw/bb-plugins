import { experimental_ProviderModelPicker as ProviderModelPicker } from "@get-bb/plugin-sdk/app";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { filterPresets, findPreset, MAX_PRESETS, modelSpec, sameModel, type ModelPreset, type ModelSelection } from "./presets.ts";

type Names = Record<string, string>;

type Row = { kind: "preset"; preset: ModelPreset } | { kind: "other" } | { kind: "save" };

const FALLBACK: ModelSelection = { providerId: "", model: "", reasoningLevel: "medium", serviceTier: "default" };

/** What the trigger in the composer's action row says. */
export function modelLabel(presets: readonly ModelPreset[], selection: ModelSelection | null, names: Names): string {
  if (!selection) return "Default model";
  return findPreset(presets, selection)?.name ?? modelSpec(selection, names);
}

/**
 * Presets first, then "Other model…", which embeds bb's own provider/model
 * picker for every specific. A selection that matches no preset can be saved.
 */
export function ModelList({ presets, names, selection, onChoose, onSavePresets, onClose }: {
  presets: ModelPreset[];
  names: Names;
  selection: ModelSelection | null;
  /** Called for a preset and for every change made in the embedded picker. */
  onChoose: (selection: ModelSelection, source: "preset" | "custom") => void;
  onSavePresets: (presets: ModelPreset[]) => Promise<void>;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [naming, setNaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => filterPresets(presets, query, names), [presets, query, names]);
  const unsaved = selection !== null && findPreset(presets, selection) === undefined && presets.length < MAX_PRESETS;
  const rows: Row[] = [...matches.map((preset): Row => ({ kind: "preset", preset })), { kind: "other" }, ...(unsaved ? [{ kind: "save" } as Row] : [])];

  // Start on the current preset.
  useEffect(() => {
    const current = findPreset(presets, selection);
    setActive(Math.max(0, matches.findIndex((preset) => preset === current)));
  }, []);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  // The embedded picker re-emits its current value while it reconciles with the
  // catalog (it omits a service tier that is "default"). Treating those as
  // choices re-seeds the composer, which makes the picker emit again, in a loop.
  const onPickerChange = (value: Pick<ModelSelection, "providerId" | "model" | "reasoningLevel"> & { serviceTier?: string }) => {
    if (selection && sameModel(selection, value)) return;
    onChoose({ ...value, serviceTier: value.serviceTier ?? "default" }, "custom");
  };

  const activate = (row: Row | undefined) => {
    if (!row) return;
    if (row.kind === "preset") onChoose(row.preset, "preset");
    else if (row.kind === "other") listRef.current?.querySelector<HTMLButtonElement>("[data-other-model] button")?.click();
    else setNaming("");
  };

  async function save(presetsNext: ModelPreset[]) {
    setError(null);
    try { await onSavePresets(presetsNext); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  const saveCurrent = (name: string) => {
    if (!selection) return;
    const preset: ModelPreset = { ...selection, id: crypto.randomUUID(), name: (name.trim() || modelSpec(selection, names)).slice(0, 80) };
    setNaming(null);
    void save([...presets, preset]);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const down = event.key === "ArrowDown" || (event.ctrlKey && (event.key === "n" || event.key === "j"));
    const up = event.key === "ArrowUp" || (event.ctrlKey && (event.key === "p" || event.key === "k"));
    if (down || up) {
      event.preventDefault();
      setActive((i) => (i + (down ? 1 : -1) + rows.length) % rows.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      activate(rows[active]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", minWidth: 280, maxHeight: 360 }}>
      <input
        autoFocus
        value={query}
        placeholder="Choose a preset or model…"
        aria-label="Search model presets"
        onChange={(e) => { setQuery(e.target.value); setActive(0); }}
        onKeyDown={onKeyDown}
        style={{ padding: "8px 12px", border: "none", borderBottom: "1px solid var(--border)", background: "transparent", color: "var(--foreground)", fontSize: 13, outline: "none" }}
      />
      <div ref={listRef} role="listbox" aria-label="Model presets" style={{ overflowY: "auto", padding: 4 }}>
        {rows.map((row, index) => {
          const base: CSSProperties = { ...rowStyle, background: index === active ? "var(--accent)" : "transparent" };
          const enter = { onMouseEnter: () => setActive(index) };
          const hover = { ...enter, onMouseDown: (e: { preventDefault(): void }) => e.preventDefault() };
          if (row.kind === "preset") {
            const { preset } = row;
            const current = selection !== null && sameModel(preset, selection);
            return (
              <div key={preset.id} role="option" data-index={index} aria-selected={index === active} {...hover}
                onClick={() => onChoose(preset, "preset")} style={base}>
                <span style={{ display: "flex", gap: 8, minWidth: 0, flex: 1 }}>
                  <span style={ellipsis}>{preset.name}</span>
                  <span style={{ ...ellipsis, color: "var(--muted-foreground)" }}>{modelSpec(preset, names)}</span>
                </span>
                {current && <span style={{ color: "var(--muted-foreground)" }}>current</span>}
                <button type="button" aria-label={`Delete preset ${preset.name}`} title="Delete preset"
                  onClick={(e) => { e.stopPropagation(); void save(presets.filter((item) => item.id !== preset.id)); }}
                  style={{ ...deleteStyle, visibility: index === active ? "visible" : "hidden" }}>×</button>
              </div>
            );
          }
          if (row.kind === "other") {
            return (
              <div key="other" role="option" data-index={index} aria-selected={index === active} {...enter} style={base}>
                <span>Other model…</span>
                <span data-other-model="" style={{ marginLeft: "auto" }}>
                  <ProviderModelPicker value={selection ?? FALLBACK} onChange={onPickerChange} align="end" />
                </span>
              </div>
            );
          }
          return naming === null ? (
            <div key="save" role="option" data-index={index} aria-selected={index === active} {...hover} onClick={() => setNaming("")} style={base}>
              <span>Save current as preset…</span>
              <span style={{ marginLeft: "auto", color: "var(--muted-foreground)" }}>{selection && modelSpec(selection, names)}</span>
            </div>
          ) : (
            <div key="save" style={{ padding: "4px 8px" }}>
              <input
                autoFocus
                value={naming}
                maxLength={80}
                placeholder={selection ? modelSpec(selection, names) : "Preset name"}
                aria-label="Preset name"
                onChange={(e) => setNaming(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); saveCurrent(naming); }
                  else if (e.key === "Escape") { e.preventDefault(); setNaming(null); }
                }}
                style={{ width: "100%", boxSizing: "border-box", padding: "6px 8px", border: "1px solid var(--border)", borderRadius: 4, background: "transparent", color: "var(--foreground)", fontSize: 13, outline: "none" }}
              />
            </div>
          );
        })}
        {matches.length === 0 && presets.length > 0 && query !== "" && <div style={emptyStyle}>No matching presets</div>}
        {presets.length === 0 && <div style={emptyStyle}>No presets yet. Pick a model below, then save it.</div>}
        {error && <div role="alert" style={{ ...emptyStyle, color: "var(--destructive, #e5484d)" }}>{error}</div>}
      </div>
    </div>
  );
}

const rowStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 4, cursor: "pointer", fontSize: 13, color: "var(--foreground)" };
const ellipsis: CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const deleteStyle: CSSProperties = { border: "none", background: "transparent", color: "var(--muted-foreground)", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "0 4px" };
const emptyStyle: CSSProperties = { padding: "6px 8px", fontSize: 12, color: "var(--muted-foreground)" };

/** Trigger that takes the place of the host's model picker button. */
export function ModelTrigger({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={`Model: ${label}`}
      title="Choose model or preset (Mod+Shift+M)"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      style={{ display: "inline-flex", alignItems: "center", gap: 6, maxWidth: 280, padding: "4px 8px", border: "none", borderRadius: 8, background: "transparent", color: "var(--muted-foreground)", cursor: "pointer", fontSize: 13 }}
    >
      <span style={ellipsis}>{label}</span>
      <span aria-hidden style={{ fontSize: 10, opacity: 0.6 }}>▾</span>
    </button>
  );
}
