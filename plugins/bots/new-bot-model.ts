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

/** Scope directories from the editor text: one per line, trimmed, without blanks or repeats. */
export const parseScopeDirs = (text: string): string[] =>
  [...new Set(text.split("\n").map((line) => line.trim()).filter(Boolean))];
