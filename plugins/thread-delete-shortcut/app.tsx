import { useEffect, useState } from "react";
import { definePluginApp, useRpc } from "@get-bb/plugin-sdk/app";
import type { PluginPendingInteractionProps } from "@get-bb/plugin-sdk";
import type { rpcContract } from "./server.js";

type DeletePrompt = {
  threadTitle: string;
  hasChildren: boolean;
};

type DeleteRpcClient = ReturnType<typeof useRpc<typeof rpcContract>>;
let deleteRpc: DeleteRpcClient | null = null;

function CommandRuntime() {
  const rpc = useRpc<typeof rpcContract>();
  useEffect(() => {
    deleteRpc = rpc;
    return () => {
      if (deleteRpc === rpc) deleteRpc = null;
    };
  }, [rpc]);
  return null;
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
      if (deleteRpc === null) throw new Error("Thread Delete is still starting; try again.");
      await deleteRpc.call("deleteCurrent", { threadId });
    },
  });
  app.slots.experimental_appOverlay({ id: "command-runtime", component: CommandRuntime });
  app.slots.pendingInteraction({
    id: "confirm-delete",
    component: ConfirmDelete,
  });
});
