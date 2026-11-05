import { experimental_ProviderModelPicker as ProviderModelPicker, experimental_useProviders as useProviders, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type { botsContract } from "./bots-server";
import { useLauncher, useLauncherModelState } from "./launcher-models";
import {
  BOT_ENVIRONMENTS, INSTRUCTIONS_MAX, MAX_BOTS, MEMORY_MAX, NAME_MAX, STARTER_MAX,
  type Bot, type BotDraft, type BotEnvironment, type PermissionMode,
} from "@arthurnw/bb-shared/bots";
import { modelSpec, sameModel, type ModelSelection } from "@arthurnw/bb-shared/selection";
import { useProjectOptions } from "@arthurnw/bb-shared/projects";
import { availableEnvironments } from "@arthurnw/bb-shared/composer";
import { AnimatedAvatar, galleryAvatar, galleryId, GEOMETRIC_AVATARS, SMOOTH_AVATARS, type GalleryAvatar } from "@arthurnw/bb-shared/avatars";
import { avatarFromFile, BotAvatar, useBotState, useBotStates } from "./bot-avatars";

const ENVIRONMENT_LABELS: Record<BotEnvironment, string> = {
  "named-worktree": "Named worktree",
  "existing-branch": "Existing branch / PR",
  checkout: "Project checkout",
};
const PERMISSION_LABELS: Record<PermissionMode, string> = { "accept-edits": "Accept edits", auto: "Auto", full: "Full access" };
const KEEP = "";
// Without Launcher presets, bb's picker starts from the first available provider and reports a real model once loaded.
const startingModel = (providerId: string): ModelSelection => ({ providerId, model: "", reasoningLevel: "medium", serviceTier: "default" });

const errorText = (e: unknown) => e instanceof Error ? e.message : String(e);
const toDraft = ({ name, emoji, instructions, starterPrompt, model, permissionMode, environment, projectId, memoryWrites }: Bot): BotDraft =>
  ({ name, emoji, instructions, starterPrompt, model, permissionMode, environment, projectId, memoryWrites });
const sameDraft = (a: BotDraft, b: BotDraft) => JSON.stringify(a) === JSON.stringify(b);

export function BotSettings() {
  const rpc = useRpc<typeof botsContract>();
  const [bots, setBots] = useState<Bot[] | null>(null);
  const names = useLauncherModelState()?.names ?? {};
  const botStates = useBotStates();
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => rpc.call("listBots", {}).then(({ bots }) => setBots(bots), (e) => setError(errorText(e))), [rpc]);
  useEffect(() => { void load(); }, [load]);
  useRealtime("bots", () => { void load(); });

  async function run(operation: () => Promise<unknown>) {
    setError(null);
    try { await operation(); } catch (e) { setError(errorText(e)); }
    await load();
  }
  const move = (index: number, by: -1 | 1) => run(async () => {
    const ids = bots!.map((bot) => bot.id);
    const [id] = ids.splice(index, 1);
    ids.splice(index + by, 0, id!);
    await rpc.call("reorderBots", { botIds: ids });
  });
  const add = () => run(async () => {
    const taken = new Set(bots!.map((bot) => bot.name.toLowerCase()));
    let n = 1;
    while (taken.has(n === 1 ? "new bot" : `new bot ${n}`)) n++;
    const { bot } = await rpc.call("saveBot", { bot: { name: n === 1 ? "New bot" : `New bot ${n}`, emoji: "", instructions: "", starterPrompt: "",
      model: null, permissionMode: null, environment: null, projectId: null, memoryWrites: true } });
    setEditing(bot.id);
  });

  if (!bots) return <p style={muted}>{error ?? "Loading bots…"}</p>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
      <p style={{ margin: 0, color: "var(--muted-foreground)" }}>
        Mention a bot with @ in a new thread's first message to start the thread as that bot. Forks and side chats of its threads inherit it. {bots.length} of {MAX_BOTS}.
      </p>
      {bots.length === 0 && <p style={{ ...muted, margin: 0 }}>No bots yet.</p>}
      {bots.map((bot, index) => (
        <div key={bot.id} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button type="button" aria-expanded={editing === bot.id} onClick={() => setEditing(editing === bot.id ? null : bot.id)}
              style={{ ...plain, flex: 1, display: "flex", gap: 8, alignItems: "center", minWidth: 0, textAlign: "left" }}>
              <BotAvatar bot={bot} size={20} state={botStates.get(bot.id)} track />
              <span style={{ fontWeight: 500 }}>{bot.name}</span>
              <span style={{ ...muted, ...ellipsis }}>{bot.model ? modelSpec(bot.model, names) : "Any model"}</span>
            </button>
            <button type="button" aria-label={`Move ${bot.name} up`} disabled={index === 0} onClick={() => void move(index, -1)} style={iconButton}>↑</button>
            <button type="button" aria-label={`Move ${bot.name} down`} disabled={index === bots.length - 1} onClick={() => void move(index, 1)} style={iconButton}>↓</button>
            {confirmDelete === bot.id ? (
              <>
                <button type="button" style={iconButton} onClick={() => { setConfirmDelete(null); void run(() => rpc.call("deleteBot", { botId: bot.id })); }}>Delete</button>
                <button type="button" style={iconButton} onClick={() => setConfirmDelete(null)}>Cancel</button>
              </>
            ) : (
              <button type="button" aria-label={`Delete bot ${bot.name}`} onClick={() => setConfirmDelete(bot.id)} style={iconButton}>Delete</button>
            )}
          </div>
          {confirmDelete === bot.id && <p style={{ ...muted, margin: "6px 0 0" }}>Its threads stay; they stop getting the bot's instructions and memory when their session next starts.</p>}
          {editing === bot.id && <BotEditor key={bot.id} bot={bot} onSaved={load} />}
        </div>
      ))}
      <div>
        <button type="button" style={button} disabled={bots.length >= MAX_BOTS} onClick={() => void add()}>Add bot</button>
      </div>
      {error && <p role="alert" style={alert}>{error}</p>}
    </div>
  );
}

