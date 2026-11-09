// Pure placement and state rules for the pane avatar.
import type { AvatarCorner } from "@arthurnw/bb-shared/bots";
// Type-only: the avatars entry pulls in .tsx files that node --test cannot load.
import type { AvatarState, StateThread } from "@arthurnw/bb-shared/avatars";

export const PANE_AVATAR_SIZE = 96;
export const PANE_AVATAR_MARGIN = 12;

export interface Box { left: number; top: number; right: number; bottom: number }

/**
 * Where the avatar sits in its pane, or null when it should not show: the
 * corner is off or the pane is too small to hold it. `left` and `top` are
 * from the pane's top-left. The composer is a centered column, so the avatar
 * sits just outside its left or right edge, which keeps it near the chat and
 * moves it half as far as the pane edge when a panel opens. Where there is no
 * room beside the composer (or none is measured yet) it is held to the pane
 * edge, and a bottom corner there sits above the composer if they overlap.
 * `composer` is the last box measured, which stands in while a question or
 * approval card replaces it.
 */
export function cornerPlacement(corner: AvatarCorner, pane: Box, composer: Box | null): { left: number; top: number } | null {
  const size = PANE_AVATAR_SIZE, margin = PANE_AVATAR_MARGIN;
  if (corner === "off" || pane.right - pane.left < size + margin * 2 || pane.bottom - pane.top < size + margin * 2) return null;
  const isLeft = corner.endsWith("left");
  const minLeft = pane.left + margin, maxLeft = pane.right - margin - size;
  const beside = composer ? (isLeft ? composer.left - margin - size : composer.right + margin) : null;
  const inRoom = beside !== null && beside >= minLeft && beside <= maxLeft;
  const left = inRoom ? beside : isLeft ? minLeft : maxLeft;
  const rel = left - pane.left;
  if (corner.startsWith("top")) return { left: rel, top: margin };
  const bottom = composer && left < composer.right && left + size > composer.left ? composer.top : pane.bottom;
  return { left: rel, top: Math.max(margin, bottom - pane.top - margin - size) };
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
