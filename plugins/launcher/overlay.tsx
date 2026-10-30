import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { TooltipProvider } from "@radix-ui/react-tooltip";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import {
  experimental_NewThreadComposer as NewThreadComposer,
  experimental_useSidebarThreads as useSidebarThreads,
  useBbNavigate, useRpc, useSdk, useSettings,
  type PluginAppBuilder,
} from "@get-bb/plugin-sdk/app";
import type { quickComposeRpcContract } from "./server";
import { quickCompose, subscribe, type QuickComposeKind, type QuickComposeSession } from "./overlay-store";
import { cycle } from "./projects";
import { ProjectList, useProjectOptions } from "./project-list";
import { isBackgroundSubmit, projectShortcut } from "./overlay-keys";
import { ModelList, ModelTrigger, modelLabel } from "./model-picker";
import type { ModelSelection, ModelState } from "./presets";
import { PROVIDER_ID } from "./named-worktree";
import { focusBranchName } from "./named-worktree-inputs";

// The SDK exposes no draft state for the embedded composer. Check the editor
// text, then bb's persisted draft (which also covers attachments). The storage
// key format is bb-internal (0.46.1); if it changes, attachment-only drafts
// re-seed their selections, but the draft itself is kept by draftKey.
function hasDraft(section: HTMLElement | null, draftKey: string): boolean {
  return !!section?.querySelector("[data-promptbox-editor-content]")?.textContent?.trim()
    || localStorage.getItem(`bb.promptbox.contents-plugin-draft-${encodeURIComponent(draftKey)}-3`) !== null;
}

const LABELS: Record<QuickComposeKind, { dialog: string; placeholder: string }> = {
  "new-thread": { dialog: "Launcher quick compose", placeholder: "Start a new thread" },
  handoff: { dialog: "Launcher handoff", placeholder: "Hand off this thread" },
  // Forks keep the source's provider and model; the composer's pickers for those are ignored.
  fork: { dialog: "Launcher fork", placeholder: "Fork this thread into a new worktree" },
};

const MAC = /Mac|iPhone|iPad/.test(navigator.platform);
const HOST_MODEL_PICKER = "button[aria-label^='Provider, model and reasoning']";

// The host's model picker button cannot be reconfigured, so the overlay hides
// it and puts its own trigger (presets first) where it was.
function useModelSlot(root: HTMLElement | null, enabled: boolean): HTMLElement | null {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!root || !enabled) return;
    const span = document.createElement("span");
    span.style.display = "inline-flex";
    const sync = () => {
      const button = root.querySelector(HOST_MODEL_PICKER);
      if (button?.parentElement) {
        if (span.nextSibling !== button) button.parentElement.insertBefore(span, button);
        setSlot(span);
      } else {
        span.remove();
        setSlot(null);
      }
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { childList: true, subtree: true });
    return () => { observer.disconnect(); span.remove(); setSlot(null); };
  }, [root, enabled]);
  return slot;
}

