import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { TooltipProvider } from "@radix-ui/react-tooltip";
import {
  experimental_useSidebarThreads as useSidebarThreads,
  useRpc, useSdk, useSettings,
  type PluginAppBuilder,
} from "@get-bb/plugin-sdk/app";
import { onHandoff, onNewThread } from "@arthurnw/bb-shared/events";
import { BotAvatar, ComposerDialog, checkoutOn, handoffPrompt, hasDraft, ModelList, modelLabel, ModelTrigger, projectShortcut, reuseOrCheckout } from "@arthurnw/bb-shared/composer";
import { cycle, ProjectList, useProjectOptions } from "@arthurnw/bb-shared/projects";
import type { Bot, BotEnvironment, PermissionMode } from "@arthurnw/bb-shared/bots";
import type { ModelSelection, ModelState } from "@arthurnw/bb-shared/selection";
import type { quickComposeRpcContract } from "./server";
import { BotsSync, useBotsRpc } from "./bots-client";
import { quickCompose, subscribe, type QuickComposeKind, type QuickComposeSession } from "./overlay-store";

import { PROVIDER_ID } from "./named-worktree";
import { branchNameFocused, focusBranchName } from "./named-worktree-inputs";
import { EXISTING_PROVIDER_ID } from "./existing-branch";
import { existingRefShown, focusExistingRef } from "./existing-branch-inputs";

const LABELS: Record<QuickComposeKind, { dialog: string; placeholder: string }> = {
  "new-thread": { dialog: "Launcher quick compose", placeholder: "Start a new thread" },
  handoff: { dialog: "Launcher handoff", placeholder: "Hand off this thread" },
  // Forks keep the source's provider and model; the composer's pickers for those are ignored.
  fork: { dialog: "Launcher fork", placeholder: "Fork this thread into a new worktree" },
};

const SEED_FOR: Record<BotEnvironment, "named" | "existing" | "checkout"> = { "named-worktree": "named", "existing-branch": "existing", checkout: "checkout" };

