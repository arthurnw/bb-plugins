import { experimental_useSidebarThreads as useSidebarThreads, useRealtime, useRpc, type PluginAppBuilder, type PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { useEffect, useState, useSyncExternalStore } from "react";
import { animatedImageType, BotAvatar, combinedAvatarState, liveThread, setAnimationFetcher, type AvatarState, type Face } from "@arthurnw/bb-shared/avatars";
import type { botsContract } from "./bots-server";
import { ANIMATION_MAX_BYTES, AVATAR_SIZE, botIconName, MAX_BOTS, type Bot } from "@arthurnw/bb-shared/bots";
import { notifyBotsChanged } from "@arthurnw/bb-shared/events";
import { LEGACY_GALLERY, legacyReassignments } from "./legacy-gallery";


// Icons are registered once at setup, so each fixed slot reads its bot from
// here. The same list backs the native composer's bot chip.
let faces = new Map<number, Face & { id: string }>();
let allBots: readonly Bot[] | null = null;
/** Each bot's combined avatar state; a bot with no live threads is absent (idle). */
let states: ReadonlyMap<string, AvatarState> = new Map();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
function setBots(bots: readonly Bot[]) {
  allBots = bots;
  faces = new Map(bots.map((bot) => [bot.avatarSlot, { id: bot.id, avatar: bot.avatar, avatarAnimation: bot.avatarAnimation, emoji: bot.emoji, name: bot.name }]));
  notify();
}
function setStates(next: ReadonlyMap<string, AvatarState>) {
  if (next.size === states.size && [...next].every(([id, state]) => states.get(id) === state)) return;
  states = next;
  notify();
}
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => faces;
const botsSnapshot = () => allBots;
const statesSnapshot = () => states;
/** Every bot, kept current by `BotIconSync`; null until the first load. */
export const useBots = () => useSyncExternalStore(subscribe, botsSnapshot, botsSnapshot);
/** Bot id → combined state of its live threads: waiting, then unread, then working, else idle. */
export const useBotStates = () => useSyncExternalStore(subscribe, statesSnapshot, statesSnapshot);
export const useBotState = (botId: string | null | undefined): AvatarState => {
  const all = useBotStates();
  return (botId && all.get(botId)) || "idle";
};

function SlotIcon({ slot, className }: { slot: number; className?: string }) {
  const face = useSyncExternalStore(subscribe, snapshot, snapshot).get(slot);
  return <BotAvatar bot={face} className={className} state={useBotState(face?.id)} />;
}

/** Thread id → bot id for live bots, refreshed on every Bots change. */
export function useThreadBots(): Record<string, string> {
  const rpc = useRpc<typeof botsContract>();
  const [threads, setThreads] = useState<Record<string, string>>({});
  const load = () => { rpc.call("threadBots", {}).then((result) => setThreads(result.threads), () => {}); };
  useEffect(load, [rpc]);
  useRealtime("bots", load);
  return threads;
}

/** Keeps the slot icons and bot states current; mount once in an always-present surface. */
export function BotIconSync() {
  const rpc = useRpc<typeof botsContract>();
  const sidebar = useSidebarThreads();
  const threadBots = useThreadBots();
  useEffect(() => {
    const byBot = new Map<string, PluginSidebarThread[]>();
    for (const thread of sidebar.threads) {
      const botId = threadBots[thread.id];
      if (botId && liveThread(thread)) byBot.set(botId, [...(byBot.get(botId) ?? []), thread]);
    }
    setStates(new Map([...byBot].map(([botId, threads]) => [botId, combinedAvatarState(threads)])));
  }, [sidebar.threads, threadBots]);
  const load = () => {
    rpc.call("listBots", {}).then(({ bots }) => {
      setBots(bots);
      void migrateLegacyAvatars(bots, (botId, avatar) => rpc.call("setBotAvatar", { botId, avatar }));
    }, () => {});
  };
  useEffect(load, [rpc]);
  useEffect(() => setAnimationFetcher((botId) => rpc.call("getBotAvatarAnimation", { botId }).then((result) => result.animation)), [rpc]);
  useRealtime("bots", () => {
    load();
    // Canvas and the Launcher's picker listen for this to reread bots and thread bindings.
    notifyBotsChanged();
  });
  return null;
}

const MIGRATED_KEY = "bb-bots:legacy-avatars-migrated";
let migrating = false;

/**
 * Once per browser profile, gives bots that still show a pick from the old
 * still gallery the matching animated avatar. A pick is recognized by
 * rasterizing the old SVGs the same way the picker did; if the browser's WebP
 * encoder has changed since, nothing matches and the old image stays.
 */
async function migrateLegacyAvatars(bots: readonly Bot[], setAvatar: (botId: string, avatar: string) => Promise<unknown>) {
  if (migrating || localStorage.getItem(MIGRATED_KEY)) return;
  migrating = true;
  try {
    let failed = false;
    if (bots.some((bot) => bot.avatar?.startsWith("data:"))) {
      const rasterized = new Map<string, string>();
      for (const item of LEGACY_GALLERY) {
        try { rasterized.set(item.id, await avatarFromUrl(svgDataUrl(item.svg))); } catch { /* no match for this one */ }
      }
      const results = await Promise.allSettled(legacyReassignments(bots, rasterized).map(({ botId, avatar }) => setAvatar(botId, avatar)));
      failed = results.some((result) => result.status === "rejected");
    }
    if (!failed) localStorage.setItem(MIGRATED_KEY, "1");
  } finally { migrating = false; }
}

export function registerBotIcons(app: PluginAppBuilder) {
  for (let slot = 0; slot < MAX_BOTS; slot++) {
    app.experimental_icons.register({ name: botIconName(slot), component: ({ className }) => <SlotIcon slot={slot} className={className} /> });
  }
}

export const svgDataUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/**
 * Center-crops an image (any format the browser draws, SVG included) to a
 * square and encodes it as a small WebP data URL (PNG where WebP is unsupported).
 */
export async function avatarFromUrl(url: string): Promise<string> {
  const image = new Image();
  image.src = url;
  try { await image.decode(); }
  catch { throw new Error("That file could not be read as an image."); }
  // An SVG without width/height reports 0; draw it at the output size.
  const width = image.naturalWidth || AVATAR_SIZE;
  const height = image.naturalHeight || AVATAR_SIZE;
  const side = Math.min(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = AVATAR_SIZE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot resize images.");
  context.imageSmoothingQuality = "high";
  context.drawImage(image, (width - side) / 2, (height - side) / 2, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  return canvas.toDataURL("image/webp", 0.85);
}

/**
 * A still avatar from any image. An animated GIF, WebP, or APNG is also kept as
 * uploaded, with the still as its first frame.
 */
export async function avatarFromFile(file: File): Promise<{ avatar: string; animation: string | null }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = animatedImageType(bytes);
  if (type && bytes.length > ANIMATION_MAX_BYTES) {
    throw new Error(`That animation is ${(bytes.length / 1024 / 1024).toFixed(1)} MB; animated avatars are limited to 1 MB. Export it smaller, shorter, or with fewer colors.`);
  }
  const url = URL.createObjectURL(file);
  try {
    // Canvas draws an animation's first frame.
    const avatar = await avatarFromUrl(url);
    return { avatar, animation: type && await readDataUrl(new Blob([bytes], { type })) };
  } finally { URL.revokeObjectURL(url); }
}

function readDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("That file could not be read."));
    reader.readAsDataURL(blob);
  });
}

export { BotAvatar };
