import { useEffect, useRef, type RefObject } from "react";

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
) {
  const lastRequest = useRef(focusRequest);
  useEffect(() => {
    if (focusRequest !== lastRequest.current) {
      lastRequest.current = focusRequest;
      return;
    }
    const element = ref.current;
    if (element === null) return;
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
