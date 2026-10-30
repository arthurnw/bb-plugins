import { useComposer, useSettings } from "@get-bb/plugin-sdk/app";
import { useEffect } from "react";
import { PROVIDER_ID } from "./named-worktree";

// Composers already defaulted in this page session, so a later manual choice sticks.
const applied = new Set<string>();

/** Seeds Named worktree as the environment of bb's own New thread composers. */
export function DefaultEnvironment() {
  const composer = useComposer();
  const { values } = useSettings();
  const enabled = values?.defaultNamedWorktree === true;
  const projectId = composer.selection?.projectId;
  const environment = composer.selection?.environment;
  const key = composer.key;
  // The overlay seeds its own environment (a handoff reuses its thread's).
  const own = key.includes("launcher-");
  useEffect(() => {
    if (!enabled || own || composer.scope.kind !== "new-thread" || !projectId || !environment) return;
    const id = `${key}:${projectId}`;
    if (applied.has(id)) return;
    applied.add(id);
    if (environment.type === "provider" && environment.environmentProviderId === PROVIDER_ID) return;
    const hostId = environment.type === "host" ? environment.hostId
      : environment.type === "provider" && environment.machine?.type === "existing" ? environment.machine.hostId : undefined;
    composer.setSelection({
      environment: { type: "provider", environmentProviderId: PROVIDER_ID, inputs: null, ...(hostId ? { machine: { type: "existing", hostId } } : {}) },
    }).catch(() => {});
  }, [enabled, own, key, projectId, environment, composer]);
  return null;
}
