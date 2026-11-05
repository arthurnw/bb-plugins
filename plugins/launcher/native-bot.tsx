// The Launcher's bot-and-model picker on bb's own New thread composer; bots come from the Bots plugin. The
// overlay has its own, so this stays out of composers the overlay embeds.
import { useComposer, useRpc, type ComposerSelection, type PluginComposerApi } from "@get-bb/plugin-sdk/app";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { quickComposeRpcContract } from "./server";
import { useBots } from "./bots-client";
import { BOT_MENTION_PLUGINS, BOTS_PLUGIN_ID, draftBotId, draftWithBot, type Bot } from "@arthurnw/bb-shared/bots";
import { BotAvatar, HOST_MODEL_PICKER, ModelList, modelLabel, ModelTrigger, projectShortcut, useModelSlot } from "@arthurnw/bb-shared/composer";
import type { ModelSelection, ModelState } from "@arthurnw/bb-shared/selection";

import { markEnvironmentApplied } from "./default-environment";
import { EXISTING_PROVIDER_ID } from "./existing-branch";
import { PROVIDER_ID } from "./named-worktree";

export const BOT_POPUP_ID = "bot";
const NATIVE_ATTR = "data-launcher-native-picker";

const isOverlay = (composer: PluginComposerApi) => composer.key.includes("launcher-");

// Picking a bot sets the native pickers, which bb also saves as the next
// thread's defaults. The values from before the first pick are kept per draft
// and put back after the thread is sent or the bot is removed. localStorage
// keeps them across the reload or navigation that often follows a send.
function stash(prefix: string) {
  const name = (key: string) => `bb-launcher:${prefix}:${key}`;
  return {
    get(key: string): ComposerSelection | undefined {
      try { const raw = localStorage.getItem(name(key)); return raw ? JSON.parse(raw) as ComposerSelection : undefined; } catch { return undefined; }
    },
    has: (key: string) => localStorage.getItem(name(key)) !== null,
    set: (key: string, value: ComposerSelection) => localStorage.setItem(name(key), JSON.stringify(value)),
    delete: (key: string) => localStorage.removeItem(name(key)),
  };
}
const saved = stash("bot-saved-selection");
// Set on submit; the next chip mount restores it when the send unmounted the chip first.
const pendingRestore = stash("bot-pending-restore");

function hostOf(selection: ComposerSelection | null) {
  const environment = selection?.environment;
  return environment?.type === "host" ? environment.hostId
    : environment?.type === "provider" && environment.machine?.type === "existing" ? environment.machine.hostId : undefined;
}

function selectionFor(bot: Bot, current: ComposerSelection | null): ComposerSelection {
  const hostId = hostOf(current);
  const machine = hostId ? { machine: { type: "existing" as const, hostId } } : {};
  const environment: ComposerSelection["environment"] =
    bot.environment === "named-worktree" ? { type: "provider", environmentProviderId: PROVIDER_ID, inputs: null, ...machine }
    : bot.environment === "existing-branch" ? { type: "provider", environmentProviderId: EXISTING_PROVIDER_ID, inputs: null, ...machine }
    : bot.environment === "checkout" && hostId ? { type: "host", hostId, workspace: { type: "unmanaged", path: null } }
    : undefined;
  return {
    ...(bot.projectId ? { projectId: bot.projectId } : {}),
    ...(environment ? { environment } : {}),
    ...(bot.model ? { providerId: bot.model.providerId, model: bot.model.model, reasoningLevel: bot.model.reasoningLevel, serviceTier: bot.model.serviceTier } : {}),
    ...(bot.permissionMode ? { permissionMode: bot.permissionMode } : {}),
  };
}

const restore = (composer: PluginComposerApi, selection: ComposerSelection) => composer.setSelection(selection);

async function chooseBot(composer: PluginComposerApi, bot: Bot | null) {
  const key = composer.key;
  composer.replace((draft) => draftWithBot(draft, bot, BOTS_PLUGIN_ID));
  if (!bot) {
    const previous = saved.get(key);
    saved.delete(key);
    if (previous) await restore(composer, previous).catch(() => {});
    return;
  }
  if (!saved.has(key) && composer.selection) saved.set(key, composer.selection);
  const next = selectionFor(bot, composer.selection);
  // Keep the Named worktree default from overriding the bot's environment after a project switch.
  if (next.projectId) markEnvironmentApplied(key, next.projectId);
  await composer.setSelection(next).catch(() => {});
}

