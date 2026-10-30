export type OverlayShortcut = "open" | "next" | "previous" | "branch-name" | "existing-ref" | "model";

export function projectShortcut(event: { key: string; code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; isComposing: boolean }, mac: boolean): OverlayShortcut | null {
  if (event.isComposing) return null;
  const modShift = (mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey) && event.shiftKey && !event.altKey;
  if (event.code === "KeyB" || event.key.toLowerCase() === "b") return modShift ? "branch-name" : null;
  if (event.code === "KeyE" || event.key.toLowerCase() === "e") return modShift ? "existing-ref" : null;
  if (event.code === "KeyM" || event.key.toLowerCase() === "m") return modShift ? "model" : null;
  if (event.code !== "KeyJ" && event.key.toLowerCase() !== "j") return null;
  if (event.altKey && !event.metaKey && !event.ctrlKey) return event.shiftKey ? "previous" : "next";
  return modShift ? "open" : null;
}

/** Cmd+Enter (Ctrl+Enter elsewhere) starts a thread without opening it. */
export function isBackgroundSubmit(event: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; isComposing: boolean }, mac: boolean): boolean {
  return event.key === "Enter" && !event.isComposing && !event.altKey && !event.shiftKey
    && (mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey);
}
