// The Launcher plugin's bots, read through its RPC. Pure helpers; the hook
// that loads them is in launcher.ts.
import type { Grouping } from "./shared.ts";

export const LAUNCHER_PLUGIN_ID = "launcher";
/** The Launcher dispatches this on window after its bots or thread bindings change. */
export const BOTS_CHANGED_EVENT = "bb-launcher:bots-changed";

export interface LauncherBot {
  id: string;
  name: string;
  emoji: string;
  /** A square image as a data URL. */
  avatar: string | null;
}

/** "loading" until the first read; "unavailable" when the Launcher isn't installed or running. */
export type LauncherBots =
  | { status: "loading" | "unavailable" }
  | { status: "ready"; bots: LauncherBot[]; threadBots: Record<string, string> };

/** The groupings to offer: the bot grouping only with the Launcher. */
export function availableGroupings(all: readonly Grouping[], launcher: LauncherBots["status"]): Grouping[] {
  return launcher === "unavailable" ? all.filter((grouping) => grouping !== "bot") : [...all];
}

/** The stored grouping, or project when it is the bot grouping and the Launcher is gone. */
export function effectiveGrouping(stored: Grouping, launcher: LauncherBots["status"]): Grouping {
  return stored === "bot" && launcher === "unavailable" ? "project" : stored;
}

/**
 * Threads whose bot differs between two reads, so their stored spot in the bot
 * grouping (made while they sat in another frame) can be dropped. A thread
 * often shows up before the Launcher records its binding.
 */
export function rebound(previous: Record<string, string>, next: Record<string, string>, threadIds: Iterable<string>): string[] {
  return [...threadIds].filter((id) => (previous[id] ?? null) !== (next[id] ?? null));
}
