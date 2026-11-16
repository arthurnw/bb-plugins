// Pure rules for the New bot dialog.
import { GALLERY_IDS, galleryId, type Bot, type GalleryId } from "@arthurnw/bb-shared/bots";

/**
 * Avatars no active bot uses. A persona bot is always active; an initiative bot
 * is active while its coordinator thread is unarchived (`liveThreadIds`).
 */
export function freeAvatars(bots: readonly Pick<Bot, "avatar" | "coordinatorThreadId">[], liveThreadIds: ReadonlySet<string>): GalleryId[] {
  const used = new Set(bots
    .filter((bot) => bot.coordinatorThreadId === null || liveThreadIds.has(bot.coordinatorThreadId))
    .map((bot) => galleryId(bot.avatar)));
  return GALLERY_IDS.filter((id) => !used.has(id));
}

/** A random avatar from `free` other than `current`, falling back to every avatar when none is free. */
export function shuffleAvatar(free: readonly GalleryId[], current: GalleryId | null, random: () => number = Math.random): GalleryId {
  const pool = free.length > 0 ? free : GALLERY_IDS;
  const others = pool.filter((id) => id !== current);
  const from = others.length > 0 ? others : pool;
  return from[Math.floor(random() * from.length)]!;
}

/** Mod+Shift+K opens the worker model picker; Mod+Shift+M stays with the composer's own model picker. */
export const isWorkerShortcut = (event: { key: string; code: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; isComposing: boolean }, mac: boolean) =>
  !event.isComposing && event.shiftKey && !event.altKey && (mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey)
  && (event.code === "KeyK" || event.key.toLowerCase() === "k");
