import { useRealtime, useRpc, type PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import { useEffect, useSyncExternalStore } from "react";
import { BotAvatar, type Face } from "@arthurnw/bb-shared/composer";
import type { botsContract } from "./bots-server";
import { AVATAR_SIZE, botIconName, MAX_BOTS, type Bot } from "@arthurnw/bb-shared/bots";
import { notifyBotsChanged } from "@arthurnw/bb-shared/events";
import { LEGACY_GALLERY, legacyReassignments } from "./legacy-gallery";


// Icons are registered once at setup, so each fixed slot reads its bot from
// here. The same list backs the native composer's bot chip.
let faces = new Map<number, Face>();
let allBots: readonly Bot[] | null = null;
const listeners = new Set<() => void>();
function setBots(bots: readonly Bot[]) {
  allBots = bots;
  faces = new Map(bots.map((bot) => [bot.avatarSlot, { avatar: bot.avatar, emoji: bot.emoji, name: bot.name }]));
  listeners.forEach((listener) => listener());
}
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => faces;
const botsSnapshot = () => allBots;
/** Every bot, kept current by `BotIconSync`; null until the first load. */
export const useBots = () => useSyncExternalStore(subscribe, botsSnapshot, botsSnapshot);

function SlotIcon({ slot, className }: { slot: number; className?: string }) {
  const face = useSyncExternalStore(subscribe, snapshot, snapshot).get(slot);
  return <BotAvatar bot={face} className={className} />;
}

/** Keeps the slot icons current; mount once in an always-present surface. */
export function BotIconSync() {
  const rpc = useRpc<typeof botsContract>();
  const load = () => {
    rpc.call("listBots", {}).then(({ bots }) => {
      setBots(bots);
      void migrateLegacyAvatars(bots, (botId, avatar) => rpc.call("setBotAvatar", { botId, avatar }));
    }, () => {});
  };
  useEffect(load, [rpc]);
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

export async function avatarFromFile(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try { return await avatarFromUrl(url); }
  finally { URL.revokeObjectURL(url); }
}

export { BotAvatar };
