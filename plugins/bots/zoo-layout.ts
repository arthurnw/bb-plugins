// Pure rules for the bot zoo: ranking, labels, and the floating card's placement.
import { z } from "zod";
import { threadAvatarState, type AvatarState, type StateThread } from "@arthurnw/bb-shared/avatars/state";

/** Most urgent first. Ties keep Bots order. */
export const URGENCY: Record<AvatarState, number> = { waiting: 0, unread: 1, working: 2, idle: 3 };

export interface ZooEntry<B> { bot: B; state: AvatarState }

/** Bots in Bots order with their states; a bot missing from `states` is idle. */
export function rankBots<B extends { id: string }>(bots: readonly B[], states: ReadonlyMap<string, AvatarState>): ZooEntry<B>[] {
  return bots.map((bot) => ({ bot, state: states.get(bot.id) ?? "idle" }));
}

/** The most urgent bot, the first one when every bot is idle; null with no bots. */
export function loudest<E extends { state: AvatarState }>(zoo: readonly E[]): E | null {
  let best: E | null = null;
  for (const entry of zoo) if (!best || URGENCY[entry.state] < URGENCY[best.state]) best = entry;
  return best;
}

/** Bots that need the user: waiting on a question or approval, or unread. */
export const attentionCount = (zoo: readonly { state: AvatarState }[]) =>
  zoo.filter((entry) => entry.state === "waiting" || entry.state === "unread").length;

/** Waiting, then unread, then working, then idle; order within a state is kept. */
export function threadsByUrgency<T extends StateThread>(threads: readonly T[]): T[] {
  return threads.map((thread, index) => ({ thread, index, rank: URGENCY[threadAvatarState(thread)] }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((item) => item.thread);
}

/** "Planner · 1 waiting, 2 working", or "Planner · idle". */
export function botSummary(name: string, threads: readonly StateThread[]): string {
  const counts = new Map<AvatarState, number>();
  for (const thread of threads) {
    const state = threadAvatarState(thread);
    counts.set(state, (counts.get(state) ?? 0) + 1);
  }
  const parts = (["waiting", "unread", "working"] as const).filter((state) => counts.get(state)).map((state) => `${counts.get(state)} ${state}`);
  return `${name} · ${parts.length ? parts.join(", ") : "idle"}`;
}

export const cardColumns = (count: number) => Math.min(4, Math.max(2, Math.ceil(Math.sqrt(count))));

// Placement, adapted from bb-office's floating widget: the card is held at an
// offset from its nearest window corner, so it grows away from that corner
// and stays put relative to it when the window resizes.

export const INSET = 16;
export const SNAP = 24;

export interface Size { width: number; height: number }
export interface Point { left: number; top: number }
/** `dx` and `dy` run from the window edges named by `h` and `v` to the card's matching edges. */
export interface Anchor { h: "left" | "right"; v: "top" | "bottom"; dx: number; dy: number }

export const DEFAULT_ANCHOR: Anchor = { h: "right", v: "bottom", dx: INSET, dy: 96 };

function bounds(viewport: number, item: number) {
  const room = Math.max(0, viewport - item);
  const min = Math.min(INSET, room);
  return { min, max: Math.max(min, room - INSET) };
}

const within = (value: number, { min, max }: { min: number; max: number }) => Math.min(Math.max(value, min), max);

/** Keeps the card inside the window, 16 px from its edges where it fits. */
export function clamp(point: Point, size: Size, viewport: Size): Point {
  return { left: within(point.left, bounds(viewport.width, size.width)), top: within(point.top, bounds(viewport.height, size.height)) };
}

/** Pulls the card onto the 16 px inset when it is dropped within 24 px of it. */
export function snap(point: Point, size: Size, viewport: Size): Point {
  const axis = (value: number, range: { min: number; max: number }) =>
    Math.abs(value - range.min) <= SNAP ? range.min : Math.abs(range.max - value) <= SNAP ? range.max : value;
  const clamped = clamp(point, size, viewport);
  return { left: axis(clamped.left, bounds(viewport.width, size.width)), top: axis(clamped.top, bounds(viewport.height, size.height)) };
}

/** The anchor for a card at `point`: the window corner nearest its center. */
export function anchorFromRect(point: Point, size: Size, viewport: Size): Anchor {
  const h = point.left + size.width / 2 < viewport.width / 2 ? "left" : "right";
  const v = point.top + size.height / 2 < viewport.height / 2 ? "top" : "bottom";
  return {
    h, v,
    dx: Math.max(0, h === "left" ? point.left : viewport.width - point.left - size.width),
    dy: Math.max(0, v === "top" ? point.top : viewport.height - point.top - size.height),
  };
}

/** Where a card of `size` held by `anchor` sits, clamped into the window. */
export function rectFromAnchor(anchor: Anchor, size: Size, viewport: Size): Point {
  return clamp({
    left: anchor.h === "left" ? anchor.dx : viewport.width - anchor.dx - size.width,
    top: anchor.v === "top" ? anchor.dy : viewport.height - anchor.dy - size.height,
  }, size, viewport);
}

// Stored per device in localStorage; anything unreadable falls back to defaults.

export interface ZooSettings { enabled: boolean; dockToPanel: boolean }
export interface ZooPlacement { anchor: Anchor; collapsed: boolean }

export const DEFAULT_SETTINGS: ZooSettings = { enabled: false, dockToPanel: true };
export const DEFAULT_PLACEMENT: ZooPlacement = { anchor: DEFAULT_ANCHOR, collapsed: false };

const settingsSchema = z.object({ enabled: z.boolean().catch(DEFAULT_SETTINGS.enabled), dockToPanel: z.boolean().catch(DEFAULT_SETTINGS.dockToPanel) });
const placementSchema = z.object({
  anchor: z.object({ h: z.enum(["left", "right"]), v: z.enum(["top", "bottom"]), dx: z.number().min(0), dy: z.number().min(0) }).catch(DEFAULT_ANCHOR),
  collapsed: z.boolean().catch(false),
});

function parse<T>(raw: string | null, schema: z.ZodType<T>, fallback: T): T {
  if (!raw) return fallback;
  try {
    const result = schema.safeParse(JSON.parse(raw));
    return result.success ? result.data : fallback;
  } catch { return fallback; }
}

export const parseZooSettings = (raw: string | null): ZooSettings => parse(raw, settingsSchema, DEFAULT_SETTINGS);
export const parseZooPlacement = (raw: string | null): ZooPlacement => parse(raw, placementSchema, DEFAULT_PLACEMENT);
