// The New bot dialog: bb's new-thread composer for the brief, and a row of
// chips for the bot's project, scope, coordinator and worker models, and avatar.
// Enter creates the bot and opens its coordinator thread.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { experimental_useSidebarThreads as useSidebarThreads, useRpc, type PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import { BotAvatar, checkoutOn, ComposerDialog, handoffPrompt, ModelList, modelLabel, projectShortcut } from "@arthurnw/bb-shared/composer";
import { cycle, ProjectList, useProjectOptions } from "@arthurnw/bb-shared/projects";
import { galleryAvatar, type GalleryId } from "@arthurnw/bb-shared/bots";
import type { ModelSelection } from "@arthurnw/bb-shared/selection";
import type { spawnContract } from "./bots-server";
import { BotIconSync, useBots } from "./bot-avatars";
import { useLauncherModelState } from "./launcher-models";
import { freeAvatars, parseScopeDirs, shuffleAvatar } from "./new-bot-model";

const MAC = /Mac|iPhone|iPad/.test(navigator.platform);
export const NEW_BOT_EVENT = "bb-bots:new-bot";

export interface NewBotRequest {
  projectId: string | null;
  /** Promote to bot: this thread becomes the bot's first worker. */
  promoteThreadId?: string;
}

// Window-local: one dialog session at a time. A closed, unsent session stays
// mounted so its draft and choices survive, unless the next request differs.
type Session = NewBotRequest & { id: number };
let state: { session: Session | null; visible: boolean; focus: number } = { session: null, visible: false, focus: 0 };
let nextId = 1;
const listeners = new Set<() => void>();
const update = (next: Partial<typeof state>) => { state = { ...state, ...next }; listeners.forEach((listener) => listener()); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function openNewBot(request: NewBotRequest) {
  const current = state.session;
  const same = current !== null && (current.promoteThreadId ?? null) === (request.promoteThreadId ?? null);
  update({ session: same ? current : { ...request, id: nextId++ }, visible: true, focus: state.focus + 1 });
}

type Popup = "project" | "scope" | "coordinator" | "worker";

function NewBot({ session, visible, focusRequest }: { session: Session; visible: boolean; focusRequest: number }) {
  const rpc = useRpc<typeof spawnContract>();
  const sidebar = useSidebarThreads();
  const bots = useBots();
  const projects = useProjectOptions();
  const launcher = useLauncherModelState();
  const [projectId, setProjectId] = useState(session.projectId);
  const [scopeText, setScopeText] = useState("");
  const [coordinator, setCoordinator] = useState<ModelSelection | null>(null);
  const [worker, setWorker] = useState<ModelSelection | null>(null);
  const [avatar, setAvatar] = useState<GalleryId | null>(null);
  const [popup, setPopup] = useState<Popup | null>(null);
  const [focus, setFocus] = useState(0);
  const sectionRef = useRef<HTMLElement>(null);
  const seeded = useRef(false);
  const latest = useRef({ projectId, scopeText, coordinator, worker, avatar });
  latest.current = { projectId, scopeText, coordinator, worker, avatar };

  const liveThreadIds = useMemo(() => new Set(sidebar.threads.filter((thread) => thread.archivedAt === null).map((thread) => thread.id)), [sidebar.threads]);
  const free = useMemo(() => freeAvatars(bots ?? [], liveThreadIds), [bots, liveThreadIds]);
  useEffect(() => {
    if (avatar === null && bots !== null && sidebar.status !== "loading") setAvatar(shuffleAvatar(free, null));
  }, [avatar, bots, sidebar.status, free]);
  // Both models start from the Launcher's last selection, when it is installed.
  useEffect(() => {
    if (seeded.current || !launcher) return;
    seeded.current = true;
    const start = launcher.selection ?? launcher.presets[0] ?? null;
    setCoordinator((value) => value ?? start);
    setWorker((value) => value ?? start);
  }, [launcher]);
  // Promote to bot starts in the promoted thread's project.
  useEffect(() => {
    if (!session.promoteThreadId || session.projectId) return;
    const thread = sidebar.threads.find((item) => item.id === session.promoteThreadId);
    if (thread) setProjectId(thread.projectId);
  }, [session, sidebar.threads]);

  const close = () => { setPopup(null); setFocus((n) => n + 1); };
  const toggle = (next: Popup) => setPopup((value) => value === next ? null : next);

  // Mod+Shift+M coordinator model, Mod+Shift+J project picker, Alt+J / Alt+Shift+J next and previous project.
  useEffect(() => {
    if (!visible) { setPopup(null); return; }
    const onKey = (event: KeyboardEvent) => {
      const action = projectShortcut(event, MAC);
      if (action === null || (action !== "model" && action !== "open" && action !== "next" && action !== "previous")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (action === "model") { toggle("coordinator"); return; }
      if (action === "open") { toggle("project"); return; }
      const next = projects && cycle(projects, projectId, action === "next" ? 1 : -1);
      if (next) setProjectId(next.id);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [visible, projects, projectId]);

  const presets = launcher?.presets ?? [];
  const names = launcher?.names ?? {};
  const project = projects?.find((item) => item.id === projectId);
  const scopeDirs = parseScopeDirs(scopeText);
  const face = avatar ? { avatar: galleryAvatar(avatar), name: "", emoji: "" } : null;

  return <ComposerDialog
    visible={visible} label="New bot" sectionRef={sectionRef} onClose={() => update({ visible: false })} popupOpen={popup !== null}
    draftKey={session.promoteThreadId ? `bots-new-bot:${session.promoteThreadId}` : "bots-new-bot"}
    focusRequest={visible ? focusRequest + focus : undefined}
    placeholder="Brief for the new bot: the goal, what done looks like, and any rules"
    ready={bots !== null && projects !== null}
    modelTrigger={null}
    composerProps={{
      defaultProjectId: projectId ?? undefined,
      defaultEnvironment: checkoutOn(null),
      initialPrompt: handoffPrompt(session.promoteThreadId ?? null, ""),
    }}
    startedMessage="Bot created"
    onStarted={() => update({ session: null, visible: false })}
    submit={async (request) => {
      const { projectId: chosen, scopeText: scope, coordinator: model, worker: workerModel, avatar: picked } = latest.current;
      const { threadId } = await rpc.call("createInitiative", {
        request,
        bot: { name: "", emoji: "", instructions: "", starterPrompt: "", model, permissionMode: null, environment: null, projectId: chosen ?? request.projectId,
          avatarCorner: "top-right", scopeDirs: parseScopeDirs(scope), workerModel },
        ...(picked ? { avatar: galleryAvatar(picked) } : {}),
        ...(session.promoteThreadId ? { promoteThreadId: session.promoteThreadId } : {}),
      });
      return { threadId };
    }}
  >
    <div role="toolbar" aria-label="Bot settings" style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
      <Chip label={`Project: ${project?.name ?? "choose"}`} title="Project (Mod+Shift+J)" active={popup === "project"} onClick={() => toggle("project")} />
      <Chip label={scopeDirs.length === 0 ? "Scope: whole project" : `Scope: ${scopeDirs.length === 1 ? scopeDirs[0] : `${scopeDirs.length} directories`}`} active={popup === "scope"} onClick={() => toggle("scope")} />
      <Chip label={`Coordinator: ${modelLabel(presets, coordinator, names)}`} title="Coordinator model (Mod+Shift+M)" active={popup === "coordinator"} onClick={() => toggle("coordinator")} />
      <Chip label={`Workers: ${modelLabel(presets, worker, names)}`} active={popup === "worker"} onClick={() => toggle("worker")} />
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, marginLeft: "auto" }}>
        {face && <BotAvatar bot={face} size={24} track />}
        <button type="button" style={chip} title="Another avatar" aria-label="Shuffle avatar" onMouseDown={(e) => e.preventDefault()}
          onClick={() => setAvatar((current) => shuffleAvatar(free, current))}>Shuffle</button>
      </span>
    </div>
    {popup && <div style={{ marginTop: 8, border: "1px solid var(--border)", borderRadius: 8, background: "var(--popover, var(--background))", overflow: "hidden" }}>
      {popup === "project" && <ProjectList selectedLabel="chosen" selectedId={projectId} onChoose={(option) => { setProjectId(option.id); close(); }} onClose={close} />}
      {popup === "scope" && <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
        <textarea autoFocus value={scopeText} rows={4} aria-label="Scope directories" placeholder={"plugins/bots\npackages/shared"} onChange={(e) => setScopeText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } }}
          style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 12, padding: 6, border: "1px solid var(--border)", borderRadius: 6, background: "transparent", color: "var(--foreground)", resize: "vertical" }} />
        <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>One directory per line, relative to the project. Guidance for the coordinator and workers; not enforced.</span>
      </div>}
      {(popup === "coordinator" || popup === "worker") && <ModelList presets={presets} names={names} selection={popup === "coordinator" ? coordinator : worker}
        onChoose={(value, source) => { (popup === "coordinator" ? setCoordinator : setWorker)(value); if (source === "preset") close(); }} onClose={close} />}
    </div>}
  </ComposerDialog>;
}

