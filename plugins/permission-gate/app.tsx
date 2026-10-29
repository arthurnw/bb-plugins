// A chip in the context row above a Pi thread's composer: shows the
// permission-gate mode and, when expanded, switches it.
import { useCallback, useEffect, useState } from "react";
import {
  definePluginApp,
  type ExperimentalThreadContextSegmentInput,
  type ExperimentalThreadContextSegmentProps,
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
import { Button } from "@/components/ui/button";
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

function useVisible({ threadId }: ExperimentalThreadContextSegmentInput): boolean {
  return useThreadMode(threadId) !== null;
}

function Summary({ threadId, isExpanded, onToggle }: ExperimentalThreadContextSegmentProps) {
  const mode = useThreadMode(threadId);
  if (mode === null) return null;
  const { label, icon } = MODE_LABELS[mode];
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={onToggle}
      aria-expanded={isExpanded}
      aria-label={`Permission mode: ${label}. Change`}
      className={cn("ml-1", mode === "yolo" && "text-destructive hover:text-destructive")}
    >
      <Icon name={icon} />
      {label}
      <Icon name={isExpanded ? "ChevronUp" : "ChevronDown"} />
    </Button>
  );
}

function Details({ threadId, isExpanded, onToggle }: ExperimentalThreadContextSegmentProps) {
  const rpc = useRpc<typeof rpcContract>();
  const current = useThreadMode(threadId);
  const [pending, setPending] = useState<PermissionMode | null>(null);
  if (!isExpanded) return null;

  const choose = async (mode: PermissionMode) => {
    if (mode === current) {
      onToggle();
      return;
    }
    setPending(mode);
    try {
      const { delivered } = await rpc.call("mode_set", { threadId, mode });
      if (!delivered) {
        toast.error("Pi isn't running in this thread. Send a message, then try again.");
        return;
      }
      onToggle();
    } catch (cause) {
      toast.error(`Couldn't switch to ${MODE_LABELS[mode].label}: ${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="flex flex-wrap gap-1.5 px-2 py-1.5" data-permission-details="" role="group" aria-label="Permission mode">
      {permissionModes.map((mode) => {
        const { label, icon, detail } = MODE_LABELS[mode];
        return (
          <Button
            key={mode}
            size="sm"
            variant="ghost"
            aria-pressed={mode === current}
            aria-description={detail}
            disabled={pending !== null}
            onClick={() => void choose(mode)}
          >
            <Icon name={pending === mode ? "Spinner" : icon} className={cn(pending === mode && "animate-spin")} />
            {label}
          </Button>
        );
      })}
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_threadContextSegment({
    id: "mode",
    title: "Permission mode",
    group: "2_permission",
    summary: Summary,
    details: Details,
    useVisible,
  });
});