function BotEditor({ bot, onSaved }: { bot: Bot; onSaved: () => Promise<unknown> }) {
  const rpc = useRpc<typeof botsContract>();
  const launcherModels = useLauncherModelState();
  const launcherPresent = useLauncher().status === "present";
  const { providers } = useProviders();
  const firstProvider = providers.find((provider) => provider.available)?.id ?? providers[0]?.id ?? "";
  const projects = useProjectOptions();
  const saved = toDraft(bot);
  const [draft, setDraft] = useState<BotDraft>(saved);
  const [template, setTemplate] = useState<ModelSelection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = !sameDraft(draft, saved);
  const set = <K extends keyof BotDraft>(key: K, value: BotDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));

  // A newly chosen model starts from the Launcher's last model or first preset when it is installed.
  useEffect(() => {
    if (launcherModels) setTemplate(launcherModels.selection ?? launcherModels.presets[0] ?? null);
  }, [launcherModels]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const { bot: next } = await rpc.call("saveBot", { botId: bot.id, bot: { ...draft, name: draft.name.trim() } });
      setDraft(toDraft(next));
      await onSaved();
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
      <AvatarField bot={bot} emoji={draft.emoji} name={draft.name} />
      <div style={{ display: "flex", gap: 8 }}>
        <Field label="Emoji" style={{ flex: "0 0 64px" }}>
          <input value={draft.emoji} maxLength={16} onChange={(e) => set("emoji", e.target.value)} style={{ ...input, width: "100%", boxSizing: "border-box", textAlign: "center" }} aria-label="Emoji" />
        </Field>
        <Field label="Name" style={{ flex: 1 }}>
          <input value={draft.name} maxLength={NAME_MAX} onChange={(e) => set("name", e.target.value)} style={{ ...input, width: "100%", boxSizing: "border-box" }} aria-label="Name" />
        </Field>
      </div>
      <Field label="Instructions" hint={`Added to the thread's instructions. Point at skills for method instead of repeating them. ${draft.instructions.length}/${INSTRUCTIONS_MAX}`}>
        <textarea value={draft.instructions} maxLength={INSTRUCTIONS_MAX} rows={6} onChange={(e) => set("instructions", e.target.value)} style={textarea} aria-label="Instructions" />
      </Field>
      <Field label="Starter prompt" hint="Put in an empty composer when you pick the bot, for example /skill:research.">
        <textarea value={draft.starterPrompt} maxLength={STARTER_MAX} rows={2} onChange={(e) => set("starterPrompt", e.target.value)} style={textarea} aria-label="Starter prompt" />
      </Field>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Field label="Model">
          <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select value={draft.model ? "set" : KEEP} style={select} aria-label="Model"
              onChange={(e) => set("model", e.target.value === KEEP ? null : (draft.model ?? template ?? startingModel(firstProvider)))}>
              <option value={KEEP}>Any</option>
              <option value="set">Specific model</option>
            </select>
            {draft.model && (
              <ProviderModelPicker value={draft.model} onChange={(value) => {
                // The picker re-reports its value while it loads; ignore those.
                if (draft.model && sameModel(draft.model, value)) return;
                set("model", { providerId: value.providerId, model: value.model, reasoningLevel: value.reasoningLevel, serviceTier: value.serviceTier ?? "default" });
              }} />
            )}
          </span>
        </Field>
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
            {BOT_ENVIRONMENTS.map((env) => {
              // Worktree environments are the Launcher's. A bot that already uses one keeps it, marked, so saving does not silently change it.
              const available = availableEnvironments(launcherPresent).includes(env);
              return (available || draft.environment === env) && <option key={env} value={env}>{ENVIRONMENT_LABELS[env]}{available ? "" : " (needs Launcher)"}</option>;
            })}
          </select>
        </Field>
        <Field label="Project">
          <select value={draft.projectId ?? KEEP} style={select} aria-label="Project"
            onChange={(e) => set("projectId", e.target.value || null)}>
            <option value={KEEP}>Any</option>
            {draft.projectId && projects && !projects.some((p) => p.id === draft.projectId) && <option value={draft.projectId}>Unknown project</option>}
            {(projects ?? []).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
        </Field>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
          <Switch checked={draft.memoryWrites} onChange={(value) => set("memoryWrites", value)} labelledBy={`memory-writes-${bot.id}`} />
          <span id={`memory-writes-${bot.id}`}>Agents can update memory</span>
        </span>
        <span style={{ ...muted, fontSize: 12 }}>Off keeps the saved memory and still shows it to agents; only new changes are refused.</span>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button type="button" style={button} disabled={!dirty || busy || !draft.name.trim()} onClick={() => void save()}>Save</button>
        <button type="button" style={button} disabled={!dirty || busy} onClick={() => setDraft(saved)}>Revert</button>
        {error && <span role="alert" style={alert}>{error}</span>}
      </div>
      <MemoryEditor botId={bot.id} memory={bot.memory} />
    </div>
  );
}

