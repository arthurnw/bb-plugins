// bb-plugin-canvas backend: stores the canvas arrangement (card positions,
// sticky notes, frame colors) so it survives reloads and is shared by every
// open window. Thread data itself comes from bb's live thread list in the app.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

const pointSchema = z.object({ x: z.number().finite(), y: z.number().finite() });

const NOTE_COLORS = ["yellow", "blue", "green", "pink", "purple", "gray"] as const;
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
export type NoteColor = (typeof NOTE_COLORS)[number];
export { NOTE_COLORS };

const FRAME_COLORS = ["none", "blue", "green", "amber", "rose", "violet", "cyan", "slate"] as const;
export type FrameColor = (typeof FRAME_COLORS)[number];
export { FRAME_COLORS };

const layoutSchema = z.object({
  positions: z.record(z.string(), pointSchema),
  notes: z.array(noteSchema),
  frameColors: z.record(z.string(), z.enum(FRAME_COLORS)),
});
export type Layout = z.infer<typeof layoutSchema>;

/** Every write carries the writer's client id so it can skip its own echo. */
const origin = z.string().max(64);

export const rpcContract = defineRpcContract({
  layout_get: { input: z.null(), output: layoutSchema },
  positions_set: {
    input: z.object({
      origin,
      positions: z.record(z.string(), pointSchema.nullable()),
      /** Drop every stored position first (auto-arrange). */
      replace: z.boolean().optional(),
    }),
    output: z.object({ ok: z.literal(true) }),
  },
  note_upsert: {
    input: z.object({ origin, note: noteSchema }),
    output: z.object({ ok: z.literal(true) }),
  },
  note_delete: {
    input: z.object({ origin, id: z.string() }),
    output: z.object({ ok: z.literal(true) }),
  },
  frame_color_set: {
    input: z.object({ origin, projectId: z.string(), color: z.enum(FRAME_COLORS) }),
    output: z.object({ ok: z.literal(true) }),
  },
});

export const LAYOUT_CHANGED = "layout-changed";
const KEY = "layout";
const MAX_NOTES = 500;

export default async function plugin(bb: BbPluginApi) {
  async function read(): Promise<Layout> {
    const parsed = layoutSchema.safeParse(await bb.storage.kv.get(KEY));
    return parsed.success ? parsed.data : { positions: {}, notes: [], frameColors: {} };
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
    positions_set: ({ origin, positions, replace }) =>
      update(origin, (layout) => {
        if (replace) layout.positions = {};
        for (const [id, point] of Object.entries(positions)) {
          if (point === null) delete layout.positions[id];
          else layout.positions[id] = { x: Math.round(point.x), y: Math.round(point.y) };
        }
      }),
    note_upsert: ({ origin, note }) =>
      update(origin, (layout) => {
        const index = layout.notes.findIndex((existing) => existing.id === note.id);
        if (index >= 0) layout.notes[index] = note;
        else if (layout.notes.length < MAX_NOTES) layout.notes.push(note);
        else throw new Error(`The canvas holds at most ${MAX_NOTES} notes.`);
      }),
    note_delete: ({ origin, id }) =>
      update(origin, (layout) => {
        layout.notes = layout.notes.filter((note) => note.id !== id);
      }),
    frame_color_set: ({ origin, projectId, color }) =>
      update(origin, (layout) => {
        if (color === "none") delete layout.frameColors[projectId];
        else layout.frameColors[projectId] = color;
      }),
  });
}
