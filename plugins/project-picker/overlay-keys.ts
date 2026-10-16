export function projectShortcut(event: { key: string; code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; isComposing: boolean }, mac: boolean): "open" | "next" | "previous" | "branch-name" | null {
  if (event.isComposing) return null;
  if (event.code === "KeyB" || event.key.toLowerCase() === "b") {
    const mod = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
    return mod && event.shiftKey && !event.altKey ? "branch-name" : null;
  }
  if (event.code !== "KeyJ" && event.key.toLowerCase() !== "j") return null;
  if (event.altKey && !event.metaKey && !event.ctrlKey) return event.shiftKey ? "previous" : "next";
  if (!event.altKey && event.shiftKey && (mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey)) return "open";
  return null;
}
