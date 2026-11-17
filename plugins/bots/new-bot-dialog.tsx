// The New bot dialog: bb's new-thread composer for the brief, project, and
// coordinator model, and a row under it for the worker model and avatar.
// Enter creates the bot and opens its coordinator thread.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { experimental_Icon as Icon, experimental_useSidebarThreads as useSidebarThreads, useRpc, type PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import { BotAvatar, ComposerDialog, handoffPrompt, ModelList, modelLabel, useHostFontSize } from "@arthurnw/bb-shared/composer";
import { useProjectOptions } from "@arthurnw/bb-shared/projects";
import { galleryAvatar, NAME_MAX, type GalleryId } from "@arthurnw/bb-shared/bots";
import { AnimatedAvatar, GEOMETRIC_AVATARS, SMOOTH_AVATARS, type GalleryAvatar } from "@arthurnw/bb-shared/avatars";
import type { ModelSelection } from "@arthurnw/bb-shared/selection";
import type { spawnContract } from "./bots-server";
import { BotIconSync, useBots } from "./bot-avatars";
import { useLauncherModelState } from "./launcher-models";
import { freeAvatars, isWorkerShortcut, shuffleAvatar } from "./new-bot-model";

const MAC = /Mac|iPhone|iPad/.test(navigator.platform);
const WORKER_SHORTCUT = MAC ? "⌘⇧K" : "Ctrl+Shift+K";
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

type Popup = "worker" | "avatar";

function NewBot({ session, visible, focusRequest }: { session: Session; visible: boolean; focusRequest: number }) {
  const rpc = useRpc<typeof spawnContract>();
  const sidebar = useSidebarThreads();
  const bots = useBots();
  const projects = useProjectOptions();
  const launcher = useLauncherModelState();
  const [projectId, setProjectId] = useState(session.projectId);
  // null: the same model as the coordinator, resolved when the bot is created.
  const [worker, setWorker] = useState<ModelSelection | null>(null);
  const [avatar, setAvatar] = useState<GalleryId | null>(null);
  // Empty: the coordinator names the bot.
  const [name, setName] = useState("");
  const nameField = useRef<HTMLInputElement>(null);
  const hostFont = useHostFontSize(nameField);
  const [popup, setPopup] = useState<Popup | null>(null);
  const [focus, setFocus] = useState(0);
  const sectionRef = useRef<HTMLElement>(null);
  const latest = useRef({ worker, avatar, name });
  latest.current = { worker, avatar, name };

  const liveThreadIds = useMemo(() => new Set(sidebar.threads.filter((thread) => thread.archivedAt === null).map((thread) => thread.id)), [sidebar.threads]);
  const free = useMemo(() => freeAvatars(bots ?? [], liveThreadIds), [bots, liveThreadIds]);
  useEffect(() => {
    if (avatar === null && bots !== null && sidebar.status !== "loading") setAvatar(shuffleAvatar(free, null));
  }, [avatar, bots, sidebar.status, free]);
  // Promote to bot starts in the promoted thread's project.
  useEffect(() => {
    if (!session.promoteThreadId || session.projectId) return;
    const thread = sidebar.threads.find((item) => item.id === session.promoteThreadId);
    if (thread) setProjectId(thread.projectId);
  }, [session, sidebar.threads]);

  const close = () => { setPopup(null); setFocus((n) => n + 1); };
  const toggle = (next: Popup) => setPopup((value) => value === next ? null : next);

  useEffect(() => {
    if (!visible) { setPopup(null); return; }
    const onKey = (event: KeyboardEvent) => {
      if (!isWorkerShortcut(event, MAC) || !(event.target instanceof Node) || !sectionRef.current?.contains(event.target)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setPopup((value) => value === "worker" ? null : "worker");
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [visible]);

  const presets = launcher?.presets ?? [];
  const names = launcher?.names ?? {};
  const face = avatar ? { avatar: galleryAvatar(avatar), name: "", emoji: "" } : null;

  return <ComposerDialog
    visible={visible} label="New bot" sectionRef={sectionRef} onClose={() => update({ visible: false })} popupOpen={popup !== null}
    draftKey={session.promoteThreadId ? `bots-new-bot:${session.promoteThreadId}` : "bots-new-bot"}
    focusRequest={visible ? focusRequest + focus : undefined}
    placeholder="Brief for the new bot: the goal, what done looks like, and any rules"
    ready={bots !== null && projects !== null}
    hideEnvironment
    footer={<span role="toolbar" aria-label="Bot settings" style={{ display: "inline-flex", alignItems: "center", gap: 2, minWidth: 0 }}>
      <Control title={`Worker model (${WORKER_SHORTCUT})`} active={popup === "worker"} onClick={() => toggle("worker")}>
        <span style={ellipsis}>Workers: {worker ? modelLabel(presets, worker, names) : "Same as coordinator"}</span>
        <Icon name="ChevronDown" aria-hidden style={{ width: 16, height: 16, flexShrink: 0 }} />
      </Control>
      <Control title="Choose avatar" label="Choose avatar" active={popup === "avatar"} onClick={() => toggle("avatar")} style={{ padding: "0 2px" }}>
        {face ? <BotAvatar bot={face} size={24} track /> : <span style={{ display: "inline-block", width: 24, height: 24 }} />}
      </Control>
      <Control title="Random avatar" label="Random avatar" active={false} onClick={() => setAvatar((current) => shuffleAvatar(free, current))} style={{ padding: "0 6px" }}>
        <Icon name="RotateCcw" aria-hidden style={{ width: 16, height: 16 }} />
      </Control>
      <input ref={nameField} value={name} maxLength={NAME_MAX} aria-label="Bot name" placeholder="Bot name" title="Optional: leave empty and the coordinator names the bot"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          // Enter here would submit the composer's form without its draft.
          if (e.key === "Enter") { e.preventDefault(); setFocus((n) => n + 1); }
          // Keep typing out of the composer, but let app shortcuts through.
          if (!e.metaKey && !e.ctrlKey && !e.altKey) e.stopPropagation();
        }}
        // The Launcher's branch name field, beside it in the regular composer.
        style={{ flex: "0 10 140px", width: 140, minWidth: 80, boxSizing: "border-box", height: 28, marginLeft: 4, padding: "0 8px", border: "1px solid var(--border)", borderRadius: 4,
          background: "transparent", color: "var(--foreground)", font: "inherit", fontSize: hostFont }} />
    </span>}
    composerProps={{
      ...(projectId ? { defaultProjectId: projectId } : {}),
      initialPrompt: handoffPrompt(session.promoteThreadId ?? null, ""),
    }}
    startedMessage="Bot created"
    onStarted={() => update({ session: null, visible: false })}
    submit={async (request) => {
      const { worker: workerModel, avatar: picked, name: chosenName } = latest.current;
      const { threadId } = await rpc.call("createInitiative", {
        request,
        bot: { name: chosenName.trim(), emoji: "", instructions: "", starterPrompt: "", model: null, permissionMode: null, environment: null, projectId: null,
          avatarCorner: "top-right", workerModel },
        ...(picked ? { avatar: galleryAvatar(picked) } : {}),
        ...(session.promoteThreadId ? { promoteThreadId: session.promoteThreadId } : {}),
      });
      return { threadId };
    }}
  >
    {popup && <div style={{ marginTop: 4, border: "1px solid var(--border)", borderRadius: 8, background: "var(--popover, var(--background))", overflow: "hidden" }}
      onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } }}>
      {popup === "worker" && <>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { setWorker(null); close(); }}
          style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", border: "none", borderBottom: "1px solid var(--border)", cursor: "pointer", fontSize: 13,
            background: worker === null ? "var(--accent)" : "transparent", color: "var(--foreground)" }}>
          Same as coordinator
        </button>
        <ModelList presets={presets} names={names} selection={worker} onChoose={(value, source) => { setWorker(value); if (source === "preset") close(); }} onClose={close} />
      </>}
      {popup === "avatar" && <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
        <AvatarGrid label="Smooth" items={SMOOTH_AVATARS} picked={avatar} free={free} onPick={(id) => { setAvatar(id); close(); }} />
        <AvatarGrid label="Geometric" items={GEOMETRIC_AVATARS} picked={avatar} free={free} onPick={(id) => { setAvatar(id); close(); }} />
      </div>}
    </div>}
  </ComposerDialog>;
}

