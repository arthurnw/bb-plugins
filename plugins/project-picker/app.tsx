import { NamedWorktreeInputs } from "./named-worktree-inputs";
import { PROVIDER_ID } from "./named-worktree";
import { definePluginApp, useComposer, useSdk, type PluginComposerApi } from "@get-bb/plugin-sdk/app";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { cycle, filter, toOptions, type ProjectOption } from "./projects";

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
  const sdk = useSdk();
  const [options, setOptions] = useState<ProjectOption[] | null>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const selectedId = currentProjectId(composer);

  useEffect(() => {
    let cancelled = false;
    loadOptions(sdk).then(
      (loaded) => !cancelled && setOptions(loaded),
      () => !cancelled && setOptions([]),
    );
    return () => {
      cancelled = true;
    };
  }, [sdk]);

  const matches = useMemo(() => filter(options ?? [], query), [options, query]);

  // Start on the selected project when the list first loads.
  useEffect(() => {
    if (options === null || query !== "") return;
    setActive(Math.max(0, matches.findIndex((o) => o.id === selectedId)));
  }, [options]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const choose = (option: ProjectOption | undefined) => {
    if (option === undefined) return;
    composer.experimental_closePopup();
    void composer.setSelection({ projectId: option.id }).then(() => composer.focus());
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const down = event.key === "ArrowDown" || (event.ctrlKey && (event.key === "n" || event.key === "j"));
    const up = event.key === "ArrowUp" || (event.ctrlKey && (event.key === "p" || event.key === "k"));
    if (down || up) {
      event.preventDefault();
      if (matches.length > 0) setActive((i) => (i + (down ? 1 : -1) + matches.length) % matches.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(matches[active]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      composer.experimental_closePopup();
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", minWidth: 280, maxHeight: 320 }}>
      <input
        autoFocus
        value={query}
        placeholder="Switch project…"
        aria-label="Search projects"
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        style={{
          padding: "8px 12px",
          border: "none",
          borderBottom: "1px solid var(--border)",
          background: "transparent",
          color: "var(--foreground)",
          fontSize: 13,
          outline: "none",
        }}
      />
      <div ref={listRef} role="listbox" aria-label="Projects" style={{ overflowY: "auto", padding: 4 }}>
        {options === null ? (
          <div style={emptyStyle}>Loading…</div>
        ) : matches.length === 0 ? (
          <div style={emptyStyle}>No matching projects</div>
        ) : (
          matches.map((option, index) => (
            <div
              key={option.id}
              role="option"
              data-index={index}
              aria-selected={index === active}
              onMouseEnter={() => setActive(index)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(option)}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 8,
                padding: "6px 8px",
                borderRadius: 4,
                cursor: "pointer",
                fontSize: 13,
                color: "var(--foreground)",
                background: index === active ? "var(--accent)" : "transparent",
              }}
            >
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{option.name}</span>
              {option.id === selectedId && <span style={{ color: "var(--muted-foreground)" }}>current</span>}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

const emptyStyle = { padding: "6px 8px", fontSize: 12, color: "var(--muted-foreground)" };

export default definePluginApp((app) => {
  app.slots.experimental_environmentProviderInputs({ environmentProviderId: PROVIDER_ID, component: NamedWorktreeInputs });
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