function Chip({ label, title, active, onClick }: { label: string; title?: string; active: boolean; onClick: () => void }): ReactNode {
  return <button type="button" title={title ?? label} aria-pressed={active} onMouseDown={(e) => e.preventDefault()} onClick={onClick}
    style={{ ...chip, background: active ? "var(--accent)" : "transparent" }}>{label}</button>;
}

const chip: CSSProperties = { maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", padding: "3px 8px", border: "1px solid var(--border)", borderRadius: 999,
  color: "var(--muted-foreground)", cursor: "pointer", fontSize: 12, background: "transparent" };

function NewBotOverlay() {
  const current = useSyncExternalStore(subscribe, () => state, () => state);
  return <>
    <BotIconSync />
    {current.session && <NewBot key={current.session.id} session={current.session} visible={current.visible} focusRequest={current.focus} />}
  </>;
}

export function registerNewBotDialog(app: PluginAppBuilder) {
  app.slots.experimental_appOverlay({ id: "new-bot", component: NewBotOverlay });
  app.commands.register({ id: "new-bot", title: "Bots: new bot", run: ({ projectId }) => openNewBot({ projectId }) });
  app.slots.experimental_threadAction({
    id: "promote-to-bot", title: "Promote to bot", icon: "Bot", group: "1_open", order: 51,
    item: ({ thread }) => thread.archivedAt !== null ? null : {
      label: "Promote to bot", icon: "Bot",
      run: () => openNewBot({ projectId: thread.projectId, promoteThreadId: thread.id }),
    },
  });
  window.addEventListener(NEW_BOT_EVENT, (event) => openNewBot({ projectId: null, ...(event as CustomEvent<Partial<NewBotRequest>>).detail }));
}
