import { useEffect, useState } from "react";

// bb's model button cannot be reconfigured, so the Launcher hides it and puts
// its own trigger (bots and presets first) where it was. If a bb release
// renames the button, the host button stays visible and the slot is absent.
// The picker's own "Other model…" row embeds bb's picker too; that one stays.
export const HOST_MODEL_PICKER = "button[aria-label^='Provider, model and reasoning']:not([data-other-model] *)";

/**
 * A span at the end of the composer footer's left group (after the project
 * picker), for controls that belong on that row. Null until the footer renders,
 * or if a bb release changes its markup.
 */
export function useFooterSlot(root: HTMLElement | null, enabled: boolean): HTMLElement | null {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!root || !enabled) return;
    const span = document.createElement("span");
    span.style.display = "contents";
    const sync = () => {
      const group = root.querySelector("[data-new-thread-footer] > div:first-child");
      if (group) {
        if (span.parentElement !== group || group.lastChild !== span) group.appendChild(span);
        setSlot(span);
      } else {
        span.remove();
        setSlot(null);
      }
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { childList: true, subtree: true });
    return () => { observer.disconnect(); span.remove(); setSlot(null); };
  }, [root, enabled]);
  return slot;
}

export function useModelSlot(root: HTMLElement | null, enabled: boolean): HTMLElement | null {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!root || !enabled) return;
    const span = document.createElement("span");
    span.style.display = "inline-flex";
    const sync = () => {
      const button = root.querySelector(HOST_MODEL_PICKER);
      if (button?.parentElement) {
        if (span.nextSibling !== button) button.parentElement.insertBefore(span, button);
        setSlot(span);
      } else {
        span.remove();
        setSlot(null);
      }
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { childList: true, subtree: true });
    return () => { observer.disconnect(); span.remove(); setSlot(null); };
  }, [root, enabled]);
  return slot;
}
