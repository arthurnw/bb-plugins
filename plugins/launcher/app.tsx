import { definePluginApp, useComposer, useSdk, type PluginComposerApi } from "@get-bb/plugin-sdk/app";
import { EXISTING_PROVIDER_ID } from "./existing-branch";
import { ExistingBranchInputs, focusExistingRef } from "./existing-branch-inputs";
import { PROVIDER_ID } from "./named-worktree";
import { branchNameFocused, focusBranchName, NamedWorktreeInputs } from "./named-worktree-inputs";
import { registerOverlay } from "./overlay";
import { PresetSettings } from "./settings";
import { BotSettings } from "./bot-settings";
import { registerBotIcons } from "./bot-avatars";
import { BOT_POPUP_ID, NativeModelPopup, NativeModelTrigger } from "./native-bot";
import { registerBotThreadAction } from "./bot-thread-action";
import { registerBotThreadInfo } from "./bot-thread-info";
import { BotThreadList } from "./bots-view";
import { DefaultEnvironment } from "./default-environment";
import { loadProjectOptions, ProjectList } from "@arthurnw/bb-shared/projects";
import { cycle } from "@arthurnw/bb-shared/projects";

const POPUP_ID = "launcher";

type Sdk = ReturnType<typeof useSdk>;

function currentProjectId(composer: PluginComposerApi) {
  return composer.selection?.projectId ?? (composer.scope.kind === "new-thread" ? composer.scope.projectId : null);
}

function ProjectPopup() {
  const composer = useComposer();
  return <ProjectList selectedId={currentProjectId(composer)} onClose={() => composer.experimental_closePopup()} onChoose={(option) => {
    composer.experimental_closePopup();
    void composer.setSelection({ projectId: option.id }).then(() => composer.focus());
  }} />;
}

export default definePluginApp((app) => {
  app.slots.experimental_environmentProviderInputs({ environmentProviderId: PROVIDER_ID, component: NamedWorktreeInputs });
  app.slots.experimental_environmentProviderInputs({ environmentProviderId: EXISTING_PROVIDER_ID, component: ExistingBranchInputs });
  registerOverlay(app);
  registerBotIcons(app);
  registerBotThreadAction(app);
  registerBotThreadInfo(app);
  app.slots.experimental_threadList({
    id: "bots", title: "Launcher bots", description: "Bots and custom sections in one order you arrange. Drag a thread onto a bot to hand it off, onto a thread to nest it, or onto a section to file it.",
    component: ({ activeThreadId, activeProjectId, onNavigate }) =>
      <BotThreadList activeThreadId={activeThreadId} activeProjectId={activeProjectId} onNavigate={onNavigate} />,
  });
  app.slots.settingsSection({ id: "model-presets", title: "Model presets", description: "Presets for the floating composer's model picker.", component: PresetSettings });
  app.slots.settingsSection({ id: "bots", title: "Bots", description: "Saved launch configurations with their own instructions and memory.", component: BotSettings });
  // The browser SDK client is only reachable through a hook, so commands that
  // run outside React use the one captured by the popup component tree.
  let sdkRef: Sdk | null = null;
  function SdkCapture() {
    sdkRef = useSdk();
    return null;
  }

  app.composer.customize({
    id: "launcher",
    scopes: ["new-thread"],
    experimental_popups: [{ id: POPUP_ID, label: "Switch project", component: ProjectPopup }, { id: BOT_POPUP_ID, label: "Choose bot or model", component: NativeModelPopup }],
    actions: [{ id: "bot", component: NativeModelTrigger }],
    banners: [{ id: "sdk-capture", chrome: "bare", component: SdkCapture }, { id: "default-environment", chrome: "bare", component: DefaultEnvironment }],
  });

  app.composer.experimental_registerCommand({
    id: "open",
    title: "Launcher: switch project",
    defaultShortcut: { key: "j", mod: true, shift: true },
    run: ({ composer }) => {
      if (composer.scope.kind !== "new-thread") return;
      composer.experimental_openPopup(POPUP_ID);
    },
  });

  const cycleBy = (step: 1 | -1) => async ({ composer }: { composer: PluginComposerApi }) => {
    if (composer.scope.kind !== "new-thread" || sdkRef === null) return;
    const next = cycle(await loadProjectOptions(sdkRef), currentProjectId(composer), step);
    if (next !== null) await composer.setSelection({ projectId: next.id });
  };

  app.composer.experimental_registerCommand({
    id: "branch-name",
    title: "Launcher: named worktree / existing branch / project checkout",
    defaultShortcut: { key: "b", mod: true, shift: true },
    run: async ({ composer }) => {
      if (composer.scope.kind !== "new-thread") return;
      const within = (el: HTMLElement) => !el.closest("section[role=dialog]");
      const current = composer.selection?.environment;
      const hostId = current?.type === "host" ? current.hostId
        : current?.type === "provider" && current.machine?.type === "existing" ? current.machine.hostId : undefined;
      const machine = hostId ? { machine: { type: "existing", hostId } } as const : {};
      const providerId = current?.type === "provider" ? current.environmentProviderId : null;
      // Cycles Named worktree (branch name field) -> Existing branch / PR -> Project checkout.
      // From Named worktree, the first press only focuses the field when it isn't focused yet.
      if (providerId === PROVIDER_ID && !branchNameFocused(within) && focusBranchName(within)) return;
      if (providerId === PROVIDER_ID) {
        await composer.setSelection({ environment: { type: "provider", environmentProviderId: EXISTING_PROVIDER_ID, inputs: null, ...machine } });
        focusExistingRef(within, 2000);
      } else if (providerId === EXISTING_PROVIDER_ID) {
        await composer.setSelection({ environment: { type: "host", workspace: { type: "unmanaged", path: null }, ...(hostId ? { hostId } : {}) } });
      } else {
        await composer.setSelection({ environment: { type: "provider", environmentProviderId: PROVIDER_ID, inputs: null, ...machine } });
        focusBranchName(within, 2000);
      }
    },
  });

  app.composer.experimental_registerCommand({
    id: "existing-ref",
    title: "Launcher: existing branch / PR",
    defaultShortcut: { key: "g", mod: true, shift: true },
    run: async ({ composer }) => {
      if (composer.scope.kind !== "new-thread") return;
      const within = (el: HTMLElement) => !el.closest("section[role=dialog]");
      if (focusExistingRef(within)) return;
      const current = composer.selection?.environment;
      const hostId = current?.type === "host" ? current.hostId
        : current?.type === "provider" && current.machine?.type === "existing" ? current.machine.hostId : undefined;
      await composer.setSelection({
        environment: { type: "provider", environmentProviderId: EXISTING_PROVIDER_ID, inputs: null,
          ...(hostId ? { machine: { type: "existing", hostId } } : {}) },
      });
      focusExistingRef(within, 2000);
    },
  });

  // No default shortcut: Mod+Shift+K belongs to Quick Chat. Bind one in Settings → Keyboard.
  app.composer.experimental_registerCommand({
    id: "bot",
    title: "Launcher: bot and model picker",
    run: ({ composer }) => {
      if (composer.scope.kind !== "new-thread" || composer.key.includes("launcher-")) return;
      composer.experimental_openPopup(BOT_POPUP_ID);
    },
  });

  app.composer.experimental_registerCommand({
    id: "next",
    title: "Launcher: next project",
    defaultShortcut: { key: "j", alt: true },
    run: cycleBy(1),
  });

  app.composer.experimental_registerCommand({
    id: "previous",
    title: "Launcher: previous project",
    defaultShortcut: { key: "j", alt: true, shift: true },
    run: cycleBy(-1),
  });
});
