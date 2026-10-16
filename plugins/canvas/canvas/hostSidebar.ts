import { useEffect } from "react";

// bb has no plugin API to collapse its thread sidebar or read whether it is
// collapsed, so this drives bb's own toggle button, which reports its state
// through aria-expanded.
const trigger = () => document.querySelector<HTMLButtonElement>('button[data-sidebar="trigger"]');
const isExpanded = () => trigger()?.getAttribute("aria-expanded") === "true";

/**
 * Collapses bb's thread sidebar while the canvas is shown and expands it again
 * on leaving, but only if the canvas collapsed it and it is still collapsed:
 * reopening it by hand while on the canvas is left alone.
 */
export function useCollapseHostSidebar(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let collapsedByCanvas = false;
    const frame = requestAnimationFrame(() => {
      if (isExpanded()) {
        trigger()?.click();
        collapsedByCanvas = true;
      }
    });
    return () => {
      cancelAnimationFrame(frame);
      if (collapsedByCanvas && !isExpanded()) trigger()?.click();
    };
  }, [enabled]);
}
