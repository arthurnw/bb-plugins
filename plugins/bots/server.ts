import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { registerBots } from "./bots-server.ts";

export default async function plugin(bb: BbPluginApi) {
  registerBots(bb);
}
