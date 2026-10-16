// Adapted from Sawyer Hood’s Quick Compose; see THIRD_PARTY_LICENSES.md.
// Window-local state shared by the overlay and commands.

export type QuickComposeKind = "new-thread" | "handoff";

export interface QuickComposeSession {
  /** Changes whenever a fresh session starts; keys the composer's mount. */
  id: number;
  /** The project in view when the session started; seeds the project picker. */
  projectId: string | null;
  /** The thread being handed off, or null for a plain new thread. */
  sourceThreadId: string | null;
}

export interface QuickComposeState {
  /** The session on screen, or null while closed. */
  active: QuickComposeKind | null;
  sessions: Record<QuickComposeKind, QuickComposeSession | null>;
  /** Bumped whenever the composer should focus its editor. */
  focusRequest: number;
}

export interface QuickComposeContext {
  projectId: string | null;
  threadId: string | null;
}

let state: QuickComposeState = {
  active: null,
  sessions: { "new-thread": null, handoff: null },
  focusRequest: 0,
};
let nextSessionId = 1;
const listeners = new Set<() => void>();
const draftChecks = new Map<QuickComposeKind, () => boolean>();

function update(next: Partial<QuickComposeState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

function withSession(
  kind: QuickComposeKind,
  session: QuickComposeSession | null,
): QuickComposeState["sessions"] {
  return { ...state.sessions, [kind]: session };
}

/** Whether the session was started for what `context` is showing. */
function matchesContext(
  kind: QuickComposeKind,
  session: QuickComposeSession,
  context: QuickComposeContext,
): boolean {
  return kind === "new-thread" || session.sourceThreadId === context.threadId;
}

export const quickCompose = {
  open(kind: QuickComposeKind, context: QuickComposeContext): void {
    const current = state.sessions[kind];
    // An untouched new-thread session is replaced so it re-seeds from the
    // project in view; with no registered check, assume a draft and keep it.
    const resume = current !== null && matchesContext(kind, current, context)
      && (kind !== "new-thread" || (draftChecks.get(kind)?.() ?? true));
    const session = resume
      ? current
      : {
          id: nextSessionId++,
          projectId: context.projectId,
          sourceThreadId: kind === "handoff" ? context.threadId : null,
        };
    update({
      active: kind,
      sessions: withSession(kind, session),
      focusRequest: state.focusRequest + 1,
    });
  },
  /** Reports whether the mounted session holds a draft; returns an unregister function. */
  registerDraftCheck(kind: QuickComposeKind, check: () => boolean): () => void {
    draftChecks.set(kind, check);
    return () => { if (draftChecks.get(kind) === check) draftChecks.delete(kind); };
  },
  /** Preserve mounted selections without inspecting host picker DOM. */
  close(): void {
    update({ active: null });
  },
  toggle(kind: QuickComposeKind, context: QuickComposeContext): void {
    const current = state.sessions[kind];
    if (
      state.active === kind &&
      current !== null &&
      matchesContext(kind, current, context)
    ) {
      quickCompose.close();
    } else {
      quickCompose.open(kind, context);
    }
  },
  /** Ends a session after it is submitted. */
  finish(kind: QuickComposeKind): void {
    update({
      active: state.active === kind ? null : state.active,
      sessions: withSession(kind, null),
    });
  },
  getState(): QuickComposeState {
    return state;
  },
};

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

