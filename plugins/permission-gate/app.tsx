// A permission-mode picker in a Pi thread's composer footer, next to the
// context donut, inserted into bb's own markup.
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  definePluginApp,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

/**
 * The right-hand group of the primary composer's footer, where the context
 * donut lives. This is bb's internal markup, not a plugin API, so a bb update
 * can move or rename it; the picker then just doesn't show.
 */
const FOOTER_GROUP = "[data-app-composer-role=primary] [data-follow-up-composer-footer] > div:last-child";

/** A host node in the footer, recreated whenever bb re-renders the footer. */
function useFooterSlot(enabled: boolean): HTMLElement | null {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!enabled) {
      setSlot(null);
      return;
    }
    const node = document.createElement("div");
    node.dataset.permissionGateSlot = "";
    node.className = "contents";
    const place = () => {
      const group = document.querySelector(FOOTER_GROUP);
      if (group === null) {
        node.remove();
        setSlot(null);
        return;
      }
      if (node.parentElement !== group || group.firstElementChild !== node) group.prepend(node);
      setSlot(node);
    };
    place();
    const observer = new MutationObserver(place);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      node.remove();
      setSlot(null);
    };
  }, [enabled]);
  return slot;
}

function FooterPicker() {
  const composer = useComposer();
  // Only Pi threads running bb-bridge report a mode, so a recorded mode marks a
  // Pi thread. (`selection` is null outside a composer slot.)
  const threadId = composer.scope.kind === "thread" ? composer.scope.threadId : null;
  const mode = useThreadMode(threadId ?? "");
  const slot = useFooterSlot(threadId !== null && mode !== null);
  const rpc = useRpc<typeof rpcContract>();
  if (slot === null || threadId === null || mode === null) return null;

  const choose = async (next: PermissionMode) => {
    if (next === mode) return;
    try {
      const { delivered } = await rpc.call("mode_set", { threadId, mode: next });
      if (!delivered) toast.error("Pi isn't running in this thread. Send a message, then try again.");
    } catch (cause) {
      toast.error(`Couldn't switch to ${MODE_LABELS[next].label}: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  };

  const { label, icon } = MODE_LABELS[mode];
  return createPortal(
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Permission mode: ${label}`}
        className={cn(
          "inline-flex h-6 cursor-pointer select-none items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-state-active max-md:pointer-coarse:h-11 max-md:pointer-coarse:px-2.5",
          mode === "yolo" && "text-destructive hover:text-destructive",
        )}
      >
        <Icon name={icon} className="size-3.5" />
        <span>{label}</span>
        <Icon name="ChevronDown" className="size-3 opacity-70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" mobileTitle="Permissions" className="min-w-60">
        <DropdownMenuLabel>Permissions</DropdownMenuLabel>
        {permissionModes.map((option) => {
          const item = MODE_LABELS[option];
          return (
            <DropdownMenuItem
              key={option}
              role="menuitemradio"
              aria-checked={option === mode}
              variant={option === "yolo" ? "destructive" : "default"}
              onSelect={() => void choose(option)}
            >
              <Icon name={item.icon} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span>{item.label}</span>
                <span className="text-muted-foreground">{item.detail}</span>
              </span>
              {option === mode ? <Icon name="Check" /> : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>,
    slot,
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "footer-permission-picker", component: FooterPicker });
});
