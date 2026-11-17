// Settings → Starters: the saved ways to start a thread that the model picker lists first.
import { experimental_ProviderModelPicker as ProviderModelPicker, experimental_useProviders as useProviders, useRpc } from "@get-bb/plugin-sdk/app";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { BOT_ENVIRONMENTS, type BotEnvironment, type PermissionMode } from "@arthurnw/bb-shared/bots";
import { modelSpec, sameModel, type ModelSelection, type ModelState } from "@arthurnw/bb-shared/selection";
import { useProjectOptions } from "@arthurnw/bb-shared/projects";
import type { quickComposeRpcContract } from "./server";
import { publishStarters, StartersSync, useStarters } from "./starters-client";
import { emptyStarter, STARTER_NAME_MAX, STARTER_TEXT_MAX, STARTERS_MAX, type Starter, type StarterDraft } from "./starters";

const ENVIRONMENT_LABELS: Record<BotEnvironment, string> = {
  "named-worktree": "Named worktree",
  "existing-branch": "Existing branch / PR",
  checkout: "Project checkout",
};
const PERMISSION_LABELS: Record<PermissionMode, string> = { "accept-edits": "Accept edits", auto: "Auto", full: "Full access" };
const KEEP = "";
const startingModel = (providerId: string): ModelSelection => ({ providerId, model: "", reasoningLevel: "medium", serviceTier: "default" });
const errorText = (e: unknown) => e instanceof Error ? e.message : String(e);
const draftOf = ({ id: _id, importedFrom: _from, ...draft }: Starter): StarterDraft => draft;

export function StarterSettings() {
  const rpc = useRpc<typeof quickComposeRpcContract>();
  const starters = useStarters();
  const [models, setModels] = useState<ModelState | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { rpc.call("getModelState", {}).then(setModels, () => {}); }, [rpc]);

  async function save(next: Starter[]) {
    setError(null);
    try { publishStarters((await rpc.call("saveStarters", { starters: next })).starters); return true; }
    catch (e) { setError(errorText(e)); return false; }
  }
  if (!starters) return <><StartersSync /><p style={muted}>{error ?? "Loading starters…"}</p></>;
  const move = (index: number, by: -1 | 1) => {
    const next = [...starters];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item!);
    void save(next);
  };
  const add = () => {
    const taken = new Set(starters.map((item) => item.name.toLowerCase()));
    let n = 1;
    while (taken.has(n === 1 ? "new starter" : `new starter ${n}`)) n++;
    const starter: Starter = { ...emptyStarter(n === 1 ? "New starter" : `New starter ${n}`), id: crypto.randomUUID(), importedFrom: null };
    void save([...starters, starter]).then((ok) => { if (ok) setEditing(starter.id); });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
      <StartersSync />
      <p style={{ margin: 0, color: "var(--muted-foreground)" }}>
        Shown first in the model picker. Picking one sets the composer's model, project, environment, and permissions, fills an empty draft with its starter prompt,
        and adds its instructions to that thread only. {starters.length} of {STARTERS_MAX}.
      </p>
      {starters.length === 0 && <p style={{ ...muted, margin: 0 }}>No starters yet.</p>}
      {starters.map((starter, index) => (
        <div key={starter.id} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button type="button" aria-expanded={editing === starter.id} onClick={() => setEditing(editing === starter.id ? null : starter.id)}
              style={{ ...plain, flex: 1, display: "flex", gap: 8, alignItems: "center", minWidth: 0, textAlign: "left" }}>
              <span aria-hidden style={{ width: 18, textAlign: "center" }}>{starter.emoji}</span>
              <span style={{ fontWeight: 500 }}>{starter.name}</span>
              <span style={{ ...muted, ...ellipsis }}>{starter.model ? modelSpec(starter.model, models?.names ?? {}) : "Any model"}</span>
            </button>
            <button type="button" aria-label={`Move ${starter.name} up`} disabled={index === 0} onClick={() => move(index, -1)} style={iconButton}>↑</button>
            <button type="button" aria-label={`Move ${starter.name} down`} disabled={index === starters.length - 1} onClick={() => move(index, 1)} style={iconButton}>↓</button>
            {confirmDelete === starter.id ? (
              <>
                <button type="button" style={iconButton} onClick={() => { setConfirmDelete(null); void save(starters.filter((item) => item.id !== starter.id)); }}>Delete</button>
                <button type="button" style={iconButton} onClick={() => setConfirmDelete(null)}>Cancel</button>
              </>
            ) : (
              <button type="button" aria-label={`Delete starter ${starter.name}`} onClick={() => setConfirmDelete(starter.id)} style={iconButton}>Delete</button>
            )}
          </div>
          {confirmDelete === starter.id && <p style={{ ...muted, margin: "6px 0 0" }}>Threads started with it stop getting its instructions when their session next starts.</p>}
          {editing === starter.id && <StarterEditor key={starter.id} starter={starter} template={models?.selection ?? models?.presets[0] ?? null}
            onSave={(draft) => save(starters.map((item) => item.id === starter.id ? { ...item, ...draft, name: draft.name.trim() } : item))} />}
        </div>
      ))}
      <div>
        <button type="button" style={button} disabled={starters.length >= STARTERS_MAX} onClick={add}>Add starter</button>
      </div>
      {error && <p role="alert" style={alert}>{error}</p>}
    </div>
  );
}

