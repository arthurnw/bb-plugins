import { useEffect, useRef, type RefObject } from "react";

const COMPOSER = '[contenteditable="true"], [contenteditable=""], textarea';
const KEEP_FOCUS_MS = 2000;

/**
 * bb's ThreadChat ignores `focusRequest` while its composer isn't mounted yet
 * and can replace the composer as the timeline loads. After a request, keep
 * focusing the composer whenever the pane changes, until the user acts
 * elsewhere or a short deadline passes.
 */
function focusComposerWhenReady(element: HTMLElement): () => void {
  const stop = () => {
    window.clearTimeout(timeout);
    observer.disconnect();
    window.removeEventListener("pointerdown", stop, true);
    window.removeEventListener("keydown", onKey, true);
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") stop();
  };
  const tryFocus = () => {
    if (element.contains(document.activeElement) && document.activeElement?.matches(COMPOSER)) return;
    element.querySelector<HTMLElement>(COMPOSER)?.focus({ preventScroll: true });
  };
  const observer = new MutationObserver(tryFocus);
  observer.observe(element, { childList: true, subtree: true });
  const timeout = window.setTimeout(stop, KEEP_FOCUS_MS);
  window.addEventListener("pointerdown", stop, true);
  window.addEventListener("keydown", onKey, true);
  tryFocus();
  return stop;
}

/**
 * bb's ThreadChat focuses its composer when it mounts or its timeline loads,
 * which would swallow the canvas's single-key shortcuts. Until the user shows
 * they want the chat (clicking into it, or a change in `focusRequest` from
 * `r`), hand any focus it takes back to the canvas. Showing a new thread
 * (`key`) starts the watch again.
 */
export function useReleaseChatFocus(
  ref: RefObject<HTMLElement | null>,
  key: string,
  focusRequest: number,
  onRelease: () => void,
  /** The chat is mounting because of a request for it, so let it keep focus. */
  requestedOnMount = false,
) {
  const lastRequest = useRef(requestedOnMount ? focusRequest - 1 : focusRequest);
  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    if (focusRequest !== lastRequest.current) {
      lastRequest.current = focusRequest;
      return focusComposerWhenReady(element);
    }
    const onFocusIn = () => onRelease();
    const onPointerDown = () => element.removeEventListener("focusin", onFocusIn);
    element.addEventListener("focusin", onFocusIn);
    element.addEventListener("pointerdown", onPointerDown, { capture: true });
    if (element.contains(document.activeElement)) onRelease();
    return () => {
      element.removeEventListener("focusin", onFocusIn);
      element.removeEventListener("pointerdown", onPointerDown, { capture: true });
    };
  }, [ref, key, focusRequest, onRelease]);
}
