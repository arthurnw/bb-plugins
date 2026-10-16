import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { TooltipProvider } from "@radix-ui/react-tooltip";
import { toast } from "sonner";
import {
  experimental_NewThreadComposer as NewThreadComposer,
  experimental_useSidebarThreads as useSidebarThreads,
  useBbNavigate, useRpc, useSdk,
  type PluginAppBuilder,
} from "@get-bb/plugin-sdk/app";
import type { quickComposeRpcContract } from "./server";
import { quickCompose, subscribe, type QuickComposeKind, type QuickComposeSession } from "./overlay-store";
import { cycle, toOptions } from "./projects";
import { ProjectList } from "./project-list";
import { projectShortcut } from "./overlay-keys";
import { PROVIDER_ID } from "./named-worktree";
import { focusBranchName } from "./named-worktree-inputs";

function Session({ session, kind, visible, focusRequest }: {
  session: QuickComposeSession; kind: QuickComposeKind; visible: boolean; focusRequest: number;
}) {
  const sdk = useSdk();
  const rpc = useRpc<typeof quickComposeRpcContract>();
  const navigate = useBbNavigate();
  const sidebar = useSidebarThreads();
  const [source, setSource] = useState<{ projectId: string | null; environmentId: string | null }>();
  const [projectId, setProjectId] = useState(session.projectId);
  const [popup, setPopup] = useState(false);
  const [focus, setFocus] = useState(0);
  const [namedWorktree, setNamedWorktree] = useState(false);
  const changing = useRef(false);
  useEffect(() => {
    if (source || (kind === "handoff" && sidebar.status === "loading")) return;
    const thread = sidebar.threads.find(t => t.id === session.sourceThreadId);
    const resolved = { projectId: thread?.projectId ?? session.projectId, environmentId: thread?.environment?.id ?? null };
    setSource(resolved);
    setProjectId(resolved.projectId);
  }, [source, kind, sidebar, session]);

  const choose = (id: string) => { setProjectId(id); setPopup(false); setFocus(n => n + 1); };
  const sectionRef = useRef<HTMLElement>(null);

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
    if (!visible) { setPopup(false); return; }
    let cancelled = false;
    const onKey = (event: KeyboardEvent) => {
      const action = projectShortcut(event, /Mac|iPhone|iPad/.test(navigator.platform));
      if (!action) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (action === "open") { setPopup(value => !value); return; }
      if (action === "branch-name") {
        const section = sectionRef.current;
        if (!section) return;
        const within = (el: HTMLElement) => section.contains(el);
        // Re-seeding the environment resets the other selections, so only do it when the field is not already shown.
        if (!focusBranchName(within)) { setNamedWorktree(true); focusBranchName(within, 2000); }
        return;
      }
      if (changing.current) return;
      changing.current = true;
      void sdk.projects.list({ includePersonal: true }).then(projects => {
        if (cancelled) return;
        const next = cycle(toOptions(projects), projectId, action === "next" ? 1 : -1);
        if (next) choose(next.id);
      }).catch(error => toast.error(String(error))).finally(() => { changing.current = false; });
    };
    window.addEventListener("keydown", onKey, true);
    return () => { cancelled = true; window.removeEventListener("keydown", onKey, true); };
  }, [visible, sdk, projectId]);

  return <div style={{ display: visible ? "flex" : "none", position: "fixed", inset: 0, zIndex: 50, justifyContent: "center", alignItems: "flex-start", padding: "15vh 16px 16px", background: "rgb(0 0 0 / .3)", overflowY: "auto" }} onPointerDown={e => { if (e.target === e.currentTarget) quickCompose.close(); }}>
    <section role="dialog" aria-label={kind === "handoff" ? "Project Picker handoff" : "Project Picker quick compose"} style={{ width: "100%", maxWidth: 720, padding: 16, borderRadius: 12, background: "var(--background)", color: "var(--foreground)" }} ref={sectionRef}>
      {source && <NewThreadComposer
        defaultProjectId={projectId ?? undefined}
        defaultEnvironment={namedWorktree ? { type: "provider", environmentProviderId: PROVIDER_ID, inputs: null }
          : projectId === source.projectId && source.environmentId ? { type: "reuse", environmentId: source.environmentId } : undefined}
        initialPrompt={session.sourceThreadId ? `@thread:${session.sourceThreadId} ` : undefined}
        draftKey={session.sourceThreadId ? `project-picker-handoff:${session.sourceThreadId}` : "project-picker-compose"}
        layout="document" focusRequest={visible ? focusRequest + focus : undefined}
        placeholder={kind === "handoff" ? "Hand off this thread" : "Start a new thread"}
        onSubmit={async request => {
          try {
            const { threadId } = await rpc.call("createThread", { request });
            quickCompose.finish(kind);
            toast.success("Thread started", { action: { label: "Open", onClick: () => navigate.toThread(threadId) } });
          } catch (error) { toast.error(`Could not start thread: ${String(error)}`); throw error; }
        }}
      />}
      {popup && <div style={{ marginTop: 8, border: "1px solid var(--border)", borderRadius: 8, background: "var(--popover, var(--background))", overflow: "hidden" }}>
        <ProjectList selectedLabel="last chosen here" selectedId={projectId} onChoose={option => choose(option.id)} onClose={() => { setPopup(false); setFocus(n => n + 1); }} />
      </div>}
    </section>
  </div>;
}

function Overlay() {
  const state = useSyncExternalStore(subscribe, quickCompose.getState, quickCompose.getState);
  return <TooltipProvider delayDuration={300}>{(["new-thread", "handoff"] as const).map(kind => {
    const session = state.sessions[kind];
    return session && <Session key={session.id} session={session} kind={kind} visible={state.active === kind} focusRequest={state.focusRequest} />;
  })}</TooltipProvider>;
}

export function registerOverlay(app: PluginAppBuilder) {
  app.slots.experimental_appOverlay({ id: "quick-compose", component: Overlay });
  app.commands.register({ id: "new-thread", title: "Project Picker: quick compose", defaultShortcut: { key: "l", mod: true, shift: true }, run: context => quickCompose.toggle("new-thread", context) });
  app.commands.register({ id: "handoff", title: "Project Picker: hand off this thread", defaultShortcut: { key: "h", mod: true, shift: true }, isAvailable: context => context.threadId !== null, run: context => quickCompose.toggle("handoff", context) });
}
