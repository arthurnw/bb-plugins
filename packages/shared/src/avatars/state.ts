// Avatar state from bb's sidebar threads. The fields are a structural subset
// of PluginSidebarThread so this module needs no SDK import.

export const AVATAR_STATES = ["idle", "working", "unread", "waiting"] as const;
export type AvatarState = (typeof AVATAR_STATES)[number];

export interface StateThread { status: string; hasPendingInteraction: boolean; isUnread: boolean }

const WORKING = new Set(["starting", "active", "stopping"]);

/** Waiting (an approval or question), then unread, then working, else idle. */
export function threadAvatarState(thread: StateThread): AvatarState {
  if (thread.hasPendingInteraction) return "waiting";
  if (thread.isUnread) return "unread";
  return WORKING.has(thread.status) ? "working" : "idle";
}

/** The highest-priority state among a bot's threads. */
export function combinedAvatarState(threads: Iterable<StateThread>): AvatarState {
  let best = 0;
  for (const thread of threads) {
    best = Math.max(best, AVATAR_STATES.indexOf(threadAvatarState(thread)));
    if (best === AVATAR_STATES.length - 1) break;
  }
  return AVATAR_STATES[best]!;
}

/** Archived and hidden threads do not count toward a bot's state. */
export const liveThread = (thread: { isArchived: boolean; isHidden: boolean }) => !thread.isArchived && !thread.isHidden;