function Session({ session, kind, visible, focusRequest }: {
  session: QuickComposeSession; kind: QuickComposeKind; visible: boolean; focusRequest: number;
}) {
  const rpc = useRpc<typeof quickComposeRpcContract>();
  const botsRpc = useBotsRpc();
  const sidebar = useSidebarThreads();
  const [source, setSource] = useState<{ projectId: string | null; environmentId: string | null }>();
  const [projectId, setProjectId] = useState(session.projectId);
  const [popup, setPopup] = useState<"project" | "model" | null>(null);
  const [focus, setFocus] = useState(0);
  const [seeded, setSeeded] = useState<"named" | "existing" | "checkout" | null>(null);
  const defaultNamed = useSettings().values?.defaultNamedWorktree === true;
  const projects = useProjectOptions();
  const sdk = useSdk();
  // A fork's worktree defaults to the source's branch on the source's machine.
  const [forkBase, setForkBase] = useState<{ branch: string | null; hostId: string | null }>();
  useEffect(() => {
    if (kind !== "fork" || !source || forkBase) return;
    if (!source.environmentId) { setForkBase({ branch: null, hostId: null }); return; }
    sdk.environments.get({ environmentId: source.environmentId }).then(
      env => setForkBase({ branch: env.branchName, hostId: env.hostId }),
      () => setForkBase({ branch: null, hostId: null }));
  }, [kind, source, forkBase, sdk]);
  useEffect(() => {
    if (source || (kind !== "new-thread" && sidebar.status === "loading")) return;
    const thread = sidebar.threads.find(t => t.id === session.sourceThreadId);
    const resolved = { projectId: thread?.projectId ?? session.projectId, environmentId: thread?.environment?.id ?? null };
    setSource(resolved);
    setProjectId(resolved.projectId);
  }, [source, kind, sidebar, session]);

  // A fork keeps its source's provider and model, so only the other kinds load presets.
  const customModel = kind !== "fork";
  const [modelState, setModelState] = useState<ModelState>();
  const [model, setModel] = useState<ModelSelection | null>(null);
  useEffect(() => {
    if (!customModel) return;
    rpc.call("getModelState", {}).then(
      // A bot chosen before this resolves keeps its model.
      state => { setModelState(state); setModel(current => current ?? state.selection ?? state.presets[0] ?? null); },
      () => setModelState({ presets: [], selection: null, names: {} }));
  }, [rpc, customModel]);
  // Presets may have been edited in settings since this session mounted.
  useEffect(() => {
    if (popup === "model") rpc.call("getModelState", {}).then(setModelState, () => {});
  }, [popup, rpc]);
  // Bots share the model picker. A handoff starts on its source thread's bot,
  // which the new thread would inherit anyway.
  const [bots, setBots] = useState<Bot[]>();
  const [bot, setBot] = useState<Bot | null>(null);
  const [inheritedBot, setInheritedBot] = useState<string | null>(null);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>();
  const [starter, setStarter] = useState("");
  // The bot picked in this session. The load below only seeds the opening bot,
  // so it must not replace a choice made first; submit reads the latest state.
  const chosenRef = useRef(false);
  const latest = useRef({ bot, inheritedBot });
  latest.current = { bot, inheritedBot };
  useEffect(() => {
    if (!customModel) { setBots([]); return; }
    Promise.all([botsRpc.listBots(), kind === "handoff" ? botsRpc.threadBots() : Promise.resolve({ threads: {} as Record<string, string> })]).then(
      ([{ bots: list }, { threads }]) => {
        const inherited = session.sourceThreadId ? threads[session.sourceThreadId] ?? null : null;
        setInheritedBot(inherited);
        if (chosenRef.current) { setBots(list); return; }
        const requested = session.botId === undefined ? undefined : list.find((item) => item.id === session.botId) ?? null;
        if (requested) applyBot(requested, true);
        else setBot(requested === null ? null : list.find((item) => item.id === inherited) ?? null);
        setBots(list);
      },
      () => setBots([]));
  }, [botsRpc, customModel, kind, session.sourceThreadId, session.botId]);
  useEffect(() => {
    if (popup === "model") botsRpc.listBots().then(({ bots: list }) => setBots(list), () => {});
  }, [popup, botsRpc]);
  // Applies the bot's saved fields in one re-seed; fields it leaves unset keep
  // their value. Before the composer mounts its draft is empty by definition.
  function applyBot(next: Bot, beforeMount = false) {
    setBot(next);
    if (next.model) setModel(next.model);
    if (next.permissionMode) setPermissionMode(next.permissionMode);
    if (next.environment) setSeeded(SEED_FOR[next.environment]);
    if (next.projectId) setProjectId(next.projectId);
    if (next.starterPrompt && (beforeMount || !hasDraft(sectionRef.current, draftKey))) setStarter(next.starterPrompt);
  }
  const chooseBot = (next: Bot | null) => {
    chosenRef.current = true;
    if (next) applyBot(next);
    else setBot(null);
    setPopup(null);
    setFocus(n => n + 1);
  };
  const chooseModel = (selection: ModelSelection, from: "preset" | "custom") => {
    setModel(selection);
    void rpc.call("setSelection", { selection }).then(setModelState, () => {});
    if (from === "preset") { setPopup(null); setFocus(n => n + 1); }
  };
  const choose = (id: string) => { setProjectId(id); setPopup(null); setFocus(n => n + 1); };
  const sectionRef = useRef<HTMLElement>(null);
  const draftKey = session.sourceThreadId
    ? `launcher-${kind}:${session.sourceThreadId}${session.sourceSeqEnd === null ? "" : `@${session.sourceSeqEnd}`}`
    : "launcher-compose";
  useEffect(() => {
    if (kind === "new-thread") return quickCompose.registerDraftCheck(() => hasDraft(sectionRef.current, draftKey));
  }, [kind, draftKey]);

  useEffect(() => {
    if (!visible) { setPopup(null); return; }
    const onKey = (event: KeyboardEvent) => {
      const action = projectShortcut(event, /Mac|iPhone|iPad/.test(navigator.platform));
      if (!action) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      // A fork stays in its source's project.
      if (kind === "fork" && action !== "branch-name") return;
      if (action === "existing-ref") {
        const section = sectionRef.current;
        if (!section) return;
        const within = (el: HTMLElement) => section.contains(el);
        if (!focusExistingRef(within)) { setSeeded("existing"); focusExistingRef(within, 2000); }
        return;
      }
      if (action === "open") { setPopup(value => value === "project" ? null : "project"); return; }
      if (action === "model") { if (customModel) setPopup(value => value === "model" ? null : "model"); return; }
      if (action === "branch-name") {
        const section = sectionRef.current;
        if (!section) return;
        const within = (el: HTMLElement) => section.contains(el);
        // Cycles Named worktree (branch name field) -> Existing branch / PR -> Project checkout.
        // Re-seeding the environment resets the other selections, so only do it when the target is not already shown.
        if (kind !== "fork" && branchNameFocused(within)) { setSeeded("existing"); focusExistingRef(within, 2000); }
        else if (kind !== "fork" && existingRefShown(within)) setSeeded("checkout");
        else if (!focusBranchName(within)) { setSeeded("named"); focusBranchName(within, 2000); }
        return;
      }
      const next = projects && cycle(projects, projectId, action === "next" ? 1 : -1);
      if (next) choose(next.id);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [visible, projects, projectId, kind, customModel]);

  // Only a new-thread session carries a machine; the others take theirs from the source thread.
  const machine = session.hostId ? { machine: { type: "existing" as const, hostId: session.hostId } } : {};
  return <ComposerDialog
    visible={visible} label={LABELS[kind].dialog} sectionRef={sectionRef} onClose={() => quickCompose.close()} popupOpen={popup !== null}
    draftKey={draftKey} focusRequest={visible ? focusRequest + focus : undefined}
    placeholder={kind === "fork" && session.sourceSeqEnd !== null ? "Fork from this message into a new worktree" : LABELS[kind].placeholder}
    hint={!(kind === "fork" && session.sourceSeqEnd !== null)}
    ready={!!source && (kind !== "fork" || !!forkBase) && (!customModel || !!modelState) && !!bots}
    composerProps={source ? {
      defaultProviderId: model?.providerId,
      defaultModel: model?.model,
      defaultReasoningLevel: model?.reasoningLevel,
      defaultServiceTier: model?.serviceTier,
      defaultPermissionMode: permissionMode,
      defaultProjectId: projectId ?? undefined,
      defaultEnvironment: kind === "fork" && forkBase ? {
          type: "provider", environmentProviderId: PROVIDER_ID,
          inputs: { name: "", baseBranch: forkBase.branch ?? "" },
          ...(forkBase.hostId ? { machine: { type: "existing", hostId: forkBase.hostId } } : {}),
        }
        : seeded === "checkout" ? checkoutOn(session.hostId)
        : seeded === "existing" ? { type: "provider", environmentProviderId: EXISTING_PROVIDER_ID, inputs: null, ...machine }
        : seeded === "named" || (defaultNamed && kind === "new-thread") ? { type: "provider", environmentProviderId: PROVIDER_ID, inputs: null, ...machine }
        : reuseOrCheckout(projectId, source, session.hostId),
      initialPrompt: handoffPrompt(kind === "handoff" ? session.sourceThreadId : null, starter),
    } : {}}
    modelTrigger={customModel ? modelState ? <ModelTrigger icon={bot ? <BotAvatar bot={bot} size={16} /> : undefined} label={modelLabel(modelState.presets, model, modelState.names, bot && { ...bot, emoji: "" })} onClick={() => setPopup(value => value === "model" ? null : "model")} /> : null : undefined}
    startedMessage={kind === "fork" ? "Fork started" : "Thread started"}
    onStarted={() => quickCompose.finish(kind)}
    submit={request => kind === "fork" && session.sourceThreadId
      ? rpc.call("forkThread", { sourceThreadId: session.sourceThreadId, request,
        ...(session.sourceSeqEnd === null ? {} : { sourceSeqEnd: session.sourceSeqEnd }) })
      : rpc.call("createThread", { request, ...(session.placement ? { placement: session.placement } : {}),
        ...(latest.current.bot ? { botId: latest.current.bot.id } : latest.current.inheritedBot !== null ? { botId: null } : {}) })}
  >
    {popup && <div style={{ marginTop: 8, border: "1px solid var(--border)", borderRadius: 8, background: "var(--popover, var(--background))", overflow: "hidden" }}>
      {popup === "project"
        ? <ProjectList selectedLabel="last chosen here" selectedId={projectId} onChoose={option => choose(option.id)} onClose={() => { setPopup(null); setFocus(n => n + 1); }} />
        : <ModelList bots={bots ?? []} bot={bot} onChooseBot={chooseBot} presets={modelState?.presets ?? []} names={modelState?.names ?? {}} selection={model} onChoose={chooseModel}
            onSavePresets={async presets => { setModelState(await rpc.call("savePresets", { presets })); }}
            onClose={() => { setPopup(null); setFocus(n => n + 1); }} />}
    </div>}
  </ComposerDialog>;
}

// A disabled plugin's app code can stay loaded until the window reloads, with
// its window listeners still attached. Claim events only while the overlay is
// actually on screen, so a disabled Launcher leaves them to Bots' dialog.
let overlayMounts = 0;

function Overlay() {
  useEffect(() => { overlayMounts++; return () => { overlayMounts--; }; }, []);
  const state = useSyncExternalStore(subscribe, quickCompose.getState, quickCompose.getState);
  return <TooltipProvider delayDuration={300}><BotsSync />{(["new-thread", "handoff", "fork"] as const).map(kind => {
    const session = state.sessions[kind];
    return session && <Session key={session.id} session={session} kind={kind} visible={state.active === kind} focusRequest={state.focusRequest} />;
  })}</TooltipProvider>;
}

export function registerOverlay(app: PluginAppBuilder) {
  app.slots.experimental_appOverlay({ id: "quick-compose", component: Overlay });
  // Other plugins (Canvas, Bots) open the composer with cancelable window
  // events; handling one tells the sender the Launcher took it.
  onNewThread(detail => {
    if (overlayMounts === 0) return false;
    quickCompose.open("new-thread", {
      projectId: detail?.projectId ?? null, threadId: null,
      placement: detail?.placement ?? null, hostId: detail?.hostId ?? null,
      ...(detail?.botId !== undefined ? { botId: detail.botId } : {}),
    });
  });
  onHandoff(detail => {
    if (overlayMounts === 0) return false;
    quickCompose.open("handoff", { projectId: detail.projectId, threadId: detail.threadId, ...(detail.botId !== undefined ? { botId: detail.botId } : {}) });
  });
  app.commands.register({ id: "new-thread", title: "Launcher: quick compose", defaultShortcut: { key: "n", mod: true }, run: context => quickCompose.toggle("new-thread", context) });
  app.commands.register({ id: "handoff", title: "Launcher: hand off this thread", defaultShortcut: { key: "h", mod: true, shift: true }, isAvailable: context => context.threadId !== null, run: context => quickCompose.toggle("handoff", context) });
  app.commands.register({ id: "fork", title: "Launcher: fork this thread into a named worktree", isAvailable: context => context.threadId !== null, run: context => quickCompose.toggle("fork", context) });
  app.slots.messageAction({
    id: "fork-named-worktree", title: "Fork into named worktree", icon: "GitBranch",
    run: ({ threadId, message }) => quickCompose.open("fork", { projectId: null, threadId, sourceSeqEnd: message.sourceSeqEnd }),
  });
  app.slots.experimental_threadAction({
    id: "fork-named-worktree", title: "Fork into named worktree", icon: "GitBranch",
    group: "1_open", // experimental_THREAD_ACTION_GROUPS.open
    item: ({ thread }) => thread.archivedAt !== null ? null : {
      label: "Fork into named worktree", icon: "GitBranch",
      run: () => quickCompose.open("fork", { projectId: thread.projectId, threadId: thread.id }),
    },
  });
}
