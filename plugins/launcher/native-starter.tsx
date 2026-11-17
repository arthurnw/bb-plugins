// The Launcher's Starter-and-model picker on bb's own New thread composer. The
// overlay has its own, so this stays out of composers the overlay embeds.
import { useComposer, useRpc, type ComposerSelection, type PluginComposerApi } from "@get-bb/plugin-sdk/app";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { quickComposeRpcContract } from "./server";
import { HOST_MODEL_PICKER, ModelList, modelLabel, ModelTrigger, projectShortcut, useModelSlot, type PickerStarter } from "@arthurnw/bb-shared/composer";
import type { ModelSelection, ModelState } from "@arthurnw/bb-shared/selection";
import { markEnvironmentApplied } from "./default-environment";
import { EXISTING_PROVIDER_ID } from "./existing-branch";
import { PROVIDER_ID } from "./named-worktree";
import { useStarters } from "./starters-client";
import { STARTER_METADATA_KEY, type Starter } from "./starters";

export const STARTER_POPUP_ID = "starter";
const NATIVE_ATTR = "data-launcher-native-picker";

const isOverlay = (composer: PluginComposerApi) => composer.key.includes("launcher-");

// Kept per draft in localStorage, so a reload or the navigation that often
// follows a send does not lose them: the Starter picked for a draft, and the
// picker values from before the first pick, put back after the thread is sent
// or the Starter is removed (picking one sets bb's pickers, which bb also saves
// as the next thread's defaults).
function stash<T>(prefix: string) {
  const name = (key: string) => `bb-launcher:${prefix}:${key}`;
  return {
    get(key: string): T | undefined {
      try { const raw = localStorage.getItem(name(key)); return raw ? JSON.parse(raw) as T : undefined; } catch { return undefined; }
    },
    has: (key: string) => localStorage.getItem(name(key)) !== null,
    set: (key: string, value: T) => localStorage.setItem(name(key), JSON.stringify(value)),
    delete: (key: string) => localStorage.removeItem(name(key)),
  };
}
const saved = stash<ComposerSelection>("bot-saved-selection");
// Set on submit; the next mount restores it when the send unmounted the trigger first.
const pendingRestore = stash<ComposerSelection>("bot-pending-restore");
const chosen = stash<string>("starter");
const chosenListeners = new Set<() => void>();
const notifyChosen = () => chosenListeners.forEach((listener) => listener());
const useChosen = (key: string) => useSyncExternalStore(
  (listener) => { chosenListeners.add(listener); return () => { chosenListeners.delete(listener); }; },
  () => chosen.get(key) ?? null);
function setChosen(key: string, starterId: string | null) {
  if (starterId) chosen.set(key, starterId);
  else chosen.delete(key);
  notifyChosen();
}

function hostOf(selection: ComposerSelection | null) {
  const environment = selection?.environment;
  return environment?.type === "host" ? environment.hostId
    : environment?.type === "provider" && environment.machine?.type === "existing" ? environment.machine.hostId : undefined;
}

function selectionFor(starter: Starter, current: ComposerSelection | null): ComposerSelection {
  const hostId = hostOf(current);
  const machine = hostId ? { machine: { type: "existing" as const, hostId } } : {};
  const environment: ComposerSelection["environment"] =
    starter.environment === "named-worktree" ? { type: "provider", environmentProviderId: PROVIDER_ID, inputs: null, ...machine }
    : starter.environment === "existing-branch" ? { type: "provider", environmentProviderId: EXISTING_PROVIDER_ID, inputs: null, ...machine }
    : starter.environment === "checkout" && hostId ? { type: "host", hostId, workspace: { type: "unmanaged", path: null } }
    : undefined;
  return {
    ...(starter.projectId ? { projectId: starter.projectId } : {}),
    ...(environment ? { environment } : {}),
    ...(starter.model ? { providerId: starter.model.providerId, model: starter.model.model, reasoningLevel: starter.model.reasoningLevel, serviceTier: starter.model.serviceTier } : {}),
    ...(starter.permissionMode ? { permissionMode: starter.permissionMode } : {}),
  };
}

async function chooseStarter(composer: PluginComposerApi, starter: Starter | null) {
  const key = composer.key;
  setChosen(key, starter?.id ?? null);
  if (!starter) {
    const previous = saved.get(key);
    saved.delete(key);
    if (previous) await composer.setSelection(previous).catch(() => {});
    return;
  }
  if (!saved.has(key) && composer.selection) saved.set(key, composer.selection);
  const next = selectionFor(starter, composer.selection);
  // Keep the Named worktree default from overriding the Starter's environment after a project switch.
  if (next.projectId) markEnvironmentApplied(key, next.projectId);
  await composer.setSelection(next).catch(() => {});
  if (starter.starterPrompt && composer.isEmpty) composer.replace({ text: starter.starterPrompt, mentions: [] });
}

function currentSelection(selection: ComposerSelection | null): ModelSelection | null {
  if (!selection?.providerId || !selection.model || !selection.reasoningLevel) return null;
  return { providerId: selection.providerId, model: selection.model, reasoningLevel: selection.reasoningLevel, serviceTier: selection.serviceTier ?? "default" };
}

function useModelState() {
  const rpc = useRpc<typeof quickComposeRpcContract>();
  const [state, setState] = useState<ModelState | null>(null);
  useEffect(() => { rpc.call("getModelState", {}).then(setState, () => {}); }, [rpc]);
  return { state, setState, rpc };
}

const MAC = /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * Replaces bb's model button on the New thread page with the Launcher's
 * trigger (Starter and model), the picker the overlay uses. While a Starter is
 * chosen, sending goes through `composer.submit` so the Starter reaches the
 * Launcher's dispatch hook; nothing in the message shows it.
 */