function Session({ session, kind, visible, focusRequest }: {
  session: QuickComposeSession; kind: QuickComposeKind; visible: boolean; focusRequest: number;
}) {
  const rpc = useRpc<typeof quickComposeRpcContract>();
  const navigate = useBbNavigate();
  const sidebar = useSidebarThreads();
  const [source, setSource] = useState<{ projectId: string | null; environmentId: string | null }>();
  const [projectId, setProjectId] = useState(session.projectId);
  const [popup, setPopup] = useState<"project" | "model" | null>(null);
  const [focus, setFocus] = useState(0);
  const [namedWorktree, setNamedWorktree] = useState(false);
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
      state => { setModelState(state); setModel(state.selection ?? state.presets[0] ?? null); },
      () => setModelState({ presets: [], selection: null, names: {} }));
  }, [rpc, customModel]);
  // Presets may have been edited in settings since this session mounted.
  useEffect(() => {
    if (popup === "model") rpc.call("getModelState", {}).then(setModelState, () => {});
  }, [popup, rpc]);
  const chooseModel = (selection: ModelSelection, from: "preset" | "custom") => {
    setModel(selection);
    void rpc.call("setSelection", { selection }).then(setModelState, () => {});
    if (from === "preset") { setPopup(null); setFocus(n => n + 1); }
  };
  const [composerRoot, setComposerRoot] = useState<HTMLDivElement | null>(null);
  const modelSlot = useModelSlot(composerRoot, customModel && modelState !== undefined);

  // Enter opens the new thread; Cmd+Enter (Ctrl+Enter elsewhere) leaves it in the background.
  const backgroundRef = useRef(false);

  const choose = (id: string) => { setProjectId(id); setPopup(null); setFocus(n => n + 1); };
  const sectionRef = useRef<HTMLElement>(null);
  const draftKey = session.sourceThreadId
    ? `launcher-${kind}:${session.sourceThreadId}${session.sourceSeqEnd === null ? "" : `@${session.sourceSeqEnd}`}`
    : "launcher-compose";
  useEffect(() => {
    if (kind === "new-thread") return quickCompose.registerDraftCheck(() => hasDraft(sectionRef.current, draftKey));
  }, [kind, draftKey]);

  // bb's editor calls preventDefault on every Escape, so this listens in the
  // capture phase. It is added after composer-vim's capture listener, so an
  // Escape that vim consumes (Insert → Normal) is already defaultPrevented;
  // the next Escape reaches here and closes.
  useEffect(() => {
    if (!visible || popup) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      const section = sectionRef.current;
      if (!section || !(event.target instanceof Node) || !section.contains(event.target)) return;
      // Let bb close its @-mention and command menu first.
      if (section.querySelector("[data-promptbox-typeahead-menu]")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      quickCompose.close();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [visible, popup]);
  useEffect(() => {
    if (!visible) { setPopup(null); return; }
    const onKey = (event: KeyboardEvent) => {
      const action = projectShortcut(event, /Mac|iPhone|iPad/.test(navigator.platform));
      if (!action) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      // A fork stays in its source's project.
      if (kind === "fork" && action !== "branch-name") return;
      if (action === "open") { setPopup(value => value === "project" ? null : "project"); return; }
      if (action === "model") { if (customModel) setPopup(value => value === "model" ? null : "model"); return; }
      if (action === "branch-name") {
        const section = sectionRef.current;
        if (!section) return;
        const within = (el: HTMLElement) => section.contains(el);
        // Re-seeding the environment resets the other selections, so only do it when the field is not already shown.
        if (!focusBranchName(within)) { setNamedWorktree(true); focusBranchName(within, 2000); }
        return;
      }
      const next = projects && cycle(projects, projectId, action === "next" ? 1 : -1);
      if (next) choose(next.id);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [visible, projects, projectId, kind, customModel]);

  const close = (e: { target: EventTarget; currentTarget: EventTarget }) => { if (e.target === e.currentTarget) quickCompose.close(); };
  return <div style={{ display: visible ? "block" : "none", position: "fixed", inset: 0, zIndex: 50, background: "rgb(0 0 0 / .3)" }} onPointerDown={close}>
    <div style={{ position: "absolute", inset: 0, display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "15vh 16px 16px", overflowY: "auto", boxSizing: "border-box" }} onPointerDown={close}>
    <section role="dialog" aria-label={LABELS[kind].dialog} style={{ width: "100%", maxWidth: 720, padding: 16, borderRadius: 12, background: "var(--background)", color: "var(--foreground)" }} ref={sectionRef}
      onPointerDownCapture={() => { backgroundRef.current = false; }}
      onKeyDownCapture={(event: ReactKeyboardEvent) => {
        if (event.key !== "Enter" || !composerRoot?.contains(event.target as Node)) return;
        backgroundRef.current = isBackgroundSubmit(event.nativeEvent, MAC);
        if (!backgroundRef.current) return;
        event.preventDefault();
        event.stopPropagation();
        composerRoot.querySelector<HTMLFormElement>("form[data-promptbox]")?.requestSubmit();
      }}>
      {customModel && <style>{`[data-launcher-composer] ${HOST_MODEL_PICKER} { display: none !important; }`}</style>}
      {source && (kind !== "fork" || forkBase) && (!customModel || modelState) && <div ref={setComposerRoot} data-launcher-composer=""><NewThreadComposer
        defaultProviderId={model?.providerId}
        defaultModel={model?.model}
        defaultReasoningLevel={model?.reasoningLevel}
        defaultServiceTier={model?.serviceTier}
        defaultProjectId={projectId ?? undefined}
        defaultEnvironment={kind === "fork" && forkBase ? {
            type: "provider", environmentProviderId: PROVIDER_ID,
            inputs: { name: "", baseBranch: forkBase.branch ?? "" },
            ...(forkBase.hostId ? { machine: { type: "existing", hostId: forkBase.hostId } } : {}),
          }
          : namedWorktree || (defaultNamed && kind === "new-thread") ? { type: "provider", environmentProviderId: PROVIDER_ID, inputs: null }
          : projectId === source.projectId && source.environmentId ? { type: "reuse", environmentId: source.environmentId } : undefined}
        initialPrompt={kind === "handoff" && session.sourceThreadId ? `@thread:${session.sourceThreadId} ` : undefined}
        draftKey={draftKey}
        layout="document" focusRequest={visible ? focusRequest + focus : undefined}
        placeholder={kind === "fork" && session.sourceSeqEnd !== null ? "Fork from this message into a new worktree" : `${LABELS[kind].placeholder}  ·  ↵ open  ·  ${MAC ? "⌘↵" : "Ctrl+↵"} background`}
        onSubmit={async request => {
          const background = backgroundRef.current;
          backgroundRef.current = false;
          try {
            const { threadId } = kind === "fork" && session.sourceThreadId
              ? await rpc.call("forkThread", { sourceThreadId: session.sourceThreadId, request,
                ...(session.sourceSeqEnd === null ? {} : { sourceSeqEnd: session.sourceSeqEnd }) })
              : await rpc.call("createThread", { request });
            quickCompose.finish(kind);
            if (background) toast.success(kind === "fork" ? "Fork started" : "Thread started", { action: { label: "Open", onClick: () => navigate.toThread(threadId) } });
            else navigate.toThread(threadId);
          } catch (error) { toast.error(`Could not start thread: ${String(error)}`); throw error; }
        }}
      />
      {modelSlot && modelState && createPortal(
        <ModelTrigger label={modelLabel(modelState.presets, model, modelState.names)} onClick={() => setPopup(value => value === "model" ? null : "model")} />,
        modelSlot)}
      </div>}
      {popup && <div style={{ marginTop: 8, border: "1px solid var(--border)", borderRadius: 8, background: "var(--popover, var(--background))", overflow: "hidden" }}>
        {popup === "project"
          ? <ProjectList selectedLabel="last chosen here" selectedId={projectId} onChoose={option => choose(option.id)} onClose={() => { setPopup(null); setFocus(n => n + 1); }} />
          : <ModelList presets={modelState?.presets ?? []} names={modelState?.names ?? {}} selection={model} onChoose={chooseModel}
              onSavePresets={async presets => { setModelState(await rpc.call("savePresets", { presets })); }}
              onClose={() => { setPopup(null); setFocus(n => n + 1); }} />}
      </div>}
    </section>
    </div>
  </div>;
}

function Overlay() {
  const state = useSyncExternalStore(subscribe, quickCompose.getState, quickCompose.getState);
  return <TooltipProvider delayDuration={300}>{(["new-thread", "handoff", "fork"] as const).map(kind => {
    const session = state.sessions[kind];
    return session && <Session key={session.id} session={session} kind={kind} visible={state.active === kind} focusRequest={state.focusRequest} />;
  })}</TooltipProvider>;
}

export function registerOverlay(app: PluginAppBuilder) {
  app.slots.experimental_appOverlay({ id: "quick-compose", component: Overlay });
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
