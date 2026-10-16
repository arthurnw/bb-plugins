import { pickNeighbor, type Direction } from "./geometry";

export type RegionKind = "composer" | "terminal" | "browser" | "sidebar" | "pane";

export interface Region {
  kind: RegionKind;
  /** The element that receives focus. */
  target: HTMLElement;
  /** The largest ancestor of `target` that contains no other region's target. */
  container: HTMLElement;
}

function isVisible(el: Element): boolean {
  if (el.closest("[inert], [aria-hidden='true']")) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return false;
  return getComputedStyle(el).visibility !== "hidden";
}

const FOCUSABLE =
  "textarea, input:not([type='hidden']), [contenteditable='true'], button, a[href], [tabindex]:not([tabindex='-1'])";

function firstFocusable(root: HTMLElement): HTMLElement | null {
  for (const el of root.querySelectorAll<HTMLElement>(FOCUSABLE)) {
    if (!(el as HTMLButtonElement).disabled && isVisible(el)) return el;
  }
  return null;
}

function composerTargets(): HTMLElement[] {
  const targets: HTMLElement[] = [];
  for (const shell of document.querySelectorAll<HTMLElement>("[data-app-composer]")) {
    const role = shell.getAttribute("data-app-composer-role");
    if (role !== null && role !== "primary") continue;
    const editor = shell.querySelector<HTMLElement>(
      "[contenteditable='true'], textarea",
    );
    if (editor && isVisible(editor)) targets.push(editor);
  }
  return targets;
}

function sidebarTarget(sidebar: HTMLElement): HTMLElement {
  return (
    sidebar.querySelector<HTMLElement>(
      "[data-sidebar-thread-id][data-active='true'], [data-sidebar='menu-button'][data-active='true'], [aria-current='page']",
    ) ??
    sidebar.querySelector<HTMLElement>("[data-sidebar-thread-shortcut-target]") ??
    firstFocusable(sidebar) ??
    sidebar
  );
}

/** Finds every navigable region in the window. */
export function collectRegions(): Region[] {
  const found: Omit<Region, "container">[] = [];

  for (const target of composerTargets()) found.push({ kind: "composer", target });

  for (const el of document.querySelectorAll<HTMLElement>("[data-app-terminal]")) {
    if (!isVisible(el)) continue;
    const textarea = el.querySelector<HTMLElement>(".xterm-helper-textarea");
    found.push({ kind: "terminal", target: textarea ?? el });
  }

  for (const el of document.querySelectorAll<HTMLElement>("[data-app-browser]")) {
    if (!isVisible(el)) continue;
    const view = el.querySelector<HTMLElement>("webview, iframe");
    found.push({ kind: "browser", target: view ?? firstFocusable(el) ?? el });
  }

  for (const el of document.querySelectorAll<HTMLElement>("[data-sidebar='sidebar']")) {
    if (isVisible(el)) found.push({ kind: "sidebar", target: sidebarTarget(el) });
  }

  // Panes that hold none of the above, such as file viewers and plugin pages.
  const covered = (el: HTMLElement) => found.some((r) => el.contains(r.target));
  for (const el of document.querySelectorAll<HTMLElement>(
    "[data-split-pane-id], [data-pane-content]",
  )) {
    if (!isVisible(el) || covered(el)) continue;
    if (el.querySelector("[data-split-pane-id], [data-pane-content]")) continue;
    found.push({ kind: "pane", target: firstFocusable(el) ?? el });
  }

  return found.map((region) => ({
    ...region,
    container: exclusiveAncestor(region.target, found.map((r) => r.target)),
  }));
}

function exclusiveAncestor(target: HTMLElement, all: HTMLElement[]): HTMLElement {
  let current = target;
  for (;;) {
    const parent = current.parentElement;
    if (parent === null || parent === document.body) return current;
    if (all.some((other) => other !== target && parent.contains(other))) {
      return current;
    }
    current = parent;
  }
}

export function currentRegion(regions: Region[]): Region | null {
  const active = document.activeElement;
  if (active && active !== document.body) {
    const hit = regions.find((r) => r.container.contains(active));
    if (hit) return hit;
  }
  const focusedPane = document.querySelector("[data-split-pane-id][data-focused='true']");
  if (focusedPane) {
    return (
      regions.find((r) => r.kind === "composer" && focusedPane.contains(r.target)) ??
      regions.find((r) => focusedPane.contains(r.target)) ??
      null
    );
  }
  return null;
}

export function findNeighbor(
  from: Region,
  regions: Region[],
  direction: Direction,
): Region | null {
  const others = regions.filter((r) => r !== from);
  const index = pickNeighbor(
    from.container.getBoundingClientRect(),
    others.map((r) => r.container.getBoundingClientRect()),
    direction,
  );
  return index === -1 ? null : others[index]!;
}

export function activate(region: Region): void {
  // bb tracks the focused split pane from pointer events on the pane element.
  const pane = region.target.closest<HTMLElement>("[data-split-pane-id]");
  pane?.dispatchEvent(
    new PointerEvent("pointerdown", { bubbles: true, cancelable: true, isPrimary: true }),
  );
  if (!region.target.matches(FOCUSABLE) && !region.target.hasAttribute("tabindex")) {
    region.target.tabIndex = -1;
  }
  region.target.focus({ preventScroll: true });
  region.target.scrollIntoView({ block: "nearest", inline: "nearest" });
}
