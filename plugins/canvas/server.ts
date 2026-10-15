// bb-plugin-canvas backend: stores the canvas arrangement (card positions,
// sticky notes, frame colors) so it survives reloads and is shared by every
// open window. Thread data itself comes from bb's live thread list in the app.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { FRAME_COLORS, GROUPINGS, NOTE_COLORS } from "./canvas/shared.ts";

const pointSchema = z.object({ x: z.number().finite(), y: z.number().finite() });

const noteSchema = z.object({
  id: z.string().min(1).max(64),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().min(80).max(2000),
  height: z.number().finite().min(60).max(2000),
  text: z.string().max(20_000),
  color: z.enum(NOTE_COLORS),
});
export type Note = z.infer<typeof noteSchema>;
const groupingSchema = z.enum(GROUPINGS);

/** A thread's chat pinned to the canvas, in canvas coordinates. */
const pinnedChatSchema = z.object({
  threadId: z.string().min(1).max(64),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().min(240).max(2400),
  height: z.number().finite().min(160).max(2400),
  minimized: z.boolean(),
  /** Moves with its card, keeping their offset, when either is dragged. */
  linked: z.boolean().default(false),
});
export type PinnedChat = z.infer<typeof pinnedChatSchema>;

/** Each grouping keeps its own arrangement, so switching never scrambles another. */
const arrangementSchema = z.object({
  positions: z.record(z.string(), pointSchema),
  notes: z.array(noteSchema),
  chats: z.array(pinnedChatSchema).default([]),
});
export type Arrangement = z.infer<typeof arrangementSchema>;

const layoutSchema = z.object({
  version: z.literal(2),
  arrangements: z.object({
    project: arrangementSchema,
    section: arrangementSchema,
    machine: arrangementSchema,
  }),
  /** Keyed by `<grouping>:<group key>`. */
  frameColors: z.record(z.string(), z.enum(FRAME_COLORS)),
});
export type Layout = z.infer<typeof layoutSchema>;

/** The first release stored one project arrangement at the top level. */
const legacyLayoutSchema = z.object({
  positions: z.record(z.string(), pointSchema),
  notes: z.array(noteSchema),
  frameColors: z.record(z.string(), z.enum(FRAME_COLORS)),
});

const emptyArrangement = (): Arrangement => ({ positions: {}, notes: [], chats: [] });
function emptyLayout(): Layout {
  return {
    version: 2,
    arrangements: { project: emptyArrangement(), section: emptyArrangement(), machine: emptyArrangement() },
    frameColors: {},
  };
}

function parseLayout(raw: unknown): Layout {
  const current = layoutSchema.safeParse(raw);
  if (current.success) return current.data;
  const legacy = legacyLayoutSchema.safeParse(raw);
  if (!legacy.success) return emptyLayout();
  const layout = emptyLayout();
  layout.arrangements.project = { positions: legacy.data.positions, notes: legacy.data.notes, chats: [] };
  for (const [projectId, color] of Object.entries(legacy.data.frameColors)) {
    layout.frameColors[`project:${projectId}`] = color;
  }
  return layout;
}

/** Every write carries the writer's client id so it can skip its own echo. */
const origin = z.string().max(64);
const ok = z.object({ ok: z.literal(true) });

export const rpcContract = defineRpcContract({
  layout_get: { input: z.null(), output: layoutSchema },
  /** Replaces the whole arrangement; undo and redo restore snapshots with it. */
  layout_set: { input: z.object({ origin, layout: layoutSchema }), output: ok },
  positions_set: {
    input: z.object({
      origin,
      grouping: groupingSchema,
      positions: z.record(z.string(), pointSchema.nullable()),
      /** Drop the grouping's stored positions first (auto-arrange). */
      replace: z.boolean().optional(),
    }),
    output: ok,
  },
  note_upsert: { input: z.object({ origin, grouping: groupingSchema, note: noteSchema }), output: ok },
  note_delete: { input: z.object({ origin, grouping: groupingSchema, id: z.string() }), output: ok },
  chat_upsert: { input: z.object({ origin, grouping: groupingSchema, chat: pinnedChatSchema }), output: ok },
  chat_delete: { input: z.object({ origin, grouping: groupingSchema, threadId: z.string() }), output: ok },
  frame_color_set: {
    input: z.object({ origin, frameKey: z.string().max(200), color: z.enum(FRAME_COLORS) }),
    output: ok,
  },
});