export function NativeModelTrigger() {
  const composer = useComposer();
  const starters = useStarters();
  const { state } = useModelState();
  const anchor = useRef<HTMLSpanElement>(null);
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const key = composer.key;
  const own = !isOverlay(composer) && composer.scope.kind === "new-thread";
  const starterId = useChosen(key);
  const starter = starterId ? starters?.find((item) => item.id === starterId) ?? null : null;

  useEffect(() => {
    if (!own) return;
    const pending = pendingRestore.get(key);
    if (pending && !chosen.has(key)) {
      pendingRestore.delete(key);
      void composer.setSelection(pending).catch(() => {});
    }
    return composer.onSubmitted(() => {
      setChosen(key, null);
      const previous = saved.get(key);
      if (!previous) return;
      saved.delete(key);
      pendingRestore.set(key, previous);
      void composer.setSelection(previous).then(() => pendingRestore.delete(key), () => {});
    });
  }, [composer, key, own]);

  // Mark this composer so the stylesheet hides only its own host model button.
  useEffect(() => {
    if (!own) return;
    const form = anchor.current?.closest<HTMLElement>("form[data-promptbox]") ?? null;
    form?.setAttribute(NATIVE_ATTR, "");
    setRoot(form);
    return () => { form?.removeAttribute(NATIVE_ATTR); setRoot(null); };
  }, [own]);
  const slot = useModelSlot(root, own && state !== null);

  // bb's own Mod+Shift+M toggles its model picker, which this trigger hides.
  // While the trigger is shown, the shortcut opens this picker instead, in the
  // composer that holds the caret.
  const shown = slot !== null && state !== null;
  useEffect(() => {
    if (!own || !shown || !root) return;
    const onKey = (event: KeyboardEvent) => {
      if (projectShortcut(event, MAC) !== "model") return;
      const target = event.target;
      // The picker's own search box sits outside the composer but should toggle it closed.
      const inPicker = target instanceof Element && target.matches("input[aria-label='Search starters and model presets']");
      if (!(target instanceof Node) || !(root.contains(target) || inPicker)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (inPicker) { composer.experimental_closePopup(); composer.focus(); } else composer.experimental_openPopup(STARTER_POPUP_ID);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [own, shown, root, composer]);

  // Sends carry the Starter. bb's composer has no submit hook, so its form
  // submit (the send button) and Enter are taken over and resubmitted with the
  // Starter as `experimental_data`.
  const resubmitting = useRef(false);
  useEffect(() => {
    if (!own || !root || !starterId) return;
    const send = (event: Event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      resubmitting.current = true;
      composer.submit({ experimental_data: { [STARTER_METADATA_KEY]: starterId } }).catch(() => {}).finally(() => { resubmitting.current = false; });
    };
    const onSubmit = (event: Event) => {
      if (resubmitting.current || event.target !== root) return;
      send(event);
    };
    const onKey = (event: KeyboardEvent) => {
      if (resubmitting.current || event.key !== "Enter" || event.isComposing || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return;
      if (!(event.target instanceof Element) || !event.target.closest("[data-promptbox-editor-content]") || !root.contains(event.target)) return;
      // Enter picks from bb's @-mention and command menus.
      if (root.querySelector("[data-promptbox-typeahead-menu]") || document.querySelector("[data-promptbox-typeahead-menu]")) return;
      if (composer.isSubmittingBlocked) return;
      send(event);
    };
    window.addEventListener("submit", onSubmit, true);
    window.addEventListener("keydown", onKey, true);
    return () => { window.removeEventListener("submit", onSubmit, true); window.removeEventListener("keydown", onKey, true); };
  }, [own, root, starterId, composer]);

  if (!own) return null;
  const selection = currentSelection(composer.selection);
  const label = state ? modelLabel(state.presets, selection, state.names, starter) : "";
  return (
    <span ref={anchor} data-launcher-model-trigger="" style={{ display: "contents" }}>
      {slot && state && <style>{`[${NATIVE_ATTR}] ${HOST_MODEL_PICKER} { display: none !important; }`}</style>}
      {slot && state && createPortal(<ModelTrigger label={label} onClick={() => composer.experimental_openPopup(STARTER_POPUP_ID)} />, slot)}
    </span>
  );
}

/** Starters, then presets, then Other model…, applied through bb's own pickers. */
export function NativeModelPopup() {
  const composer = useComposer();
  const starters = useStarters();
  const { state, setState, rpc } = useModelState();
  const starterId = useChosen(composer.key);
  const starter = starterId ? starters?.find((item) => item.id === starterId) ?? null : null;
  const close = () => { composer.experimental_closePopup(); composer.focus(); };
  if (!state || starters === null) return <div style={{ padding: "8px 12px", fontSize: 12, color: "var(--muted-foreground)" }}>Loading…</div>;
  return (
    <ModelList starters={starters} starter={starter} names={state.names} presets={state.presets} selection={currentSelection(composer.selection)}
      onChooseStarter={(next: PickerStarter | null) => {
        composer.experimental_closePopup();
        void chooseStarter(composer, next && (starters.find((item) => item.id === next.id) ?? null)).then(() => composer.focus());
      }}
      onChoose={(selection, source) => {
        void composer.setSelection({ providerId: selection.providerId, model: selection.model, reasoningLevel: selection.reasoningLevel, serviceTier: selection.serviceTier }).catch(() => {});
        if (source === "preset") close();
      }}
      onSavePresets={async (presets) => { setState(await rpc.call("savePresets", { presets })); }}
      onClose={close} />
  );
}
