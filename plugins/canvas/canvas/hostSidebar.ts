import { useLayoutEffect } from "react";

// bb has no plugin API to collapse its thread sidebar or read whether it is
// collapsed, so this drives bb's own toggle button, which reports its state
// through aria-expanded.
const trigger = () => document.querySelector<HTMLButtonElement>('button[data-sidebar="trigger"]');
const isExpanded = () => trigger()?.getAttribute("aria-expanded") === "true";

/**
 * Toggles the sidebar without its slide animation. Animating it while the
 * canvas mounts made the canvas re-measure on every frame, which stuttered.
 */
function toggleWithoutAnimation() {
  const style = document.createElement("style");
  style.textContent = "[data-sidebar], [data-sidebar] * { transition: none !important; }";
  document.head.append(style);
  trigger()?.click();
  // Let the collapsed layout settle before animations come back.
  requestAnimationFrame(() => requestAnimationFrame(() => style.remove()));
}

/**
 * Collapses bb's thread sidebar while the canvas is shown and expands it again
 * on leaving, but only if the canvas collapsed it and it is still collapsed:
 * reopening it by hand while on the canvas is left alone. Runs before the
 * canvas first paints so the page doesn't draw at one width and then another.
 */
export function useCollapseHostSidebar(enabled: boolean) {
  useLayoutEffect(() => {
    if (!enabled) return;
    let collapsedByCanvas = false;
    if (isExpanded()) {
      toggleWithoutAnimation();
      collapsedByCanvas = true;
    }
    return () => {
      if (collapsedByCanvas && !isExpanded()) toggleWithoutAnimation();
    };
  }, [enabled]);
}
