export function projectShortcut(event: { key: string; code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; isComposing: boolean }, mac: boolean): "open" | "next" | "previous" | "branch-name" | null {
  if (event.isComposing) return null;
  const modShift = (mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey) && event.shiftKey && !event.altKey;
  if (event.code === "KeyB" || event.key.toLowerCase() === "b") return modShift ? "branch-name" : null;
  if (event.code !== "KeyJ" && event.key.toLowerCase() !== "j") return null;
  if (event.altKey && !event.metaKey && !event.ctrlKey) return event.shiftKey ? "previous" : "next";
  return modShift ? "open" : null;
}
