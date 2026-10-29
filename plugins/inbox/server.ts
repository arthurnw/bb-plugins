// bb-plugin-inbox backend. bb requires a server entry; the inbox reads and
// acts on threads through the app SDK, so there is nothing to run here.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

export default function plugin(_bb: BbPluginApi) {}
