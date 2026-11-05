// Bots' own composer dialog for a new thread or handoff as a bot. The Launcher
// handles these requests first when it is installed; this answers when it is not.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { experimental_useSidebarThreads as useSidebarThreads, useRpc, type PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import { onBotsHandoff, onBotsNewThread } from "@arthurnw/bb-shared/events";
import {
  BotAvatar, ComposerDialog, environmentFor, handoffPrompt, hasDraft, ModelList, ModelTrigger, projectShortcut, reuseOrCheckout,
} from "@arthurnw/bb-shared/composer";
import { cycle, ProjectList, useProjectOptions } from "@arthurnw/bb-shared/projects";
import { botLabel, type Bot, type BotEnvironment, type PermissionMode } from "@arthurnw/bb-shared/bots";
import type { ModelSelection } from "@arthurnw/bb-shared/selection";
import type { botsContract, spawnContract } from "./bots-server";
import { BotIconSync, useBots } from "./bot-avatars";
import { dialog, subscribeDialog, type DialogSession } from "./dialog-store";
import { useLauncher } from "./launcher-models";

const MAC = /Mac|iPhone|iPad/.test(navigator.platform);

function Session({ session, visible, focusRequest }: { session: DialogSession; visible: boolean; focusRequest: number }) {
  const rpc = useRpc<typeof botsContract>();
  const spawnRpc = useRpc<typeof spawnContract>();
  const sidebar = useSidebarThreads();
  const bots = useBots();
  const launcher = useLauncher().status === "present";
  const projects = useProjectOptions();
  const [source, setSource] = useState<{ projectId: string | null; environmentId: string | null }>();
  const [projectId, setProjectId] = useState(session.projectId);
  const [bot, setBot] = useState<Bot | null>(null);
  const [inheritedBot, setInheritedBot] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [model, setModel] = useState<ModelSelection | null>(null);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>();
  const [environment, setEnvironment] = useState<BotEnvironment | null>(null);
  const [starter, setStarter] = useState("");
  const [popup, setPopup] = useState<"bot" | "project" | null>(null);
  const [focus, setFocus] = useState(0);
  const sectionRef = useRef<HTMLElement>(null);
  const chosenRef = useRef(false);
  // Submit reads the latest choice, not the render it was created in.
  const latest = useRef({ bot, inheritedBot });
  latest.current = { bot, inheritedBot };
  const handoff = session.kind === "handoff";
  const draftKey = handoff && session.threadId ? `bots-handoff:${session.threadId}` : "bots-compose";

  useEffect(() => {
    if (source || (handoff && sidebar.status === "loading")) return;
    const thread = handoff ? sidebar.threads.find((t) => t.id === session.threadId) : undefined;
    const resolved = { projectId: thread?.projectId ?? session.projectId, environmentId: thread?.environment?.id ?? null };
    setSource(resolved);
    setProjectId(resolved.projectId);
  }, [source, handoff, sidebar, session]);

  useEffect(() => {
    if (!handoff) return registerNewThreadDraftCheck(() => hasDraft(sectionRef.current, draftKey));
  }, [handoff, draftKey]);

  // Applies the bot's saved fields in one re-seed; fields it leaves unset keep
  // their value. Before the composer mounts its draft is empty by definition.
  function applyBot(next: Bot, beforeMount = false) {
    setBot(next);
    if (next.model) setModel(next.model);
    if (next.permissionMode) setPermissionMode(next.permissionMode);
    if (next.environment) setEnvironment(next.environment);
    if (next.projectId) setProjectId(next.projectId);
    if (next.starterPrompt && (beforeMount || !hasDraft(sectionRef.current, draftKey))) setStarter(next.starterPrompt);
  }
  // A handoff starts on its source thread's bot, which the new thread would inherit anyway.
  useEffect(() => {
    if (bots === null || loaded || chosenRef.current) return;
    (handoff ? rpc.call("threadBots", {}) : Promise.resolve({ threads: {} as Record<string, string> })).then(
      ({ threads }) => {
        if (chosenRef.current) { setLoaded(true); return; }
        const inherited = session.threadId ? threads[session.threadId] ?? null : null;
        setInheritedBot(inherited);
        const requested = session.botId === undefined ? undefined : bots.find((item) => item.id === session.botId) ?? null;
        if (requested) applyBot(requested, true);
        else setBot(requested === null ? null : bots.find((item) => item.id === inherited) ?? null);
        setLoaded(true);
      },
      () => setLoaded(true));
  }, [bots, loaded, handoff, rpc, session.threadId, session.botId]);

  const chooseBot = (next: Bot | null) => {
    chosenRef.current = true;
    if (next) applyBot(next); else setBot(null);
    setPopup(null);
    setFocus((n) => n + 1);
  };
  const chooseProject = (id: string) => { setProjectId(id); setPopup(null); setFocus((n) => n + 1); };

  // Mod+Shift+M bot picker, Mod+Shift+J project picker, Alt+J / Alt+Shift+J next and previous project.
  useEffect(() => {
    if (!visible) { setPopup(null); return; }
    const onKey = (event: KeyboardEvent) => {
      const action = projectShortcut(event, MAC);
      if (action === null || (action !== "model" && action !== "open" && action !== "next" && action !== "previous")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (action === "model") { setPopup((value) => value === "bot" ? null : "bot"); return; }
      if (action === "open") { setPopup((value) => value === "project" ? null : "project"); return; }
      const next = projects && cycle(projects, projectId, action === "next" ? 1 : -1);
      if (next) chooseProject(next.id);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [visible, projects, projectId]);

  const hostId = session.hostId;
  return <ComposerDialog
    visible={visible} label={handoff ? "Bots handoff" : "Bots new thread"} sectionRef={sectionRef} onClose={() => dialog.close()} popupOpen={popup !== null}
    draftKey={draftKey} focusRequest={visible ? focusRequest + focus : undefined}
    placeholder={handoff ? "Hand off this thread" : "Start a new thread"}
    ready={!!source && loaded && bots !== null}
    composerProps={source ? {
      defaultProviderId: model?.providerId,
      defaultModel: model?.model,
      defaultReasoningLevel: model?.reasoningLevel,
      defaultServiceTier: model?.serviceTier,
      defaultPermissionMode: permissionMode,
      defaultProjectId: projectId ?? undefined,
      // Named worktrees and existing branches belong to the Launcher; without it only the project checkout applies.
      defaultEnvironment: environmentFor(environment, hostId, launcher) ?? reuseOrCheckout(projectId, source, hostId),
      initialPrompt: handoffPrompt(handoff ? session.threadId : null, starter),
    } : {}}
    chip={<ModelTrigger icon={bot ? <BotAvatar bot={bot} size={16} /> : undefined} label={bot ? botLabel({ ...bot, emoji: "" }) : "Bot"} onClick={() => setPopup((value) => value === "bot" ? null : "bot")} />}
    onStarted={() => dialog.finish(session.kind)}
    submit={(request) => spawnRpc.call("createThread", { request, ...(session.placement ? { placement: session.placement } : {}),
      ...(latest.current.bot ? { botId: latest.current.bot.id } : latest.current.inheritedBot !== null ? { botId: null } : {}) })}
  >
    {popup && <div style={{ marginTop: 8, border: "1px solid var(--border)", borderRadius: 8, background: "var(--popover, var(--background))", overflow: "hidden" }}>
      {popup === "project"
        ? <ProjectList selectedLabel="last chosen here" selectedId={projectId} onChoose={(option) => chooseProject(option.id)} onClose={() => { setPopup(null); setFocus((n) => n + 1); }} />
        : <ModelList hideModels bots={bots ? [...bots] : []} bot={bot} onChooseBot={chooseBot} onClose={() => { setPopup(null); setFocus((n) => n + 1); }} />}
    </div>}
  </ComposerDialog>;
}

const registerNewThreadDraftCheck = (check: () => boolean) => dialog.registerDraftCheck(check);

function BotsDialog() {
  const state = useSyncExternalStore(subscribeDialog, dialog.getState, dialog.getState);
  return <>
    <BotIconSync />
    {(["new-thread", "handoff"] as const).map((kind) => {
      const session = state["sessions"][kind];
      return session && <Session key={session.id} session={session} visible={state.active === kind} focusRequest={state.focusRequest} />;
    })}
  </>;
}

export function registerFallbackDialog(app: PluginAppBuilder) {
  app.slots.experimental_appOverlay({ id: "dialog", component: BotsDialog });
  // A plain "+" with no bot is left unhandled, so the sender opens bb's own New thread page.
  onBotsNewThread((detail) => {
    if (typeof detail?.botId !== "string") return false;
    dialog.open("new-thread", { projectId: detail.projectId ?? null, threadId: null, placement: detail.placement ?? null, hostId: detail.hostId ?? null, botId: detail.botId });
  });
  onBotsHandoff((detail) => {
    dialog.open("handoff", { projectId: detail.projectId, threadId: detail.threadId, placement: null, hostId: null, ...(detail.botId !== undefined ? { botId: detail.botId } : {}) });
  });
}
