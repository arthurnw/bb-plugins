import {
  experimental_ProviderIcon as ProviderIcon, experimental_ProviderModelPicker as ProviderModelPicker, experimental_useProviders as useProviders,
} from "@get-bb/plugin-sdk/app";
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { filterPresets, findPreset, MAX_PRESETS, modelSpec, providerLabel, sameModel, type ModelPreset, type ModelSelection } from "../selection.ts";
import { botLabel, filterBots } from "../bots.ts";

type Names = Record<string, string>;

type Row = { kind: "starter"; starter: PickerStarter } | { kind: "no-starter" } | { kind: "preset"; preset: ModelPreset } | { kind: "other" } | { kind: "save" };

const FALLBACK: ModelSelection = { providerId: "", model: "", reasoningLevel: "medium", serviceTier: "default" };

/** What the trigger in the composer's action row says. */
export function modelLabel(presets: readonly ModelPreset[], selection: ModelSelection | null, names: Names, starter: Pick<PickerStarter, "emoji" | "name"> | null = null): string {
  const model = !selection ? "Default model" : findPreset(presets, selection)?.name ?? modelSpec(selection, names);
  return starter ? `${botLabel(starter)} · ${model}` : model;
}

/** A Starter as the picker shows it (the Launcher's saved ways to start a thread). */
export interface PickerStarter { id: string; name: string; emoji: string; model: ModelSelection | null }

/**
 * Starters first, then presets, then "Other model…", which embeds bb's own
 * provider/model picker for every specific. A selection that matches no preset
 * can be saved. Picking a model after a Starter keeps the Starter.
 */