/** A borderless button in the style of the composer's own pickers. */
function Control({ title, label, active, onClick, style, children }: { title: string; label?: string; active: boolean; onClick: () => void; style?: CSSProperties; children: ReactNode }) {
  const [hover, setHover] = useState(false);
  return <button type="button" title={title} aria-label={label} aria-pressed={active} onMouseDown={(e) => e.preventDefault()} onClick={onClick}
    onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
    style={{ display: "inline-flex", alignItems: "center", gap: 4, minWidth: 0, maxWidth: 280, height: 32, padding: "0 4px", border: "none", borderRadius: 6, lineHeight: "15px", fontFamily: "inherit",
      background: active || hover ? "var(--accent)" : "transparent", color: "var(--muted-foreground)", cursor: "pointer", fontSize: 12, fontWeight: 500, ...style }}>
    {children}
  </button>;
}

const ellipsis: CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

/** Avatars another active bot uses stay pickable but dimmed. */
function AvatarGrid({ label, items, picked, free, onPick }: { label: string; items: readonly GalleryAvatar[]; picked: GalleryId | null; free: readonly GalleryId[]; onPick: (id: GalleryId) => void }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
    <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>{label}</span>
    <div role="group" aria-label={`${label} avatars`} style={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
      {items.map((item) => {
        const current = item.id === picked;
        const used = !free.includes(item.id);
        return <button key={item.id} type="button" title={used ? `${item.label} (used by another bot)` : item.label} aria-label={`Use the ${item.label} avatar`} aria-pressed={current}
          onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(item.id)}
          style={{ padding: 3, borderRadius: 8, lineHeight: 0, cursor: "pointer", background: "transparent", opacity: used && !current ? 0.4 : 1,
            border: `1px solid ${current ? "var(--ring, var(--primary))" : "transparent"}` }}>
          <AnimatedAvatar id={item.id} size={28} />
        </button>;
      })}
    </div>
  </div>;
}

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
