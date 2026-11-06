// Pure placement and state rules for the pane avatar.
import type { AvatarCorner } from "@arthurnw/bb-shared/bots";
// Type-only: the avatars entry pulls in .tsx files that node --test cannot load.
import type { AvatarState, StateThread } from "@arthurnw/bb-shared/avatars";

export const PANE_AVATAR_SIZE = 96;
export const PANE_AVATAR_MARGIN = 12;

export interface Box { left: number; top: number; right: number; bottom: number }

/**
 * Where the avatar sits in its pane, or null when it should not show: the
 * corner is off or the pane is too small to hold it. `side` is the edge it is
 * held to by CSS, so it follows the pane's width with no measuring; `top` is
 * from the pane's top edge. The composer is a centered column; a bottom corner
 * sits above it only where the two overlap. `composer` is the last box
 * measured, which stands in while a question or approval card replaces it.
 */
export function cornerPlacement(corner: AvatarCorner, pane: Box, composer: Box | null): { side: "left" | "right"; top: number } | null {
  const size = PANE_AVATAR_SIZE, margin = PANE_AVATAR_MARGIN;
  if (corner === "off" || pane.right - pane.left < size + margin * 2 || pane.bottom - pane.top < size + margin * 2) return null;
  const side = corner.endsWith("left") ? "left" : "right";
  if (corner.startsWith("top")) return { side, top: margin };
  const left = side === "left" ? pane.left + margin : pane.right - margin - size;
  const bottom = composer && left < composer.right && left + size > composer.left ? composer.top : pane.bottom;
  return { side, top: Math.max(margin, bottom - pane.top - margin - size) };
}

const WORKING = new Set(["starting", "active", "stopping"]);

/**
 * Waiting, then working, then unread, else idle. The sidebar's
 * `threadAvatarState` ranks unread above working; a pane showing the thread
 * itself puts a running turn first.
 */
export function paneAvatarState(thread: StateThread | undefined): AvatarState {
  if (!thread) return "idle";
  if (thread.hasPendingInteraction) return "waiting";
  if (WORKING.has(thread.status)) return "working";
  return thread.isUnread ? "unread" : "idle";
}