function StarterEditor({ starter, template, onSave }: { starter: Starter; template: ModelSelection | null; onSave: (draft: StarterDraft) => Promise<boolean> }) {
  const { providers } = useProviders();
  const firstProvider = providers.find((provider) => provider.available)?.id ?? providers[0]?.id ?? "";
  const projects = useProjectOptions();
  const saved = draftOf(starter);
  const [draft, setDraft] = useState<StarterDraft>(saved);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const set = <K extends keyof StarterDraft>(key: K, value: StarterDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const save = async () => { setBusy(true); try { await onSave(draft); } finally { setBusy(false); } };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <Field label="Emoji" style={{ flex: "0 0 64px" }}>
          <input value={draft.emoji} maxLength={16} onChange={(e) => set("emoji", e.target.value)} style={{ ...input, width: "100%", boxSizing: "border-box", textAlign: "center" }} aria-label="Emoji" />
        </Field>
        <Field label="Name" style={{ flex: 1 }}>
          <input value={draft.name} maxLength={STARTER_NAME_MAX} onChange={(e) => set("name", e.target.value)} style={{ ...input, width: "100%", boxSizing: "border-box" }} aria-label="Name" />
        </Field>
      </div>
      <Field label="Instructions" hint={`Added to the thread's instructions. Point at skills for method instead of repeating them. ${draft.instructions.length}/${STARTER_TEXT_MAX}`}>
        <textarea value={draft.instructions} maxLength={STARTER_TEXT_MAX} rows={6} onChange={(e) => set("instructions", e.target.value)} style={textarea} aria-label="Instructions" />
      </Field>
      <Field label="Starter prompt" hint="Put in an empty composer when you pick the starter, for example /skill:research.">
        <textarea value={draft.starterPrompt} maxLength={STARTER_TEXT_MAX} rows={2} onChange={(e) => set("starterPrompt", e.target.value)} style={textarea} aria-label="Starter prompt" />
      </Field>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <ModelField value={draft.model} template={template ?? startingModel(firstProvider)} onChange={(value) => set("model", value)} />
        <Field label="Permissions">
          <select value={draft.permissionMode ?? KEEP} style={select} aria-label="Permissions"
            onChange={(e) => set("permissionMode", (e.target.value || null) as PermissionMode | null)}>
            <option value={KEEP}>Any</option>
            {(Object.keys(PERMISSION_LABELS) as PermissionMode[]).map((mode) => <option key={mode} value={mode}>{PERMISSION_LABELS[mode]}</option>)}
          </select>
        </Field>
        <Field label="Environment">
          <select value={draft.environment ?? KEEP} style={select} aria-label="Environment"
            onChange={(e) => set("environment", (e.target.value || null) as BotEnvironment | null)}>
            <option value={KEEP}>Any</option>
            {BOT_ENVIRONMENTS.map((env) => <option key={env} value={env}>{ENVIRONMENT_LABELS[env]}</option>)}
          </select>
        </Field>
        <Field label="Project">
          <select value={draft.projectId ?? KEEP} style={select} aria-label="Project" onChange={(e) => set("projectId", e.target.value || null)}>
            <option value={KEEP}>Any</option>
            {draft.projectId && projects && !projects.some((p) => p.id === draft.projectId) && <option value={draft.projectId}>Unknown project</option>}
            {(projects ?? []).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
        </Field>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button type="button" style={button} disabled={!dirty || busy || !draft.name.trim()} onClick={() => void save()}>Save</button>
        <button type="button" style={button} disabled={!dirty || busy} onClick={() => setDraft(saved)}>Revert</button>
      </div>
    </div>
  );
}

function ModelField({ value, template, onChange }: { value: ModelSelection | null; template: ModelSelection; onChange: (value: ModelSelection | null) => void }) {
  return (
    <Field label="Model">
      <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <select value={value ? "set" : KEEP} style={select} aria-label="Model" onChange={(e) => onChange(e.target.value === KEEP ? null : (value ?? template))}>
          <option value={KEEP}>Any</option>
          <option value="set">Specific model</option>
        </select>
        {value && (
          <ProviderModelPicker value={value} onChange={(next) => {
            // The picker re-reports its value while it loads; ignore those.
            if (sameModel(value, next)) return;
            onChange({ providerId: next.providerId, model: next.model, reasoningLevel: next.reasoningLevel, serviceTier: next.serviceTier ?? "default" });
          }} />
        )}
      </span>
    </Field>
  );
}

function Field({ label, hint, style, children }: { label: string; hint?: string; style?: CSSProperties; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, ...style }}>
      <span style={{ fontSize: 12, fontWeight: 500 }}>{label}</span>
      {children}
      {hint && <span style={{ ...muted, fontSize: 12 }}>{hint}</span>}
    </div>
  );
}

const muted: CSSProperties = { color: "var(--muted-foreground)" };
const alert: CSSProperties = { margin: 0, color: "var(--destructive, #e5484d)" };
const ellipsis: CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const plain: CSSProperties = { border: "none", background: "transparent", color: "var(--foreground)", cursor: "pointer", padding: 0, fontSize: 13 };
const button: CSSProperties = { padding: "4px 10px", border: "1px solid var(--border)", borderRadius: 6, background: "transparent", color: "var(--foreground)", cursor: "pointer", fontSize: 13 };
const iconButton: CSSProperties = { ...button, padding: "2px 8px", color: "var(--muted-foreground)" };
const input: CSSProperties = { minWidth: 0, padding: "5px 8px", border: "1px solid var(--border)", borderRadius: 6, background: "transparent", color: "var(--foreground)", fontSize: 13 };
const select: CSSProperties = { ...input, paddingRight: 4 };
const textarea: CSSProperties = { ...input, resize: "vertical", fontFamily: "inherit", lineHeight: 1.4 };
