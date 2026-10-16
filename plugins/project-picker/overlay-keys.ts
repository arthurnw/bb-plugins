export function projectShortcut(event: { key: string; code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; isComposing: boolean }, mac: boolean): "open" | "next" | "previous" | null {
  if (event.isComposing || (event.code !== "KeyJ" && event.key.toLowerCase() !== "j")) return null;
  if (event.altKey && !event.metaKey && !event.ctrlKey) return event.shiftKey ? "previous" : "next";
  if (!event.altKey && event.shiftKey && (mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey)) return "open";
  return null;
}
