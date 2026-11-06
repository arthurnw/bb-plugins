// The Bots plugin's bots, read through its RPC. Pure helpers; the hook
// that loads them is in launcher.ts.
import type { Grouping } from "./shared.ts";

export interface LauncherBot {
  id: string;
  name: string;
  emoji: string;
  /** A square image as a data URL. */
  avatar: string | null;
  /** The animated upload's version; the bytes come from Bots' getBotAvatarAnimation. */
  avatarAnimation: string | null;
}

/** "loading" until the first read; "unavailable" when Bots isn't installed or running. */
export type LauncherBots =
  | { status: "loading" | "unavailable" }
  | { status: "ready"; bots: LauncherBot[]; threadBots: Record<string, string> };

/** The groupings to offer: the bot grouping only with Bots. */
export function availableGroupings(all: readonly Grouping[], launcher: LauncherBots["status"]): Grouping[] {
  return launcher === "unavailable" ? all.filter((grouping) => grouping !== "bot") : [...all];
}

/** The stored grouping, or project when it is the bot grouping and Bots is gone. */
export function effectiveGrouping(stored: Grouping, launcher: LauncherBots["status"]): Grouping {
  return stored === "bot" && launcher === "unavailable" ? "project" : stored;
}

/**
 * Threads whose bot differs between two reads, so their stored spot in the bot
 * grouping (made while they sat in another frame) can be dropped. A thread
 * often shows up before Bots records its binding.
 */
export function rebound(previous: Record<string, string>, next: Record<string, string>, threadIds: Iterable<string>): string[] {
  return [...threadIds].filter((id) => (previous[id] ?? null) !== (next[id] ?? null));
}