function currentSelection(selection: ComposerSelection | null): ModelSelection | null {
  if (!selection?.providerId || !selection.model || !selection.reasoningLevel) return null;
  return { providerId: selection.providerId, model: selection.model, reasoningLevel: selection.reasoningLevel, serviceTier: selection.serviceTier ?? "default" };
}

function useModelState() {
  const rpc = useRpc<typeof quickComposeRpcContract>();
  const [state, setState] = useState<ModelState | null>(null);
  const load = () => { rpc.call("getModelState", {}).then(setState, () => {}); };
  useEffect(load, [rpc]);
  return { state, setState, rpc, reload: load };
}

/**
 * Replaces bb's model button on the New thread page with the Launcher's
 * trigger (bot and model), the same picker the overlay uses. Also finishes the
 * settings restore after a bot thread is sent.
 */
export function NativeModelTrigger() {
  const composer = useComposer();
  const bots = useBots();
  const { state } = useModelState();
  const anchor = useRef<HTMLSpanElement>(null);
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const key = composer.key;
  const own = !isOverlay(composer) && composer.scope.kind === "new-thread";
  const botId = draftBotId(composer.draft, BOT_MENTION_PLUGINS);
  const bot = botId ? bots?.find((item) => item.id === botId) ?? null : null;

  useEffect(() => {
    if (!own) return;
    const pending = pendingRestore.get(key);
    if (pending && !draftBotId(composer.draft, BOT_MENTION_PLUGINS)) {
      pendingRestore.delete(key);
      void restore(composer, pending).catch(() => {});
    }
    return composer.onSubmitted(() => {
      const previous = saved.get(key);
      if (!previous) return;
      saved.delete(key);
      pendingRestore.set(key, previous);
      void restore(composer, previous).then(() => pendingRestore.delete(key), () => {});
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
      if (projectShortcut(event, /Mac|iPhone|iPad/.test(navigator.platform)) !== "model") return;
      const target = event.target;
      // The picker's own search box sits outside the composer but should toggle it closed.
      const inPicker = target instanceof Element && target.matches("input[aria-label='Search bots and model presets']");
      if (!(target instanceof Node) || !(root.contains(target) || inPicker)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (inPicker) { composer.experimental_closePopup(); composer.focus(); } else composer.experimental_openPopup(BOT_POPUP_ID);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [own, shown, root, composer]);

  if (!own) return null;
  const selection = currentSelection(composer.selection);
  const label = state ? modelLabel(state.presets, selection, state.names, bot && { ...bot, emoji: "" }) : "";
  return (
    <span ref={anchor} data-launcher-model-trigger="" style={{ display: "contents" }}>
      {slot && state && <style>{`[${NATIVE_ATTR}] ${HOST_MODEL_PICKER} { display: none !important; }`}</style>}
      {slot && state && createPortal(
        <ModelTrigger icon={bot ? <BotAvatar bot={bot} size={16} /> : undefined} label={label} onClick={() => composer.experimental_openPopup(BOT_POPUP_ID)} />,
        slot)}
    </span>
  );
}

/** Bots, then presets, then Other model…, applied through bb's own pickers. */
export function NativeModelPopup() {
  const composer = useComposer();
  const bots = useBots();
  const { state, setState, rpc } = useModelState();
  const botId = draftBotId(composer.draft, BOT_MENTION_PLUGINS);
  const bot = botId ? bots?.find((item) => item.id === botId) ?? null : null;
  const close = () => { composer.experimental_closePopup(); composer.focus(); };
  if (!state || bots === null) return <div style={{ padding: "8px 12px", fontSize: 12, color: "var(--muted-foreground)" }}>Loading…</div>;
  return (
    <ModelList bots={[...bots]} bot={bot} names={state.names} presets={state.presets} selection={currentSelection(composer.selection)}
      onChooseBot={(next) => { composer.experimental_closePopup(); void chooseBot(composer, next).then(() => composer.focus()); }}
      onChoose={(selection, source) => {
        void composer.setSelection({ providerId: selection.providerId, model: selection.model, reasoningLevel: selection.reasoningLevel, serviceTier: selection.serviceTier }).catch(() => {});
        if (source === "preset") close();
      }}
      onSavePresets={async (presets) => { setState(await rpc.call("savePresets", { presets })); }}
      onClose={close} />
  );
}
