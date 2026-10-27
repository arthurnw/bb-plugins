// The Plannotator Inbox sends X-Frame-Options: DENY, so it cannot be embedded.
// The page starts it and opens its URL with BB's openUrl instead.
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
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

function useInbox() {
  const rpc = useRpc<typeof rpcContract>();
  const [state, setState] = useState<InboxState>({ status: "loading" });
  const refresh = useCallback(async (): Promise<InboxInfo | null> => {
    setState({ status: "loading" });
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

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right">{children}</span>
    </div>
  );
}

function InboxPage() {
  const { state, refresh } = useInbox();
  const navigate = useBbNavigate();

  // The Inbox port changes when it restarts, so fetch the URL right before opening.
  const open = useCallback(async () => {
    const info = await refresh();
    if (info) navigate.openUrl(info.url);
  }, [refresh, navigate]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto box-border w-full max-w-3xl space-y-4 p-4 md:p-5">
        <p className="text-sm text-muted-foreground">
          Messages, questions and files that agents leave for you without waiting on an answer.
        </p>

        <div className="rounded-lg border border-border bg-card px-4 py-1">
          <Row label="Status">
            {state.status === "loading" ? (
              "Starting…"
            ) : state.status === "error" ? (
              <span className="text-destructive">Not running</span>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-green-500" aria-hidden />
                Running
              </span>
            )}
          </Row>
          {state.status === "ready" ? (
            <>
              <Row label="Address">
                <span className="font-mono text-xs">{state.info.url}</span>
              </Row>
              {state.info.version ? <Row label="Version">{state.info.version}</Row> : null}
              {state.info.startedAt ? (
                <Row label="Started">{new Date(state.info.startedAt).toLocaleString()}</Row>
              ) : null}
            </>
          ) : null}
        </div>

        {state.status === "error" ? (
          <p role="alert" className="text-sm text-destructive">
            {state.message}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void open()} disabled={state.status === "loading"}>
            <Icon name="ExternalLink" className="size-4" />
            Open Inbox
          </Button>
          <Button
            variant="outline"
            disabled={state.status !== "ready"}
            onClick={() => {
              if (state.status === "ready") void copyToClipboard({ text: state.info.url });
            }}
          >
            <Icon name="Copy" className="size-4" />
            Copy URL
          </Button>
          <Button variant="ghost" onClick={() => void refresh()} disabled={state.status === "loading"}>
            <Icon name="RefreshCw" className="size-4" />
            Refresh
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          The Inbox only listens on this machine. To open it from another device, turn on Tailscale
          in the Inbox's Settings.
        </p>
      </div>
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
  });
});