function AvatarField({ bot, emoji, name }: { bot: Bot; emoji: string; name: string }) {
  const rpc = useRpc<typeof botsContract>();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const picked = galleryId(bot.avatar);
  const state = useBotState(bot.id);
  async function apply(avatar: Promise<string | null>) {
    setBusy(true);
    setError(null);
    try { await rpc.call("setBotAvatar", { botId: bot.id, avatar: await avatar }); }
    catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
      <BotAvatar bot={{ avatar: bot.avatar, emoji, name }} size={40} state={state} track />
      <label style={{ ...button, whiteSpace: "nowrap", opacity: busy ? 0.6 : 1 }}>
        {bot.avatar && !picked ? "Replace image…" : "Upload image…"}
        <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" disabled={busy} style={{ display: "none" }}
          onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void apply(avatarFromFile(file)); }} />
      </label>
      {bot.avatar && <button type="button" style={{ ...button, whiteSpace: "nowrap" }} disabled={busy} onClick={() => void apply(Promise.resolve(null))}>{picked ? "Remove avatar" : "Remove image"}</button>}
      <span style={{ ...muted, fontSize: 12 }}>{error ?? "Uploads are cropped to a square. Without an avatar the emoji shows, then the first letter."}</span>
    </div>
    <AvatarGroup label="Smooth" items={SMOOTH_AVATARS} picked={picked} busy={busy} onPick={(item) => void apply(Promise.resolve(galleryAvatar(item.id)))} />
    <AvatarGroup label="Geometric" items={GEOMETRIC_AVATARS} picked={picked} busy={busy} onPick={(item) => void apply(Promise.resolve(galleryAvatar(item.id)))} />
    </div>
  );
}

