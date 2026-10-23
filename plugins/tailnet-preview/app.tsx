// The thread-header listener opens URLs the server publishes on OPEN_CHANNEL in
// the requesting thread's in-app Browser. The Browser toolbar button rewrites a
// localhost URL to the server's tailnet URL for the same port.
import { useCallback, useEffect, useState } from "react";
import {
  definePluginApp,
  experimental_Icon as Icon,
  useBbNavigate,
  useRealtime,
  useRpc,
  type ExperimentalPluginBrowserToolbarActionProps,
  type PluginThreadHeaderActionProps,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";
import { OPEN_CHANNEL, type OpenPayload } from "./shared";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "0.0.0.0"]);

// BB opens URLs in its in-app Browser only in BB Desktop, which exposes this
// bridge; other clients (iOS, web) send them to the system browser. Those
// clients leave URLs queued so they open in Desktop instead. Not part of the
// plugin SDK, so this check may need updating after a BB upgrade.
const hasInAppBrowser = () =>
  typeof window !== "undefined" &&
  (window as { bbDesktop?: { browser?: unknown } }).bbDesktop?.browser != null;

// Payload ids already opened in this window, so split panes open a URL once.
const handledIds = new Set<string>();

// Rendered in each visible thread header: only thread surfaces route
// openUrl to the in-app Browser; elsewhere it falls back to the OS browser.
// A URL requested by a thread opens only in that thread. The server holds it
// until a client showing the thread claims it, here or on the next visit.
function OpenUrlListener({ threadId }: PluginThreadHeaderActionProps) {
  const navigate = useBbNavigate();
  const rpc = useRpc<typeof rpcContract>();

  const claimPending = useCallback(() => {
    if (!hasInAppBrowser()) return;
    rpc.call("claim_pending", { threadId }).then(
      ({ urls }) => urls.forEach((url) => navigate.openUrl(url)),
      () => undefined,
    );
  }, [rpc, navigate, threadId]);

  useEffect(claimPending, [claimPending]);

  useRealtime(OPEN_CHANNEL, (payload) => {
    const { id, url, threadId: requester } = payload as OpenPayload;
    if (requester === threadId) claimPending();
    else if (requester === null && hasInAppBrowser() && !handledIds.has(id)) {
      handledIds.add(id);
      navigate.openUrl(url);
    }
  });
  return null;
}

function isLoopbackUrl(url: string): boolean {
  const parsed = URL.parse(url);
  return parsed !== null && /^https?:$/.test(parsed.protocol) && LOOPBACK_HOSTS.has(parsed.hostname);
}

function OpenOnServerButton({ url }: ExperimentalPluginBrowserToolbarActionProps) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isLoopbackUrl(url)) return null;

  const open = () => {
    setBusy(true);
    setError(null);
    rpc
      .call("expose_local_url", { url })
      .then(
        (result) => navigate.openUrl(result.url),
        (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)),
      )
      .finally(() => setBusy(false));
  };

  return (
    <button
      type="button"
      className="inline-flex size-9 cursor-pointer items-center justify-center rounded-md transition-colors duration-150 hover:bg-state-hover hover:text-foreground hover:duration-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_[data-icon-root]]:size-4"
      aria-label={error ? `Could not publish: ${error}` : "Open this port from the BB server over Tailscale"}
      disabled={busy}
      onClick={open}
    >
      <Icon name={error ? "TriangleAlert" : "Network"} />
    </button>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_threadHeaderAction({
    id: "open-url-listener",
    title: "Tailnet preview",
    component: OpenUrlListener,
  });
  app.slots.experimental_browserToolbarAction({
    id: "open-on-server",
    title: "Open on BB server",
    component: OpenOnServerButton,
  });
});
