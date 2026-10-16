import { useBbNavigate, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";
import { OPEN_URL_CHANNEL } from "./shared.ts";

/**
 * Opens `bb canvas open-url` requests. On a plugin page, bb sends `openUrl`
 * to that page's own App panel Browser (or the OS browser, per the user's
 * browser preference), so the URL shows up next to the canvas.
 */
export function useOpenUrlRequests() {
  const navigate = useBbNavigate();
  const rpc = useRpc<typeof rpcContract>();
  useRealtime(OPEN_URL_CHANNEL, (payload) => {
    const { id, url } = (payload ?? {}) as { id?: unknown; url?: unknown };
    if (typeof id !== "string" || typeof url !== "string") return;
    if (navigate.openUrl(url)) void rpc.call("open_url_ack", { id }).catch(() => undefined);
  });
}
