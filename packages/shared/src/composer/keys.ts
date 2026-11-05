/** Cmd+Enter (Ctrl+Enter elsewhere) starts a thread without opening it. */
export function isBackgroundSubmit(event: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; isComposing: boolean }, mac: boolean): boolean {
  return event.key === "Enter" && !event.isComposing && !event.altKey && !event.shiftKey
    && (mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey);
}