export const LAYOUT_CHANGED = "layout-changed";
const KEY = "layout";
const MAX_NOTES = 500;
/** Upper bound on the maxPinnedWindows setting; the app enforces the setting itself. */
const MAX_CHATS = 12;

export default async function plugin(bb: BbPluginApi) {
  // Read by the app through useSettings(); edit in bb's plugin settings or
  // with `bb plugin config canvas`.
  bb.settings.define({
    maxPinnedWindows: {
      type: "number",
      label: "Pinned chat windows",
      description: "How many chats can be pinned to the canvas at once, per grouping (1–12).",
      default: 4,
      experimental_schema: z.number().int().min(1).max(12),
    },
  });

  async function read(): Promise<Layout> {
    return parseLayout(await bb.storage.kv.get(KEY));
  }

  // kv has no transactions; chain read-modify-write updates so concurrent
  // RPCs (two windows dragging at once) don't drop each other's changes.
  let queue: Promise<unknown> = Promise.resolve();
  function update(writer: string, change: (layout: Layout) => void) {
    const next = queue.then(async () => {
      const layout = await read();
      change(layout);
      await bb.storage.kv.set(KEY, layout);
      bb.realtime.publish(LAYOUT_CHANGED, { origin: writer });
    });
    queue = next.catch(() => undefined);
    return next.then(() => ({ ok: true as const }));
  }

  bb.rpc.register(rpcContract, {
    layout_get: () => read(),
    layout_set: ({ origin, layout }) =>
      update(origin, (current) => {
        for (const grouping of GROUPINGS) {
          if (layout.arrangements[grouping].notes.length > MAX_NOTES) {
            throw new Error(`The canvas holds at most ${MAX_NOTES} notes per grouping.`);
          }
        }
        Object.assign(current, layout);
      }),
    positions_set: ({ origin, grouping, positions, replace }) =>
      update(origin, (layout) => {
        const arrangement = layout.arrangements[grouping];
        if (replace) arrangement.positions = {};
        for (const [id, point] of Object.entries(positions)) {
          if (point === null) delete arrangement.positions[id];
          else arrangement.positions[id] = { x: Math.round(point.x), y: Math.round(point.y) };
        }
      }),
    note_upsert: ({ origin, grouping, note }) =>
      update(origin, (layout) => {
        const notes = layout.arrangements[grouping].notes;
        const index = notes.findIndex((existing) => existing.id === note.id);
        if (index >= 0) notes[index] = note;
        else if (notes.length < MAX_NOTES) notes.push(note);
        else throw new Error(`The canvas holds at most ${MAX_NOTES} notes per grouping.`);
      }),
    note_delete: ({ origin, grouping, id }) =>
      update(origin, (layout) => {
        const arrangement = layout.arrangements[grouping];
        arrangement.notes = arrangement.notes.filter((note) => note.id !== id);
      }),
    chat_upsert: ({ origin, grouping, chat }) =>
      update(origin, (layout) => {
        const chats = layout.arrangements[grouping].chats;
        const index = chats.findIndex((existing) => existing.threadId === chat.threadId);
        if (index >= 0) chats[index] = chat;
        else if (chats.length < MAX_CHATS) chats.push(chat);
        else throw new Error(`The canvas holds at most ${MAX_CHATS} pinned chats per grouping.`);
      }),
    chat_delete: ({ origin, grouping, threadId }) =>
      update(origin, (layout) => {
        const arrangement = layout.arrangements[grouping];
        arrangement.chats = arrangement.chats.filter((chat) => chat.threadId !== threadId);
      }),
    frame_color_set: ({ origin, frameKey, color }) =>
      update(origin, (layout) => {
        if (color === "none") delete layout.frameColors[frameKey];
        else layout.frameColors[frameKey] = color;
      }),
  });
}
