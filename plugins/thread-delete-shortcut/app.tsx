import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { definePluginApp, useSdk } from "@get-bb/plugin-sdk/app";
import type { PluginPendingInteractionProps } from "@get-bb/plugin-sdk";

type DeletePrompt = {
  threadTitle: string;
  hasChildren: boolean;
};

type DeleteRequest = {
  threadId: string;
  nonce: number;
};

let nextNonce = 0;
let pendingDelete: DeleteRequest | null = null;
const deleteListeners = new Set<() => void>();

function subscribeDelete(listener: () => void) {
  deleteListeners.add(listener);
  return () => deleteListeners.delete(listener);
}

function getPendingDelete() {
  return pendingDelete;
}

function notifyDeleteListeners() {
  for (const listener of deleteListeners) listener();
}

function requestDelete(threadId: string) {
  pendingDelete = { threadId, nonce: ++nextNonce };
  notifyDeleteListeners();
}

function closeDelete(nonce: number) {
  if (pendingDelete?.nonce !== nonce) return;
  pendingDelete = null;
  notifyDeleteListeners();
}

function DeleteDialog() {
  const sdk = useSdk();
  const request = useSyncExternalStore(subscribeDelete, getPendingDelete, getPendingDelete);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const [prompt, setPrompt] = useState<DeletePrompt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (request === null) {
      setPrompt(null);
      setBusy(false);
      setError(null);
      return;
    }

    let live = true;
    setPrompt(null);
    setError(null);
    Promise.all([
      sdk.threads.get({ threadId: request.threadId }),
      sdk.threads.experimental_listCascade({
        threadIds: [request.threadId],
        action: "delete",
      }),
    ]).then(([thread, cascade]) => {
      if (!live) return;
      setPrompt({
        threadTitle: thread.title ?? "Untitled thread",
        hasChildren: (cascade.threads[0]?.cascadeThreadIds.length ?? 0) > 1,
      });
    }).catch((cause: unknown) => {
      if (live) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => {
      live = false;
    };
  }, [request, sdk]);

  useEffect(() => {
    if (prompt !== null) cancelButton.current?.focus();
  }, [prompt]);

  useEffect(() => {
    if (request === null || busy) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDelete(request.nonce);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, request]);

  if (request === null) return null;

  const cancel = () => {
    if (!busy) closeDelete(request.nonce);
  };

  const confirm = async () => {
    if (busy || prompt === null) return;
    setBusy(true);
    setError(null);
    try {
      await sdk.threads.delete({
        threadId: request.threadId,
        childThreadsConfirmed: true,
      });
      closeDelete(request.nonce);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  };

  return (
    <div
      role="presentation"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "12vh 16px 16px",
        background: "rgb(0 0 0 / 0.28)",
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) cancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="thread-delete-title"
        style={{
          width: "min(100%, 440px)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          background: "var(--popover, var(--background))",
          color: "var(--popover-foreground, var(--foreground))",
          boxShadow: "0 16px 48px rgb(0 0 0 / 0.28)",
          padding: 20,
        }}
      >
        <h2 id="thread-delete-title" style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
          {prompt === null ? "Preparing deletion…" : `Delete “${prompt.threadTitle}” permanently?`}
        </h2>
        <p style={{ margin: "8px 0 0", color: "var(--muted-foreground)", fontSize: 13, lineHeight: 1.5 }}>
          {error ?? (prompt === null
            ? "Loading thread details…"
            : `This removes the conversation and thread storage and cannot be undone.${prompt.hasChildren ? " Child threads will be deleted too." : ""}`)}
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
          <button
            ref={cancelButton}
            type="button"
            disabled={busy}
            onClick={cancel}
            style={{
              border: "1px solid var(--border)",
              borderRadius: 6,
              background: "transparent",
              color: "inherit",
              cursor: busy ? "default" : "pointer",
              padding: "7px 12px",
              opacity: busy ? 0.5 : 1,
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || prompt === null || error !== null}
            onClick={() => void confirm()}
            style={{
              border: 0,
              borderRadius: 6,
              background: "var(--destructive)",
              color: "var(--destructive-foreground)",
              cursor: busy || prompt === null || error !== null ? "default" : "pointer",
              padding: "7px 12px",
              opacity: busy || prompt === null || error !== null ? 0.5 : 1,
            }}
          >
            Delete permanently
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmDelete({
  interaction,
  submit,
  cancel,
}: PluginPendingInteractionProps) {
  const [busy, setBusy] = useState(false);
  const prompt = interaction.payload as DeletePrompt;

  const resolve = async (confirmed: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      if (confirmed) await submit(true);
      else await cancel();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">
          Delete “{prompt.threadTitle}” permanently?
        </p>
        <p className="text-xs text-muted-foreground">
          This removes the conversation and thread storage and cannot be undone.
          {prompt.hasChildren ? " Child threads will be deleted too." : ""}
        </p>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-state-hover disabled:opacity-50"
          disabled={busy}
          onClick={() => void resolve(false)}
        >
          Cancel
        </button>
        <button
          type="button"
          className="rounded-md bg-destructive px-3 py-1.5 text-sm text-destructive-foreground hover:opacity-90 disabled:opacity-50"
          disabled={busy}
          onClick={() => void resolve(true)}
        >
          Delete permanently
        </button>
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  app.commands.register({
    id: "delete-current",
    title: "Thread Delete: delete current thread",
    defaultShortcut: { key: "Backspace", mod: true, shift: true },
    isAvailable: ({ threadId }) => threadId !== null,
    run: async ({ threadId }) => {
      if (threadId === null) return;
      requestDelete(threadId);
    },
  });
  app.slots.experimental_appOverlay({ id: "delete-dialog", component: DeleteDialog });
  app.slots.pendingInteraction({
    id: "confirm-delete",
    component: ConfirmDelete,
  });
});
