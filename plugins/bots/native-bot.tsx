// A Bot chip on bb's own New thread composer, for when the Launcher's
// bot-and-model picker is not installed. The Launcher's picker already lists
// bots, so this hides itself whenever that picker is mounted.
import { useComposer, type ComposerSelection, type PluginComposerApi } from "@get-bb/plugin-sdk/app";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BotAvatar, useBots } from "./bot-avatars";
import { BOT_MENTION_PLUGINS, BOTS_PLUGIN_ID, botLabel, draftBotId, draftWithBot, type Bot } from "@arthurnw/bb-shared/bots";
import { environmentFor, ModelList, ModelTrigger, useModelSlot } from "@arthurnw/bb-shared/composer";
import { useLauncher } from "./launcher-models";

export const BOT_POPUP_ID = "bot-chip";
/** Set by the Launcher on its own picker's anchor. */
const LAUNCHER_PICKER = "[data-launcher-model-trigger]";

// Composers the Launcher overlay and Bots' dialog embed have their own picker.
const isDialog = (composer: PluginComposerApi) => composer.key.includes("launcher-") || composer.key.includes("bots-");

// Picking a bot sets the native pickers, which bb also saves as the next
// thread's defaults. The values from before the first pick are kept per draft
// and put back after the thread is sent or the bot is removed. localStorage
// keeps them across the reload or navigation that often follows a send.
function stash(prefix: string) {
  const name = (key: string) => `bb-bots:${prefix}:${key}`;
  return {
    get(key: string): ComposerSelection | undefined {
      try { const raw = localStorage.getItem(name(key)); return raw ? JSON.parse(raw) as ComposerSelection : undefined; } catch { return undefined; }
    },
    has: (key: string) => localStorage.getItem(name(key)) !== null,
    set: (key: string, value: ComposerSelection) => localStorage.setItem(name(key), JSON.stringify(value)),
    delete: (key: string) => localStorage.removeItem(name(key)),
  };
}
const saved = stash("saved-selection");
// Set on submit; the next chip mount restores it when the send unmounted the chip first.
const pendingRestore = stash("pending-restore");

function hostOf(selection: ComposerSelection | null) {
  const environment = selection?.environment;
  return environment?.type === "host" ? environment.hostId
    : environment?.type === "provider" && environment.machine?.type === "existing" ? environment.machine.hostId : undefined;
}

// Named worktrees and existing branches are the Launcher's providers, so without it only the checkout applies.
function selectionFor(bot: Bot, current: ComposerSelection | null, launcher: boolean): ComposerSelection {
  const environment = environmentFor(bot.environment, hostOf(current) ?? null, launcher);
  return {
    ...(bot.projectId ? { projectId: bot.projectId } : {}),
    ...(environment ? { environment } : {}),
    ...(bot.model ? { providerId: bot.model.providerId, model: bot.model.model, reasoningLevel: bot.model.reasoningLevel, serviceTier: bot.model.serviceTier } : {}),
    ...(bot.permissionMode ? { permissionMode: bot.permissionMode } : {}),
  };
}

const restore = (composer: PluginComposerApi, selection: ComposerSelection) => composer.setSelection(selection);

async function chooseBot(composer: PluginComposerApi, bot: Bot | null, launcher: boolean) {
  const key = composer.key;
  composer.replace((draft) => draftWithBot(draft, bot, BOTS_PLUGIN_ID));
  if (!bot) {
    const previous = saved.get(key);
    saved.delete(key);
    if (previous) await restore(composer, previous).catch(() => {});
    return;
  }
  if (!saved.has(key) && composer.selection) saved.set(key, composer.selection);
  await composer.setSelection(selectionFor(bot, composer.selection, launcher)).catch(() => {});
}

function useLauncherPicker(form: HTMLElement | null) {
  const [present, setPresent] = useState(false);
  useEffect(() => {
    if (!form) { setPresent(false); return; }
    const check = () => setPresent(form.querySelector(LAUNCHER_PICKER) !== null);
    check();
    const observer = new MutationObserver(check);
    observer.observe(form, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-launcher-model-trigger"] });
    return () => observer.disconnect();
  }, [form]);
  return present;
}

/** The Bot chip beside bb's model button. Also finishes the settings restore after a bot thread is sent. */
export function BotChip() {
  const composer = useComposer();
  const bots = useBots();
  const anchor = useRef<HTMLSpanElement>(null);
  const [form, setForm] = useState<HTMLElement | null>(null);
  const key = composer.key;
  const own = !isDialog(composer) && composer.scope.kind === "new-thread";
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

  useEffect(() => {
    if (!own) return;
    const element = anchor.current?.closest<HTMLElement>("form[data-promptbox]") ?? null;
    setForm(element);
    return () => setForm(null);
  }, [own]);
  const launcherPicker = useLauncherPicker(form);
  const slot = useModelSlot(form, own && !launcherPicker && (bots?.length ?? 0) > 0);

  if (!own) return null;
  return (
    <span ref={anchor} style={{ display: "contents" }}>
      {slot && createPortal(
        <ModelTrigger icon={bot ? <BotAvatar bot={bot} size={16} /> : undefined} label={bot ? botLabel({ ...bot, emoji: "" }) : "Bot"}
          onClick={() => composer.experimental_openPopup(BOT_POPUP_ID)} />,
        slot)}
    </span>
  );
}

export function BotPopup() {
  const composer = useComposer();
  const bots = useBots();
  const launcher = useLauncher().status === "present";
  const botId = draftBotId(composer.draft, BOT_MENTION_PLUGINS);
  const bot = botId ? bots?.find((item) => item.id === botId) ?? null : null;
  const close = () => { composer.experimental_closePopup(); composer.focus(); };
  if (bots === null) return <div style={{ padding: "8px 12px", fontSize: 12, color: "var(--muted-foreground)" }}>Loading…</div>;
  return <ModelList hideModels bots={[...bots]} bot={bot} onClose={close}
    onChooseBot={(next) => { composer.experimental_closePopup(); void chooseBot(composer, next, launcher).then(() => composer.focus()); }} />;
}
