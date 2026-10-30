import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const rpcContract = defineRpcContract({
  projectNames: {
    input: z.object({ keys: z.array(z.string()) }),
    output: z.record(z.string(), z.string().nullable()),
  },
});

export default function plugin(bb: BbPluginApi) {
  bb.rpc.register(rpcContract, {
    async projectNames({ keys }) {
      const projects = await bb.sdk.projects.list({ includePersonal: true });
      const names = new Map(projects.map((p) => [p.id, p.name]));
      return Object.fromEntries(keys.map((key) => [key, names.get(key) ?? null]));
    },
  });
}
