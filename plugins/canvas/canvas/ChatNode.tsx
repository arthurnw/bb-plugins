import { memo, useRef } from "react";
import { Handle, NodeResizer, Position, useStore, type Node, type NodeProps } from "@xyflow/react";
import { ThreadChat, type PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { cn } from "@/lib/utils";
import type { PinnedChat } from "../server";
import { useReleaseChatFocus } from "./chatFocus.ts";
import { useCanvasActions } from "./context";
import { Icon } from "./icons.tsx";
import type { Bucket } from "./status.ts";

export const CHAT_HEADER_H = 36;
export const CHAT_W = 400;
export const CHAT_H = 460;
/** Below this zoom a pinned chat shows only its title, like a far-off card. */
const FAR_ZOOM = 0.5;

export type ChatNodeData = {
  chat: PinnedChat;
  thread: PluginSidebarThread;
  bucket: Bucket;
  focused: boolean;
  /** Bumped to put the cursor in this chat's reply box. */
  focusRequest: number;
  /** The canvas zoom when it last came to rest. */
  zoom: number;
};
export type ChatFlowNode = Node<ChatNodeData, "chat">;

/**
 * A thread's chat pinned to the canvas. It lives in canvas coordinates, so it
 * pans and zooms with the cards; drag it by its header and resize it from its
 * edges when focused.
 */
export const ChatNode = memo(function ChatNode({ data }: NodeProps<ChatFlowNode>) {
  const { chat, thread, bucket, focused, focusRequest, zoom } = data;
  const actions = useCanvasActions();
  const far = useStore((state) => state.transform[2] < FAR_ZOOM);
  const ref = useRef<HTMLDivElement>(null);
  useReleaseChatFocus(ref, thread.id, focusRequest, actions.releaseFocus);
  const collapsed = chat.minimized || far;

  return (
    <div
      ref={ref}
      data-bb-canvas-chat=""
      onPointerDownCapture={() => actions.focusChat(thread.id)}
      style={{ width: chat.width, height: chat.minimized ? CHAT_HEADER_H : chat.height }}
      className={cn(
        "flex flex-col overflow-hidden rounded-xl border bg-background",
        focused ? "border-ring shadow-2xl" : "border-border shadow-lg",
      )}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} className="!opacity-0" style={{ top: CHAT_HEADER_H / 2 }} />
      {/* While resizing, only this outline follows the pointer; the chat keeps
          its stored size and takes the new one on release, so its text lays out
          once instead of on every frame. */}
      <NodeResizer
        isVisible={focused && !collapsed}
        minWidth={280}
        minHeight={200}
        lineClassName="!border-dashed !border-ring/60"
        handleClassName="!size-2.5 !rounded-sm !border-ring !bg-background"
        onResizeEnd={(_event, params) =>
          actions.updateChat({ ...chat, x: params.x, y: params.y, width: params.width, height: params.height })
        }
      />
      <div
        style={far && !chat.minimized ? undefined : { height: CHAT_HEADER_H }}
        className={cn(
          "bb-canvas-chat-handle flex shrink-0 cursor-grab items-center gap-2 pl-3 pr-1.5 active:cursor-grabbing",
          far && !chat.minimized ? "flex-1 bg-muted/40" : "border-b border-border",
          !focused && "text-muted-foreground",
        )}
      >
        <span
          className={cn("shrink-0 rounded-full", far ? "size-5" : "size-2")}
          style={{ background: `var(--status-${bucket})` }}
        />
        <span
          className={cn("min-w-0 flex-1 font-medium", far ? "line-clamp-3 text-3xl leading-tight" : "truncate text-sm")}
          title={thread.displayTitle}
        >
          {thread.displayTitle}
        </span>
        {far ? null : (
          [
            {
              icon: chat.minimized ? ("Maximize" as const) : ("Minus" as const),
              label: chat.minimized ? "Restore (-)" : "Minimize (-)",
              run: () => actions.updateChat({ ...chat, minimized: !chat.minimized }),
            },
            {
              icon: chat.linked ? ("Link2" as const) : ("Unlink2" as const),
              label: chat.linked ? "Linked: moves with its card (click to unlink)" : "Not linked: moves on its own (click to link to its card)",
              run: () => actions.updateChat({ ...chat, linked: !chat.linked }),
            },
            { icon: "ArrowUpRight" as const, label: "Open thread", run: () => actions.open(thread.id, false) },
            { icon: "PinOff" as const, label: "Unpin (p)", run: () => actions.unpinChat(thread.id) },
          ].map((button) => (
            <button
              key={button.label}
              type="button"
              aria-label={button.label}
              title={button.label}
              onClick={button.run}
              className="nodrag flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-state-hover hover:text-foreground"
            >
              <Icon name={button.icon} className="size-3.5" />
            </button>
          ))
        )}
      </div>
      {collapsed ? null : (
        // bb's chat draws only the messages it thinks are on screen, measuring
        // its height on screen against unscaled scroll offsets. Under the
        // canvas zoom those disagree and part of the chat goes blank, so the
        // contents are laid out at screen size and scaled back by 1/zoom.
        // `zoom` changes only when panning or zooming stops, so the chat
        // re-lays out once per gesture.
        <div className="nodrag nowheel nopan relative min-h-0 flex-1 cursor-auto overflow-hidden">
          <div
            className="absolute left-0 top-0"
            style={{
              width: `${100 * zoom}%`,
              height: `${100 * zoom}%`,
              transform: `scale(${1 / zoom})`,
              transformOrigin: "0 0",
            }}
          >
            <ThreadChat threadId={thread.id} variant="compact" focusRequest={focusRequest} />
          </div>
        </div>
      )}
    </div>
  );
});
