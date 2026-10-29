// bb-plugin-canvas backend: stores the canvas arrangement (card positions,
// sticky notes, frame colors) so it survives reloads and is shared by every
// open window. Thread data itself comes from bb's live thread list in the app.
import { randomUUID } from "node:crypto";
import { PluginCliError, cliCommand, defineCli, defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { ARRANGE_STYLES, FRAME_COLORS, GROUPINGS, LAYOUT_CHANGED, NOTE_COLORS, OPEN_URL_CHANNEL, emptyLayout } from "./canvas/shared.ts";

const pointSchema = z.object({ x: z.number(), y: z.number() });

const noteSchema = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  text: z.string(),
  color: z.enum(NOTE_COLORS),
});
export type Note = z.infer<typeof noteSchema>;
const groupingSchema = z.enum(GROUPINGS);

/** A thread's chat pinned to the canvas, in canvas coordinates. */
const pinnedChatSchema = z.object({
  threadId: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
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

function parseLayout(raw: unknown): Layout {
  const parsed = layoutSchema.safeParse(raw);
  return parsed.success ? parsed.data : emptyLayout();
}

function upsert<T>(list: T[], item: T, same: (existing: T) => boolean) {
  const index = list.findIndex(same);
  if (index >= 0) list[index] = item;
  else list.push(item);
}

/** Every write carries the writer's client id so it can skip its own echo. */
const origin = z.string();
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
    input: z.object({ origin, frameKey: z.string(), color: z.enum(FRAME_COLORS) }),
    output: ok,
  },
  /** A Canvas page reports that it opened a `bb canvas open-url` request. */
  open_url_ack: { input: z.object({ id: z.string() }), output: ok },
});

const KEY = "layout";
/** How long `bb canvas open-url` waits for a Canvas page to report the URL opened. */
const OPEN_URL_ACK_MS = 3000;

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
    arrangeStyle: {
      type: "select",
      label: "Rearrange layout",
      description: "How Rearrange places a frame's cards. The flat layouts keep the tree's order, so child threads follow their parents.",
      options: [...ARRANGE_STYLES],
      experimental_optionLabels: {
        tree: "Tree (children to the right of their parent)",
        column: "Single column",
        row: "Single row",
        gridColumns: "Grid, wrapping at a number of columns",
        gridRows: "Grid, wrapping at a number of rows",
      },
      default: "tree",
    },
    arrangeGridSize: {
      type: "number",
      label: "Grid size",
      description: "For the grid layouts: the most columns (or rows) before wrapping (1–20).",
      default: 3,
      experimental_schema: z.number().int().min(1).max(20),
    },
    collapseSidebar: {
      type: "boolean",
      label: "Collapse the thread sidebar on the canvas",
      description: "Collapse bb's thread sidebar while the canvas is open, and expand it again when you leave.",
      default: true,
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

  // Each open-url request waits here until a Canvas page acknowledges it.
  const pendingOpens = new Map<string, () => void>();

  bb.cli.register(
    defineCli({
      name: "canvas",
      summary: "Work with the Canvas page",
      commands: {
        "open-url": cliCommand({
          summary: "Open a URL in the Canvas page's browser panel",
          description:
            "Opens an http(s) URL in the in-app browser of the Canvas page in each bb window that is showing it. " +
            "Fails when no window is showing the Canvas page; use `bb preview url` to open it in a thread instead.",
          positionals: [{ name: "url", description: "http(s) URL to open", required: true }],
          async run(input) {
            const url = input.positionals.url;
            if (!/^https?:\/\//i.test(url) || !URL.canParse(url)) {
              throw new PluginCliError(`not an http(s) URL: ${url}`, { code: "invalid_url" });
            }
            const id = randomUUID();
            const opened = new Promise<boolean>((resolve) => {
              const timer = setTimeout(() => {
                pendingOpens.delete(id);
                resolve(false);
              }, OPEN_URL_ACK_MS);
              pendingOpens.set(id, () => {
                clearTimeout(timer);
                pendingOpens.delete(id);
                resolve(true);
              });
            });
            bb.realtime.publish(OPEN_URL_CHANNEL, { id, url });
            if (!(await opened)) {
              throw new PluginCliError("no bb window is showing the Canvas page", {
                code: "canvas_not_open",
                hint: "Open the Canvas page in bb, or run `bb preview url <url>` to open it in a thread.",
              });
            }
            return { exitCode: 0, stdout: `Opened ${url} on the Canvas page.\n` };
          },
        }),
      },
    }),
  );

  bb.rpc.register(rpcContract, {
    open_url_ack: ({ id }) => {
      pendingOpens.get(id)?.();
      return { ok: true as const };
    },
    layout_get: () => read(),
    layout_set: ({ origin, layout }) =>
      update(origin, (current) => {
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
        upsert(layout.arrangements[grouping].notes, note, (existing) => existing.id === note.id);
      }),
    note_delete: ({ origin, grouping, id }) =>
      update(origin, (layout) => {
        const arrangement = layout.arrangements[grouping];
        arrangement.notes = arrangement.notes.filter((note) => note.id !== id);
      }),
    chat_upsert: ({ origin, grouping, chat }) =>
      update(origin, (layout) => {
        upsert(layout.arrangements[grouping].chats, chat, (existing) => existing.threadId === chat.threadId);
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
