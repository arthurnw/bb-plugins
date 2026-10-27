// Shows the Plannotator Inbox in the page itself, through the plugin's proxy
// (see server.ts). The Inbox's port changes when it restarts, so the page asks
// the server for current addresses on every visit.
import { useCallback, useEffect, useState } from "react";
import {
  definePluginApp,
  experimental_copyToClipboard as copyToClipboard,
  useBbNavigate,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { InboxInfo, rpcContract } from "./server";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

type InboxState =
  | { status: "loading" }
  | { status: "ready"; info: InboxInfo }
  | { status: "error"; message: string };

// The header and the body are separate components; this lets the header's
// Reload button reach the body.
const reloadEvents = new EventTarget();

function useInbox() {
  const rpc = useRpc<typeof rpcContract>();
  const [state, setState] = useState<InboxState>({ status: "loading" });
  const refresh = useCallback(async (): Promise<InboxInfo | null> => {
    try {
      const info = await rpc.call("inbox_ensure", null);
      setState({ status: "ready", info });
      return info;
    } catch (cause) {
      setState({ status: "error", message: cause instanceof Error ? cause.message : String(cause) });
      return null;
    }
  }, [rpc]);
  return { state, refresh };
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** The proxy address this client can reach: loopback when BB itself is loaded from loopback. */
function frameUrl(info: InboxInfo): string | null {
  if (LOOPBACK.has(window.location.hostname)) return info.frameLocalUrl;
  return info.frameTailnetUrl ?? null;
}

function InboxPage() {
  const { state, refresh } = useInbox();
  const [frameKey, setFrameKey] = useState(0);

  useEffect(() => {
    void refresh();
    const onReload = () => {
      void refresh().then(() => setFrameKey((key) => key + 1));
    };
    reloadEvents.addEventListener("reload", onReload);
    return () => reloadEvents.removeEventListener("reload", onReload);
  }, [refresh]);

  if (state.status === "loading") {
    return <Message>Starting the Plannotator Inbox…</Message>;
  }
  if (state.status === "error") {
    return <Message tone="error">{state.message}</Message>;
  }
  const src = frameUrl(state.info);
  if (!src) {
    return (
      <Message>
        BB is open on another computer, and the Inbox isn't published on your tailnet. Turn on
        Tailscale in the Inbox's Settings, or set <code>"inboxTailscale": true</code> in{" "}
        <code>~/.plannotator/config.json</code>, then reload.
      </Message>
    );
  }
  return (
    <iframe
      key={frameKey}
      src={src}
      title="Plannotator Inbox"
      className="block h-full min-h-0 w-full flex-1 border-0"
      allow="clipboard-read; clipboard-write"
    />
  );
}

function Message({ children, tone }: { children: React.ReactNode; tone?: "error" }) {
  return (
    <div className="flex h-full flex-1 items-center justify-center p-6">
      <p
        role={tone === "error" ? "alert" : "status"}
        className={tone === "error" ? "max-w-lg text-sm text-destructive" : "max-w-lg text-sm text-muted-foreground"}
      >
        {children}
      </p>
    </div>
  );
}

function InboxHeader() {
  const { refresh } = useInbox();
  const navigate = useBbNavigate();
  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => reloadEvents.dispatchEvent(new Event("reload"))}
        aria-label="Reload Inbox"
      >
        <Icon name="RotateCcw" className="size-4" />
        Reload
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          void refresh().then((info) => info && navigate.openUrl(info.url));
        }}
      >
        <Icon name="ExternalLink" className="size-4" />
        Open in browser
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          void refresh().then((info) => info && copyToClipboard({ text: info.url }));
        }}
      >
        <Icon name="Copy" className="size-4" />
        Copy URL
      </Button>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "inbox",
    title: "Plannotator Inbox",
    icon: "plannotator-inbox/mailbox",
    path: "inbox",
    component: InboxPage,
    headerContent: InboxHeader,
  });
});