export function ModelList({ starters = [], starter = null, onChooseStarter, presets = [], names = {}, selection = null, onChoose, onSavePresets, onClose }: {
  starters?: readonly PickerStarter[];
  starter?: PickerStarter | null;
  onChooseStarter?: (starter: PickerStarter | null) => void;
  /** Omit to hide the Presets section. */
  presets?: ModelPreset[];
  names?: Names;
  selection?: ModelSelection | null;
  /** Called for a preset and for every change made in the embedded picker. */
  onChoose?: (selection: ModelSelection, source: "preset" | "custom") => void;
  /** Omit to hide saving and deleting presets. */
  onSavePresets?: (presets: ModelPreset[]) => Promise<void>;
  onClose: () => void;
}) {
  const { providers } = useProviders();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [naming, setNaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => filterPresets(presets, query, names), [presets, query, names]);
  const starterMatches = useMemo(() => onChooseStarter ? filterBots(starters, query) : [], [starters, query, onChooseStarter]);
  const showNoStarter = starter !== null && onChooseStarter !== undefined && (query === "" || "no starter".includes(query.trim().toLowerCase()));
  const unsaved = onSavePresets !== undefined && selection !== null && findPreset(presets, selection) === undefined && presets.length < MAX_PRESETS;
  const rows: Row[] = [
    ...starterMatches.map((item): Row => ({ kind: "starter", starter: item })),
    ...(showNoStarter ? [{ kind: "no-starter" } as Row] : []),
    ...matches.map((preset): Row => ({ kind: "preset", preset })), { kind: "other" } as Row, ...(unsaved ? [{ kind: "save" } as Row] : []),
  ];

  // Start on the current Starter, else the current preset.
  useEffect(() => {
    const current = findPreset(presets, selection);
    const index = starter ? rows.findIndex((row) => row.kind === "starter" && row.starter.id === starter.id)
      : rows.findIndex((row) => row.kind === "preset" && row.preset === current);
    setActive(Math.max(0, index));
  }, []);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  // bb renders the embedded picker's menu in its own popover (a sheet on
  // phones) outside this list.
  // A host popup that holds this list (the Launcher's composer popup) treats a
  // pointerdown there as outside, closes, and unmounts the picker before the
  // choice applies. While that menu is open, keep its pointerdowns from
  // reaching document listeners; its own clicks still work.
  // The picker also emits a default model when its menu opens without a
  // selection, so a change counts only after a click or key in that menu.
  const touched = useRef(false);
  useEffect(() => {
    const inMenu = (event: Event) => {
      const list = listRef.current;
      const target = event.target instanceof Element ? event.target : null;
      if (!list || !target) return false;
      if (target.closest("[data-other-model]")) touched.current = false;
      if (list.contains(target) || !list.querySelector("[data-other-model] button[aria-expanded='true']")) return false;
      // A popover on wide screens, a bottom sheet on phones; not the sheet holding this list.
      const menu = target.closest("[data-radix-popper-content-wrapper], [data-persistent-drawer-content]");
      return menu !== null && !menu.contains(list);
    };
    const onPointerDown = (event: PointerEvent) => { if (inMenu(event)) { touched.current = true; event.stopPropagation(); } };
    const onKeyDown = (event: Event) => { if (inMenu(event)) touched.current = true; };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => { window.removeEventListener("pointerdown", onPointerDown, true); window.removeEventListener("keydown", onKeyDown, true); };
  }, []);

  // The embedded picker re-emits its current value while it reconciles with the
  // catalog (it omits a service tier that is "default"). Treating those as
  // choices re-seeds the composer, which makes the picker emit again, in a loop.
  // Without a selection it emits a default model on mount and on open, so only
  // changes after the user touches its menu count.
  const onPickerChange = (value: Pick<ModelSelection, "providerId" | "model" | "reasoningLevel"> & { serviceTier?: string }) => {
    if (selection && sameModel(selection, value)) return;
    if (!touched.current) return;
    onChoose?.({ ...value, serviceTier: value.serviceTier ?? "default" }, "custom");
  };

  const activate = (row: Row | undefined) => {
    if (!row) return;
    if (row.kind === "starter") onChooseStarter?.(row.starter);
    else if (row.kind === "no-starter") onChooseStarter?.(null);
    else if (row.kind === "preset") onChoose?.(row.preset, "preset");
    else if (row.kind === "other") listRef.current?.querySelector<HTMLButtonElement>("[data-other-model] button")?.click();
    else setNaming("");
  };

  async function save(presetsNext: ModelPreset[]) {
    setError(null);
    try { await onSavePresets?.(presetsNext); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
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
      if (rows.length > 0) setActive((i) => (i + (down ? 1 : -1) + rows.length) % rows.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      activate(rows[active]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  function renderRow(row: Row, index: number, indented: boolean) {
          const base: CSSProperties = { ...rowStyle, paddingLeft: indented ? 20 : 8, background: index === active ? "var(--accent)" : "transparent" };
          const enter = { onMouseEnter: () => setActive(index) };
          const hover = { ...enter, onMouseDown: (e: { preventDefault(): void }) => e.preventDefault() };
          if (row.kind === "starter") {
            const item = row.starter;
            return (
              <div key={`starter:${item.id}`} role="option" data-index={index} aria-selected={index === active} {...hover}
                onClick={() => onChooseStarter?.(item)} style={base}>
                <span style={{ display: "flex", gap: 8, minWidth: 0, flex: 1, alignItems: "center" }}>
                  <span aria-hidden style={{ width: 18, flex: "none", textAlign: "center" }}>{item.emoji}</span>
                  <span style={ellipsis}>{item.name}</span>
                  <span style={{ ...ellipsis, color: "var(--muted-foreground)" }}>{item.model ? modelSpec(item.model, names) : "Any model"}</span>
                </span>
                {starter?.id === item.id && <span style={{ color: "var(--muted-foreground)" }}>current</span>}
              </div>
            );
          }
          if (row.kind === "no-starter") {
            return (
              <div key="no-starter" role="option" data-index={index} aria-selected={index === active} {...hover}
                onClick={() => onChooseStarter?.(null)} style={base}>
                <span>No starter</span>
                <span style={{ marginLeft: "auto", color: "var(--muted-foreground)" }}>keep the model, drop {botLabel(starter!)}</span>
              </div>
            );
          }
          if (row.kind === "preset") {
            const { preset } = row;
            const current = selection !== null && sameModel(preset, selection);
            return (
              <div key={preset.id} role="option" data-index={index} aria-selected={index === active} {...hover}
                onClick={() => onChoose?.(preset, "preset")} style={base}>
                <span style={{ display: "flex", gap: 8, minWidth: 0, flex: 1, alignItems: "center" }}>
                  <span title={providerLabel(preset.providerId)} style={{ width: 18, height: 18, flex: "none", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                    <ProviderIcon providerKind="agent" provider={providers.find((item) => item.id === preset.providerId) ?? { id: preset.providerId }}
                      aria-label={providerLabel(preset.providerId)} className="size-4" />
                  </span>
                  <span style={ellipsis}>{preset.name}</span>
                  <span style={{ ...ellipsis, color: "var(--muted-foreground)" }}>{modelSpec(preset, names)}</span>
                </span>
                {current && <span style={{ color: "var(--muted-foreground)" }}>current</span>}
                {onSavePresets && <button type="button" aria-label={`Delete preset ${preset.name}`} title="Delete preset"
                  onClick={(e) => { e.stopPropagation(); void save(presets.filter((item) => item.id !== preset.id)); }}
                  style={{ ...deleteStyle, visibility: index === active ? "visible" : "hidden" }}>×</button>}
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
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", minWidth: 280, maxHeight: 360 }}>
      <input
        autoFocus
        value={query}
        placeholder={onChooseStarter && starters.length > 0 ? "Choose a starter, preset, or model…" : "Choose a preset or model…"}
        aria-label="Search starters and model presets"
        onChange={(e) => { setQuery(e.target.value); setActive(0); }}
        onKeyDown={onKeyDown}
        style={{ padding: "8px 12px", border: "none", borderBottom: "1px solid var(--border)", background: "transparent", color: "var(--foreground)", fontSize: 13, outline: "none" }}
      />
      <div ref={listRef} role="listbox" aria-label="Model presets" style={{ overflowY: "auto", padding: 4 }}>
        {rows.map((row, index) => {
          // Starters and presets sit under headers, indented alike; Other model… follows a divider.
          const previous = rows[index - 1]?.kind;
          const section = row.kind === "starter" || row.kind === "no-starter" ? "starters" : row.kind === "preset" ? "presets" : "other";
          const previousSection = previous === undefined ? null : previous === "starter" || previous === "no-starter" ? "starters" : previous === "preset" ? "presets" : "other";
          const lead = section === previousSection ? null
            : section === "starters" ? <div style={sectionHeader}>Starters</div>
            : section === "presets" ? <div style={sectionHeader}>Presets</div>
            : index > 0 ? <div style={divider} /> : null;
          return <Fragment key={`${row.kind}:${row.kind === "starter" ? row.starter.id : row.kind === "preset" ? row.preset.id : index}`}>{lead}{renderRow(row, index, section !== "other")}</Fragment>;
        })}
        {matches.length === 0 && starterMatches.length === 0 && (presets.length > 0 || starters.length > 0) && query !== "" && <div style={emptyStyle}>No matching starters or presets</div>}
        {presets.length === 0 && onSavePresets && <div style={emptyStyle}>No presets yet. Pick a model below, then save it.</div>}
        {error && <div role="alert" style={{ ...emptyStyle, color: "var(--destructive, #e5484d)" }}>{error}</div>}
      </div>
    </div>
  );
}

const rowStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 4, cursor: "pointer", fontSize: 13, color: "var(--foreground)" };
const ellipsis: CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const deleteStyle: CSSProperties = { border: "none", background: "transparent", color: "var(--muted-foreground)", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "0 4px" };
const emptyStyle: CSSProperties = { padding: "6px 8px", fontSize: 12, color: "var(--muted-foreground)" };

const sectionHeader: CSSProperties = { padding: "8px 8px 2px", fontSize: 11, fontWeight: 600, letterSpacing: ".02em", textTransform: "uppercase", color: "var(--muted-foreground)" };
const divider: CSSProperties = { height: 1, background: "var(--border)", margin: "4px 8px" };

/** Trigger that takes the place of the host's model picker button. */
export function ModelTrigger({ label, icon, onClick, disabled }: { label: string; icon?: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={`Model: ${label}`}
      title="Choose bot, model, or preset (Mod+Shift+M)"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      style={{ display: "inline-flex", alignItems: "center", gap: 6, maxWidth: 280, padding: "4px 8px", border: "none", borderRadius: 8, background: "transparent", color: "var(--muted-foreground)", cursor: "pointer", fontSize: 13 }}
    >
      {icon}
      <span style={ellipsis}>{label}</span>
      <span aria-hidden style={{ fontSize: 10, opacity: 0.6 }}>▾</span>
    </button>
  );
}
