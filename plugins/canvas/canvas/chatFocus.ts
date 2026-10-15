import { useEffect, useRef, type RefObject } from "react";

/**
 * bb's ThreadChat focuses its composer when it mounts, which would swallow the
 * canvas's single-key shortcuts. After `key` changes (a new thread is shown),
 * hand focus back for a short while. A change in `focusRequest` is the user
 * asking to reply, so that ends the watch, as does clicking into the chat.
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
    const until = Date.now() + 2500;
    const onFocusIn = () => {
      if (Date.now() < until) onRelease();
    };
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
