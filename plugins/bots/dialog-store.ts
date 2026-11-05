// Window-local state for Bots' own composer dialog, used when no Launcher
// answered the new-thread or handoff event.
import type { NewThreadPlacement } from "@arthurnw/bb-shared/events";

export interface DialogSession {
  /** Changes whenever a fresh session starts; keys the composer's mount. */
  id: number;
  kind: "new-thread" | "handoff";
  projectId: string | null;
  /** The thread being handed off. */
  threadId: string | null;
  placement: NewThreadPlacement | null;
  hostId: string | null;
  /** The bot to start with; null starts without one; undefined keeps the default (a handoff's source bot, else none). */
  botId?: string | null;
}

export interface DialogState {
  session: DialogSession | null;
  focusRequest: number;
}

let state: DialogState = { session: null, focusRequest: 0 };
let nextId = 1;
const listeners = new Set<() => void>();
const update = (next: Partial<DialogState>) => { state = { ...state, ...next }; listeners.forEach((listener) => listener()); };

export const dialog = {
  open(session: Omit<DialogSession, "id">) {
    update({ session: { ...session, id: nextId++ }, focusRequest: state.focusRequest + 1 });
  },
  close() { update({ session: null }); },
  getState: () => state,
};
export const subscribeDialog = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
