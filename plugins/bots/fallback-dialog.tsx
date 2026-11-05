// Bots' own composer dialog for a new thread or handoff as a bot. The Launcher
// handles these requests first when it is installed; this answers when it is not.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { experimental_useSidebarThreads as useSidebarThreads, useRpc, type PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import { onBotsHandoff, onBotsNewThread } from "@arthurnw/bb-shared/events";
import { ComposerDialog, checkoutOn, handoffPrompt, hasDraft, ModelList, ModelTrigger, reuseOrCheckout } from "@arthurnw/bb-shared/composer";
import { botLabel, type Bot, type PermissionMode } from "@arthurnw/bb-shared/bots";
import type { ModelSelection } from "@arthurnw/bb-shared/selection";
import type { botsContract, spawnContract } from "./bots-server";
import { BotAvatar, BotIconSync, useBots } from "./bot-avatars";
import { dialog, subscribeDialog, type DialogSession } from "./dialog-store";

function Session({ session, visible, focusRequest }: { session: DialogSession; visible: boolean; focusRequest: number }) {
  const rpc = useRpc<typeof botsContract>();
  const spawnRpc = useRpc<typeof spawnContract>();
  const sidebar = useSidebarThreads();
  const bots = useBots();
  const [source, setSource] = useState<{ projectId: string | null; environmentId: string | null }>();
  const [projectId, setProjectId] = useState(session.projectId);
  const [bot, setBot] = useState<Bot | null>(null);
  const [inheritedBot, setInheritedBot] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [model, setModel] = useState<ModelSelection | null>(null);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>();
  const [checkout, setCheckout] = useState(false);
  const [starter, setStarter] = useState("");
  const [popup, setPopup] = useState(false);
  const [focus, setFocus] = useState(0);
  const sectionRef = useRef<HTMLElement>(null);
  const chosenRef = useRef(false);
  const latest = useRef({ bot, inheritedBot });
  latest.current = { bot, inheritedBot };
  const handoff = session.kind === "handoff";
  const draftKey = handoff && session.threadId ? `bots-handoff:${session.threadId}` : "bots-compose";

  useEffect(() => {
    if (source || (!handoff ? false : sidebar.status === "loading")) return;
    const thread = handoff ? sidebar.threads.find((t) => t.id === session.threadId) : undefined;
    const resolved = { projectId: thread?.projectId ?? session.projectId, environmentId: thread?.environment?.id ?? null };
    setSource(resolved);
    setProjectId(resolved.projectId);
  }, [source, handoff, sidebar, session]);

  function applyBot(next: Bot, beforeMount = false) {
    setBot(next);
    if (next.model) setModel(next.model);
    if (next.permissionMode) setPermissionMode(next.permissionMode);
    // Named worktrees and existing branches belong to the Launcher; without it only the checkout applies.
    if (next.environment === "checkout") setCheckout(true);
    if (next.projectId) setProjectId(next.projectId);
    if (next.starterPrompt && (beforeMount || !hasDraft(sectionRef.current, draftKey))) setStarter(next.starterPrompt);
  }
  useEffect(() => {
    if (bots === null || loaded || chosenRef.current) return;
    (handoff ? rpc.call("threadBots", {}) : Promise.resolve({ threads: {} as Record<string, string> })).then(
      ({ threads }) => {
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
    setPopup(false);
    setFocus((n) => n + 1);
  };

  return <ComposerDialog
    visible={visible} label={handoff ? "Bots handoff" : "Bots new thread"} sectionRef={sectionRef} onClose={() => dialog.close()} popupOpen={popup}
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
      defaultEnvironment: checkout ? checkoutOn(session.hostId) : reuseOrCheckout(projectId, source, session.hostId),
      initialPrompt: handoffPrompt(handoff ? session.threadId : null, starter),
    } : {}}
    chip={<ModelTrigger icon={bot ? <BotAvatar bot={bot} size={16} /> : undefined} label={bot ? botLabel({ ...bot, emoji: "" }) : "Bot"} onClick={() => setPopup((value) => !value)} />}
    onStarted={() => dialog.close()}
    submit={(request) => spawnRpc.call("createThread", { request, ...(session.placement ? { placement: session.placement } : {}),
      ...(latest.current.bot ? { botId: latest.current.bot.id } : latest.current.inheritedBot !== null ? { botId: null } : {}) })}
  >
    {popup && <div style={{ marginTop: 8, border: "1px solid var(--border)", borderRadius: 8, background: "var(--popover, var(--background))", overflow: "hidden" }}>
      <ModelList hideModels bots={bots ? [...bots] : []} bot={bot} onChooseBot={chooseBot} onClose={() => { setPopup(false); setFocus((n) => n + 1); }} />
    </div>}
  </ComposerDialog>;
}

function BotsDialog() {
  const state = useSyncExternalStore(subscribeDialog, dialog.getState, dialog.getState);
  return <>
    <BotIconSync />
    {state.session && <Session key={state.session.id} session={state.session} visible focusRequest={state.focusRequest} />}
  </>;
}

export function registerFallbackDialog(app: PluginAppBuilder) {
  app.slots.experimental_appOverlay({ id: "dialog", component: BotsDialog });
  onBotsNewThread((detail) => {
    dialog.open({ kind: "new-thread", projectId: detail?.projectId ?? null, threadId: null, placement: detail?.placement ?? null, hostId: detail?.hostId ?? null,
      ...(detail?.botId !== undefined ? { botId: detail.botId } : {}) });
  });
  onBotsHandoff((detail) => {
    dialog.open({ kind: "handoff", projectId: detail.projectId, threadId: detail.threadId, placement: null, hostId: null,
      ...(detail.botId !== undefined ? { botId: detail.botId } : {}) });
  });
}
