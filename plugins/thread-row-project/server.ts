import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { DISPLAY_MODES, type DisplayMode } from "./shared";

const CONFIG_TAG = "config";
const MODE_KEY = "display-mode";
const iconKey = (projectId: string) => `icon:${projectId}`;

const modeSchema = z.enum(DISPLAY_MODES);
const rowSchema = z.object({
  name: z.string().nullable(),
  icon: z.string().nullable(),
  mode: modeSchema,
});

export const rpcContract = defineRpcContract({
  // One row per project id, for the thread rows.
  rowDisplay: {
    input: z.object({ keys: z.array(z.string()) }),
    output: z.record(z.string(), rowSchema),
    keyTags: () => [CONFIG_TAG],
  },
  // Everything the settings page needs.
  settings: {
    input: z.object({}),
    output: z.object({
      mode: modeSchema,
      projects: z.array(z.object({ id: z.string(), name: z.string(), icon: z.string().nullable() })),
    }),
    tags: () => [CONFIG_TAG],
  },
  setMode: { input: z.object({ mode: modeSchema }), output: z.null() },
  setIcon: {
    input: z.object({ projectId: z.string(), icon: z.string().max(2048).nullable() }),
    output: z.null(),
  },
});

export default function plugin(bb: BbPluginApi) {
  const readMode = async (): Promise<DisplayMode> => {
    const parsed = modeSchema.safeParse(await bb.storage.kv.get<string>(MODE_KEY));
    return parsed.success ? parsed.data : "name";
  };
  const listProjects = () => bb.sdk.projects.list({ includePersonal: true });

  bb.rpc.register(rpcContract, {
    async rowDisplay({ keys }) {
      const [mode, projects] = await Promise.all([readMode(), listProjects()]);
      const names = new Map(projects.map((p) => [p.id, p.name]));
      const entries = await Promise.all(
        keys.map(async (key) => {
          const icon = (await bb.storage.kv.get<string>(iconKey(key))) ?? null;
          return [key, { name: names.get(key) ?? null, icon, mode }] as const;
        }),
      );
      return Object.fromEntries(entries);
    },

    async settings() {
      const [mode, projects] = await Promise.all([readMode(), listProjects()]);
      const rows = await Promise.all(
        projects.map(async (p) => ({
          id: p.id,
          name: p.name,
          icon: (await bb.storage.kv.get<string>(iconKey(p.id))) ?? null,
        })),
      );
      return { mode, projects: rows };
    },

    async setMode({ mode }) {
      await bb.storage.kv.set(MODE_KEY, mode);
      bb.rpc.experimental_invalidate([CONFIG_TAG]);
      return null;
    },

    async setIcon({ projectId, icon }) {
      const value = icon?.trim();
      if (value) await bb.storage.kv.set(iconKey(projectId), value);
      else await bb.storage.kv.delete(iconKey(projectId));
      bb.rpc.experimental_invalidate([CONFIG_TAG]);
      return null;
    },
  });
}
