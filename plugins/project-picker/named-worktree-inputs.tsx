import { experimental_BranchPicker as BranchPicker, type PluginEnvironmentProviderInputsProps } from "@get-bb/plugin-sdk/app";
import { useEffect, useState } from "react";
import { branchNameError, inputsSchema } from "./named-worktree";

export function NamedWorktreeInputs(props: PluginEnvironmentProviderInputsProps) {
  const targetKey = props.target.kind === "existing-host" ? props.target.hostId : "new-host";
  return <Inputs key={`${props.projectId}:${targetKey}`} {...props} />;
}

function Inputs({ projectId, target, value, onChange }: PluginEnvironmentProviderInputsProps) {
  const parsed = inputsSchema.safeParse(value);
  const [name, setName] = useState(parsed.success ? parsed.data.name : "");
  const [baseBranch, setBaseBranch] = useState<string | null>(parsed.success ? parsed.data.baseBranch : null);
  const hostId = target.kind === "existing-host" ? target.hostId : null;
  useEffect(() => {
    const reason = branchNameError(name) ?? (baseBranch === null ? "Choose a base branch." : null);
    if (reason) onChange({ status: "blocked", reason });
    else onChange({ status: "ready", value: { name, baseBranch } });
  }, [name, baseBranch, onChange]);
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
      <input aria-label="New branch name" placeholder="arthur/" value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); event.stopPropagation(); }}
        style={{ width: 180, padding: "4px 8px", border: "1px solid var(--border)", borderRadius: 4,
          background: "transparent", color: "var(--foreground)", fontSize: 13 }} />
      <BranchPicker hostId={hostId} projectId={projectId} value={baseBranch} onChange={setBaseBranch}
        label="Branch from:" placeholder="Choose base branch" />
    </div>
  );
}
