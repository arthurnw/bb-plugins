// A "Permissions" row in a Pi thread's composer `+` menu. It opens a popup that
// shows the permission-gate mode and switches it.
import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  definePluginApp,
  type PluginComposerApi,
  useComposer,
  useRealtime,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import {
  MODE_CHANGED,
  type ModeChanged,
  type PermissionMode,
  permissionModes,
  type rpcContract,
} from "./server";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

const MODE_LABELS: Record<PermissionMode, { label: string; icon: string; detail: string }> = {
  protected: { label: "Protected", icon: "SecurityCheck", detail: "Asks before bash and unknown tools" },
  permissive: { label: "Permissive", icon: "Zap", detail: "Allows most calls, blocks high-risk ones" },
  yolo: { label: "YOLO", icon: "SquareUnlock02", detail: "No checks" },
};

function isModeChanged(value: unknown): value is ModeChanged {
  if (typeof value !== "object" || value === null) return false;
  const { threadId, mode } = value as Partial<ModeChanged>;
  return typeof threadId === "string" && permissionModes.includes(mode as PermissionMode);
}

/** The thread's last reported mode; null until Pi's bb-bridge reports one. */
function useThreadMode(threadId: string): PermissionMode | null {
  const rpc = useRpc<typeof rpcContract>();
  const [mode, setMode] = useState<PermissionMode | null>(null);
  useEffect(() => {
    let live = true;
    setMode(null);
    if (threadId === "") return;
    rpc.call("mode_get", { threadId }).then(
      (result) => {
        if (live) setMode(result.mode);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [rpc, threadId]);
  useRealtime(
    MODE_CHANGED,
    useCallback(
      (payload: unknown) => {
        if (isModeChanged(payload) && payload.threadId === threadId) setMode(payload.mode);
      },
      [threadId],
    ),
  );
  return mode;
}

const POPUP_ID = "permission-mode";

function isPiThread(composer: PluginComposerApi): boolean {
  return composer.scope.kind === "thread" && composer.selection?.providerId === "pi";
}

/** The `+` > Permissions popup: the three modes, the current one checked. */
function PermissionPopup() {
  const composer = useComposer();
  const threadId = composer.scope.kind === "thread" ? composer.scope.threadId : null;
  const rpc = useRpc<typeof rpcContract>();
  const current = useThreadMode(threadId ?? "");
  const [pending, setPending] = useState<PermissionMode | null>(null);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    const index = current ? permissionModes.indexOf(current) : 0;
    buttons.current[index]?.focus();
  }, [current]);

  const choose = async (mode: PermissionMode) => {
    if (threadId === null || mode === current) {
      composer.experimental_closePopup();
      return;
    }
    setPending(mode);
    try {
      const { delivered } = await rpc.call("mode_set", { threadId, mode });
      if (!delivered) {
        toast.error("Pi isn't running in this thread. Send a message, then try again.");
        return;
      }
      composer.experimental_closePopup();
    } catch (cause) {
      toast.error(`Couldn't switch to ${MODE_LABELS[mode].label}: ${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      setPending(null);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = buttons.current.findIndex((button) => button === document.activeElement);
    const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = (index + step + permissionModes.length) % permissionModes.length;
    buttons.current[next]?.focus();
  };

  return (
    <div className="flex min-w-56 flex-col p-1" role="menu" aria-label="Permission mode" onKeyDown={onKeyDown}>
      <div className="px-2 pb-1 pt-1.5 text-xs text-muted-foreground">Permissions</div>
      {permissionModes.map((mode, index) => {
        const { label, icon, detail } = MODE_LABELS[mode];
        const selected = mode === current;
        return (
          <button
            key={mode}
            ref={(element) => {
              buttons.current[index] = element;
            }}
            type="button"
            role="menuitemradio"
            aria-checked={selected}
            disabled={pending !== null}
            onClick={() => void choose(mode)}
            className={cn(
              "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-state-hover focus-visible:bg-state-hover disabled:opacity-50",
              mode === "yolo" && "text-destructive",
            )}
          >
            <Icon name={pending === mode ? "Spinner" : icon} className={cn("size-4 shrink-0", pending === mode && "animate-spin")} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span>{label}</span>
              <span className="text-xs text-muted-foreground">{detail}</span>
            </span>
            {selected ? <Icon name="Check" className="size-4 shrink-0" /> : null}
          </button>
        );
      })}
    </div>
  );
}

export default definePluginApp((app) => {
  app.composer.customize({
    id: "permission-mode",
    scopes: ["thread"],
    plusMenu: [
      {
        id: "permissions",
        label: "Permissions",
        icon: "SecurityCheck",
        description: "Switch Pi's permission-gate mode",
        disabled: (composer) => !isPiThread(composer),
        run: ({ composer }) => {
          composer.experimental_openPopup(POPUP_ID);
        },
      },
    ],
    experimental_popups: [{ id: POPUP_ID, label: "Permission mode", component: PermissionPopup }],
  });
});
