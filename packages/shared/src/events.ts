// Window events plugins use to open the new-thread and handoff composers.
// The Launcher answers the `bb-launcher:*` events; when nothing handles one,
// the Bots plugin's own dialog answers the `bb-bots:*` event.

export const LAUNCHER_NEW_THREAD_EVENT = "bb-launcher:new-thread";
export const LAUNCHER_HANDOFF_EVENT = "bb-launcher:handoff";
export const BOTS_NEW_THREAD_EVENT = "bb-bots:new-thread";
export const BOTS_HANDOFF_EVENT = "bb-bots:handoff";
/** Dispatched on window after bots or thread bindings change. */
export const BOTS_CHANGED_EVENT = "bb-bots:changed";

/** Files a new thread in a section; `sectionId: null` means outside sections. */
export interface NewThreadPlacement {
  sectionId: string | null;
  pinned: boolean;
}

export interface NewThreadDetail {
  projectId?: string | null;
  placement?: NewThreadPlacement | null;
  /** The machine to seed the environment on. */
  hostId?: string | null;
  /** The bot to start with; null starts without one; omitted keeps the default. */
  botId?: string | null;
}

export interface HandoffDetail {
  threadId: string;
  projectId: string | null;
  botId?: string | null;
}

/** Dispatches a cancelable event; true when a listener called `preventDefault`. */
function handled(name: string, detail: unknown): boolean {
  return !window.dispatchEvent(new CustomEvent(name, { detail, cancelable: true }));
}

/** Opens a new-thread composer. Returns false when no plugin handled it. */
export function openNewThread(detail: NewThreadDetail): boolean {
  return handled(LAUNCHER_NEW_THREAD_EVENT, detail) || handled(BOTS_NEW_THREAD_EVENT, detail);
}

/** Opens a handoff composer for a started thread. Returns false when no plugin handled it. */
export function openHandoff(detail: HandoffDetail): boolean {
  return handled(LAUNCHER_HANDOFF_EVENT, detail) || handled(BOTS_HANDOFF_EVENT, detail);
}

/** Calls `listener` for each event; the listener returns true when it handled it. Returns a cleanup. */
export function onEvent<T>(name: string, listener: (detail: T) => boolean | void): () => void {
  const handler = (event: Event) => {
    if (listener((event as CustomEvent<T>).detail) !== false) event.preventDefault();
  };
  window.addEventListener(name, handler);
  return () => window.removeEventListener(name, handler);
}

export const onNewThread = (listener: (detail: NewThreadDetail | null) => boolean | void) =>
  onEvent<NewThreadDetail | null>(LAUNCHER_NEW_THREAD_EVENT, listener);
export const onHandoff = (listener: (detail: HandoffDetail) => boolean | void) =>
  onEvent<HandoffDetail>(LAUNCHER_HANDOFF_EVENT, listener);

/** Bots' own dialog answers these when no Launcher handled the Launcher events. */
export const onBotsNewThread = (listener: (detail: NewThreadDetail | null) => boolean | void) =>
  onEvent<NewThreadDetail | null>(BOTS_NEW_THREAD_EVENT, listener);
export const onBotsHandoff = (listener: (detail: HandoffDetail) => boolean | void) =>
  onEvent<HandoffDetail>(BOTS_HANDOFF_EVENT, listener);

export function notifyBotsChanged(): void {
  window.dispatchEvent(new Event(BOTS_CHANGED_EVENT));
}
