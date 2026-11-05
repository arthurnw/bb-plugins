// Window-local state for Bots' own composer dialog, used when no Launcher
// answered the new-thread or handoff event. Closed sessions stay mounted so
// drafts and selections survive, as in the Launcher's overlay.
import type { NewThreadPlacement } from "@arthurnw/bb-shared/events";

export type DialogKind = "new-thread" | "handoff";

export interface DialogContext {
  projectId: string | null;
  /** The thread being handed off. */
  threadId: string | null;
  placement: NewThreadPlacement | null;
  hostId: string | null;
  /** The bot to start with; null starts without one; undefined keeps the default (a handoff's source bot, else none). */
  botId?: string | null;
}

export interface DialogSession extends DialogContext {
  /** Changes whenever a fresh session starts; keys the composer's mount. */
  id: number;
  kind: DialogKind;
}

export interface DialogState {
  active: DialogKind | null;
  sessions: Record<DialogKind, DialogSession | null>;
  focusRequest: number;
}

let state: DialogState = { active: null, sessions: { "new-thread": null, handoff: null }, focusRequest: 0 };
let nextId = 1;
const listeners = new Set<() => void>();
let newThreadHasDraft: (() => boolean) | null = null;
const update = (next: Partial<DialogState>) => { state = { ...state, ...next }; listeners.forEach((listener) => listener()); };

function matches(kind: DialogKind, session: DialogSession, context: DialogContext) {
  if (session.botId !== context.botId) return false;
  if (kind === "handoff") return session.threadId === context.threadId;
  return (session.placement?.sectionId ?? null) === (context.placement?.sectionId ?? null)
    && (session.placement?.pinned ?? false) === (context.placement?.pinned ?? false)
    && session.hostId === context.hostId;
}

export const dialog = {
  open(kind: DialogKind, context: DialogContext) {
    const current = state.sessions[kind];
    // An untouched new-thread session is replaced so it re-seeds from the
    // project in view; with no registered check, assume a draft and keep it.
    const resume = current !== null && matches(kind, current, context) && (kind !== "new-thread" || (newThreadHasDraft?.() ?? true));
    const session: DialogSession = resume ? current : { ...context, id: nextId++, kind, threadId: kind === "handoff" ? context.threadId : null };
    update({ active: kind, sessions: { ...state.sessions, [kind]: session }, focusRequest: state.focusRequest + 1 });
  },
  /** Reports whether the mounted new-thread session holds a draft; returns an unregister function. */
  registerDraftCheck(check: () => boolean): () => void {
    newThreadHasDraft = check;
    return () => { if (newThreadHasDraft === check) newThreadHasDraft = null; };
  },
  close() { update({ active: null }); },
  /** Ends a session after it is submitted. */
  finish(kind: DialogKind) {
    update({ active: state.active === kind ? null : state.active, sessions: { ...state.sessions, [kind]: null } });
  },
  getState: () => state,
};
export const subscribeDialog = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