function AvatarGroup({ label, items, picked, busy, onPick }: {
  label: string; items: readonly GalleryAvatar[]; picked: string | null; busy: boolean; onPick: (item: GalleryAvatar) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ ...muted, fontSize: 12 }}>{label}</span>
      <div role="group" aria-label={`${label} avatars`} style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {items.map((item) => {
          const current = item.id === picked;
          return (
            <button key={item.id} type="button" title={item.label} aria-label={`Use the ${item.label} avatar`} aria-pressed={current} disabled={busy}
              onClick={() => onPick(item)}
              style={{ ...plain, padding: 4, borderRadius: 8, border: `1px solid ${current ? "var(--ring, var(--primary))" : "transparent"}`, lineHeight: 0 }}
              onMouseEnter={(e) => { if (!current) e.currentTarget.style.borderColor = "var(--border)"; }}
              onMouseLeave={(e) => { if (!current) e.currentTarget.style.borderColor = "transparent"; }}>
              <AnimatedAvatar id={item.id} size={32} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MemoryEditor({ botId, memory }: { botId: string; memory: string }) {
  const rpc = useRpc<typeof botsContract>();
  const [loaded, setLoaded] = useState<{ content: string; sha256: string } | null>(null);
  const [text, setText] = useState(memory);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dirty = loaded !== null && text !== loaded.content;

  const reload = useCallback(() => rpc.call("getBotMemory", { botId }).then((view) => {
    setLoaded(view);
    setText(view.content);
  }, (e) => setError(errorText(e))), [rpc, botId]);
  useEffect(() => { void reload(); }, [reload]);
  // Agents write memory too; pick up their changes unless the user is editing.
  useEffect(() => { if (!dirty && loaded && memory !== loaded.content) void reload(); }, [memory]);

  async function save() {
    if (!loaded) return;
    setBusy(true);
    setError(null);
    try {
      const view = await rpc.call("saveBotMemory", { botId, content: text, expectedSha256: loaded.sha256 });
      setLoaded(view);
      setText(view.content);
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <Field label="Memory" hint={`Facts the bot keeps across threads, one per line. Agents add to it with the bot_memory tool. ${text.length}/${MEMORY_MAX}`}>
        <textarea value={text} maxLength={MEMORY_MAX} rows={5} onChange={(e) => setText(e.target.value)} style={textarea} aria-label="Memory" placeholder="Empty" />
      </Field>
      <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button type="button" style={button} disabled={!dirty || busy} onClick={() => void save()}>Save memory</button>
        <button type="button" style={button} disabled={!dirty || busy} onClick={() => void reload()}>Revert</button>
        {error && <span role="alert" style={alert}>{error}</span>}
      </span>
    </div>
  );
}

function Switch({ checked, onChange, labelledBy }: { checked: boolean; onChange: (value: boolean) => void; labelledBy: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-labelledby={labelledBy} onClick={() => onChange(!checked)}
      style={{ position: "relative", width: 32, height: 18, flex: "none", padding: 0, border: "none", borderRadius: 9, cursor: "pointer",
        background: checked ? "var(--primary, #2563eb)" : "var(--muted, #d4d4d8)", transition: "background .15s" }}>
      <span aria-hidden style={{ position: "absolute", top: 2, left: checked ? 16 : 2, width: 14, height: 14, borderRadius: "50%",
        background: "var(--background, #fff)", boxShadow: "0 1px 2px rgb(0 0 0 / .25)", transition: "left .15s" }} />
    </button>
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
