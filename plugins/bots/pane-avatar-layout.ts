// Pure placement and state rules for the floating pane avatar.
import type { AvatarCorner } from "@arthurnw/bb-shared/bots";
// Type-only: the avatars entry pulls in .tsx files that node --test cannot load.
import type { AvatarState, StateThread } from "@arthurnw/bb-shared/avatars";

export const PANE_AVATAR_SIZE = 96;
export const PANE_AVATAR_MARGIN = 12;

/** Clockwise from the default, then off, for the context row's chip. */
const CYCLE: readonly AvatarCorner[] = ["top-right", "bottom-right", "bottom-left", "top-left", "off"];
export const nextCorner = (corner: AvatarCorner): AvatarCorner => CYCLE[(CYCLE.indexOf(corner) + 1) % CYCLE.length]!;

export interface Box { left: number; top: number; right: number; bottom: number }

/**
 * Viewport position of the avatar's top-left corner, or null when it should
 * not show: the corner is off or the pane is too small to hold it. The
 * composer is a centered column; a bottom corner sits above it only where the
 * two overlap. `composer` is the last box measured, which stands in while a
 * question or approval card replaces the composer.
 */
export function cornerPosition(corner: AvatarCorner, pane: Box, composer: Box | null): { left: number; top: number } | null {
  const size = PANE_AVATAR_SIZE, margin = PANE_AVATAR_MARGIN;
  if (corner === "off" || pane.right - pane.left < size + margin * 2 || pane.bottom - pane.top < size + margin * 2) return null;
  const left = corner.endsWith("left") ? pane.left + margin : pane.right - margin - size;
  if (corner.startsWith("top")) return { left, top: pane.top + margin };
  const bottom = composer && left < composer.right && left + size > composer.left ? composer.top : pane.bottom;
  return { left, top: Math.max(pane.top + margin, bottom - margin - size) };
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
