import { experimental_Icon as Icon, type PluginThreadHeaderActionProps } from "@get-bb/plugin-sdk/app";
import { quickCompose } from "./overlay-store";

/** Opens the Launcher from a thread header, so a phone (no shortcut or palette) can reach it. */
export function LauncherHeaderButton({ projectId, threadId, isCompactViewport }: PluginThreadHeaderActionProps) {
  return (
    <button
      type="button"
      aria-label="Launcher: new thread"
      title="Launcher: new thread"
      onClick={() => quickCompose.toggle("new-thread", { projectId, threadId })}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6, height: 28, padding: isCompactViewport ? "0 6px" : "0 8px",
        border: "none", borderRadius: 6, background: "transparent", color: "var(--foreground)", cursor: "pointer", fontSize: 13,
      }}
    >
      <Icon name="SquarePen" fallback="Plus" aria-hidden="true" style={{ width: 16, height: 16 }} />
      {!isCompactViewport && "Launcher"}
    </button>
  );
}
