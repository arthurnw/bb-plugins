import { useRealtime, useRpc, type PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import { useEffect, useSyncExternalStore, type CSSProperties } from "react";
import type { botsContract } from "./bots-server";
import { AVATAR_SIZE, botIconName, MAX_BOTS, type Bot } from "./bots";

type Face = Pick<Bot, "avatar" | "emoji" | "name">;

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

/** Image, else emoji, else the first letter of the name. */
export function BotAvatar({ bot, size, className }: { bot: Face | null | undefined; size?: number; className?: string }) {
  const box: CSSProperties = {
    display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none", borderRadius: "50%", overflow: "hidden",
    ...(size ? { width: size, height: size, fontSize: size * 0.7 } : { width: "1em", height: "1em" }), lineHeight: 1,
  };
  if (bot?.avatar) return <img src={bot.avatar} alt="" aria-hidden className={className} style={{ ...box, objectFit: "cover" }} />;
  if (bot?.emoji) return <span aria-hidden className={className} style={box}>{bot.emoji}</span>;
  const initial = bot?.name.trim().charAt(0).toUpperCase() || "?";
  return <span aria-hidden className={className} style={{ ...box, background: "var(--muted)", color: "var(--muted-foreground)", fontWeight: 600, fontSize: size ? size * 0.55 : "0.65em" }}>{initial}</span>;
}

function SlotIcon({ slot, className }: { slot: number; className?: string }) {
  const face = useSyncExternalStore(subscribe, snapshot, snapshot).get(slot);
  return <BotAvatar bot={face} className={className} />;
}

/** Keeps the slot icons current; mount once in an always-present surface. */
export function BotIconSync() {
  const rpc = useRpc<typeof botsContract>();
  const load = () => { rpc.call("listBots", {}).then(({ bots }) => setBots(bots), () => {}); };
  useEffect(load, [rpc]);
  useRealtime("bots", () => {
    load();
    // Canvas listens for this to reread bots and thread bindings.
    window.dispatchEvent(new Event("bb-launcher:bots-changed"));
  });
  return null;
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
