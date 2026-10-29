import { definePluginApp } from "@get-bb/plugin-sdk/app";
import type { Direction } from "./geometry";
import { handlePickerKey } from "./pickers";
import { activate, collectRegions, currentRegion, findNeighbor } from "./regions";

const DIRECTIONS: Record<string, Direction> = {
  h: "left",
  j: "down",
  k: "up",
  l: "right",
};

// Popups that use Ctrl+J/K for their own list navigation (the command palette
// and other cmdk lists, menus, dialogs).
const OWNS_KEYS = "[role='dialog'], [role='menu'], [role='listbox'], [cmdk-root]";

function onKeyDown(event: KeyboardEvent) {
  if (!event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
  if (event.isComposing) return;
  if (handlePickerKey(event) || event.repeat) return;
  const direction = DIRECTIONS[event.key.toLowerCase()];
  if (direction === undefined) return;

  const active = document.activeElement;
  if (active?.closest(OWNS_KEYS) && !active.closest("[data-sidebar='sidebar']")) return;

  const regions = collectRegions();
  const from = currentRegion(regions);
  const to = from
    ? findNeighbor(from, regions, direction)
    : (regions.find((r) => r.kind === "composer") ?? null);

  // At an edge a terminal keeps the key, like tmux: Ctrl+L still clears and
  // Ctrl+H still deletes. Elsewhere the key is consumed so the composer does
  // not run its Emacs-style bindings.
  if (to === null && from?.kind === "terminal") return;

  event.preventDefault();
  event.stopImmediatePropagation();
  if (to !== null) activate(to);
}

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "pane-navigation",
    mount: ({ signal }) => {
      window.addEventListener("keydown", onKeyDown, { capture: true, signal });
    },
  });
});
