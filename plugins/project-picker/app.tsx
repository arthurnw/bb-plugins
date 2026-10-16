import { definePluginApp, useComposer, useSdk, type PluginComposerApi } from "@get-bb/plugin-sdk/app";
import { PROVIDER_ID } from "./named-worktree";
import { NamedWorktreeInputs } from "./named-worktree-inputs";
import { registerOverlay } from "./overlay";
import { ProjectList } from "./project-list";
import { cycle, toOptions, type ProjectOption } from "./projects";

const POPUP_ID = "project-picker";

type Sdk = ReturnType<typeof useSdk>;

async function loadOptions(sdk: Sdk): Promise<ProjectOption[]> {
  return toOptions(await sdk.projects.list({ includePersonal: true }));
}

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
  registerOverlay(app);
  // The browser SDK client is only reachable through a hook, so commands that
  // run outside React use the one captured by the popup component tree.
  let sdkRef: Sdk | null = null;
  function SdkCapture() {
    sdkRef = useSdk();
    return null;
  }

  app.composer.customize({
    id: "project-picker",
    scopes: ["new-thread"],
    experimental_popups: [{ id: POPUP_ID, label: "Switch project", component: ProjectPopup }],
    banners: [{ id: "sdk-capture", chrome: "bare", component: SdkCapture }],
  });

  app.composer.experimental_registerCommand({
    id: "open",
    title: "Project Picker: switch project",
    defaultShortcut: { key: "j", mod: true, shift: true },
    run: ({ composer }) => {
      if (composer.scope.kind !== "new-thread") return;
      composer.experimental_openPopup(POPUP_ID);
    },
  });

  const cycleBy = (step: 1 | -1) => async ({ composer }: { composer: PluginComposerApi }) => {
    if (composer.scope.kind !== "new-thread" || sdkRef === null) return;
    const next = cycle(await loadOptions(sdkRef), currentProjectId(composer), step);
    if (next !== null) await composer.setSelection({ projectId: next.id });
  };

  app.composer.experimental_registerCommand({
    id: "next",
    title: "Project Picker: next project",
    defaultShortcut: { key: "j", alt: true },
    run: cycleBy(1),
  });

  app.composer.experimental_registerCommand({
    id: "previous",
    title: "Project Picker: previous project",
    defaultShortcut: { key: "j", alt: true, shift: true },
    run: cycleBy(-1),
  });
});
