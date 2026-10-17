// Constants shared by the server and the app. Kept apart from server.ts so the
// app bundle does not pull in server code.
import type { Layout } from "../server";

export const NOTE_COLORS = ["yellow", "blue", "green", "pink", "purple", "gray"] as const;

export const FRAME_COLORS = ["none", "blue", "green", "amber", "rose", "violet", "cyan", "slate"] as const;
export type FrameColor = (typeof FRAME_COLORS)[number];

/** How "rearrange" places a frame's cards. */
export const ARRANGE_STYLES = ["tree", "column", "row", "gridColumns", "gridRows"] as const;
export type ArrangeStyle = (typeof ARRANGE_STYLES)[number];

/** What the canvas draws frames around. */
export const GROUPINGS = ["project", "section", "machine"] as const;
export type Grouping = (typeof GROUPINGS)[number];

/** Realtime channel for `bb canvas open-url`; the Canvas page opens each URL in its browser panel. */
export const OPEN_URL_CHANNEL = "open-url";

/** Realtime channel the server publishes on after each layout write. */
export const LAYOUT_CHANGED = "layout-changed";

export function emptyLayout(): Layout {
  const empty = () => ({ positions: {}, notes: [], chats: [] });
  return { version: 2, arrangements: { project: empty(), section: empty(), machine: empty() }, frameColors: {} };
}
