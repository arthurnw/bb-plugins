import { experimental_BranchPicker as BranchPicker, useSdk, type PluginEnvironmentProviderInputsProps } from "@get-bb/plugin-sdk/app";
import { useEffect, useRef, useState } from "react";
import { branchNameError, inputsSchema } from "./named-worktree";

import { createFocusRegistry } from "./focus-field";

const registry = createFocusRegistry();

/** Focuses a visible branch name field matching `within`; returns false when none is mounted yet. */
export const focusBranchName = registry.focus;
export const branchNameShown = registry.shown;

export function NamedWorktreeInputs(props: PluginEnvironmentProviderInputsProps) {
  const targetKey = props.target.kind === "existing-host" ? props.target.hostId : "new-host";
  return <Inputs key={`${props.projectId}:${targetKey}`} {...props} />;
}

function Inputs({ projectId, target, value, onChange }: PluginEnvironmentProviderInputsProps) {
  const parsed = inputsSchema.safeParse(value);
  const [name, setName] = useState(parsed.success ? parsed.data.name : "");
  // null (shown as "Default branch") submits "", the project's default branch.
  const [baseBranch, setBaseBranch] = useState<string | null>(parsed.success && parsed.data.baseBranch ? parsed.data.baseBranch : null);
  const hostId = target.kind === "existing-host" ? target.hostId : null;
  const field = useRef<HTMLInputElement>(null);
  const sdk = useSdk();
  const [prefix, setPrefix] = useState("");
  // Start with bb's own branch prefix (Settings → General, `managedBranchPrefix`).
  useEffect(() => {
    let cancelled = false;
    sdk.system.config().then((config) => {
      if (cancelled) return;
      const configured = config.generalSettings.managedBranchPrefix;
      setPrefix(configured);
      setName((current) => (current === "" ? configured : current));
    }, () => {});
    return () => { cancelled = true; };
  }, [sdk]);
  useEffect(() => (field.current ? registry.register(field.current) : undefined), []);
  useEffect(() => {
    // An empty name, or only the prefix, lets the provider name the branch from the thread title.
    const chosen = name === prefix ? "" : name;
    const reason = chosen === "" ? null : branchNameError(chosen);
    if (reason) onChange({ status: "blocked", reason });
    else onChange({ status: "ready", value: { name: chosen, baseBranch: baseBranch ?? "" } });
  }, [name, prefix, baseBranch, onChange]);
  return (
    <div style={{ display: "flex", flexWrap: "nowrap", alignItems: "center", gap: 8, whiteSpace: "nowrap", minWidth: 0, flexShrink: 1 }}>
      <input ref={field} aria-label="New branch name" placeholder="auto from title" value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.preventDefault();
          // Keep typing out of the composer, but let app shortcuts through.
          if (!event.metaKey && !event.ctrlKey && !event.altKey) event.stopPropagation();
        }}
        style={{ flex: "0 10 140px", width: 140, minWidth: 80, padding: "4px 8px", border: "1px solid var(--border)", borderRadius: 4,
          background: "transparent", color: "var(--foreground)", fontSize: 13 }} />
      <div style={{ minWidth: 0, flexShrink: 1, overflow: "hidden" }}>
        <BranchPicker hostId={hostId} projectId={projectId} value={baseBranch} onChange={setBaseBranch}
          label="Branch from:" placeholder="Default branch" />
      </div>
    </div>
  );
}
