// Turns a pending interaction into what an inbox row can show and answer
// inline: approvals get Approve and Reject, a single one-choice question gets
// its options as buttons, and everything else is answered in the thread.

type Permissions = {
  fileSystem: { read: string[]; write: string[] } | null;
  network: { enabled: boolean | null } | null;
};

export type Resolution =
  | { decision: "allow_once" | "allow_for_session"; grantedPermissions: Permissions | null }
  | { decision: "deny" }
  | { kind: "user_answer"; answers: Record<string, { selected: string[]; freeText?: string }> };

export type Ask =
  | { kind: "approval"; id: string; title: string; detail: string | null; approve: Resolution; reject: Resolution }
  | {
      kind: "choice";
      id: string;
      title: string;
      detail: string | null;
      options: { label: string; description: string | null; resolution: Resolution }[];
    }
  | { kind: "open"; id: string; title: string; detail: string | null };

interface InteractionLike {
  id: string;
  status: string;
  payload: { kind: string } & Record<string, unknown>;
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

type Subject =
  | { kind: "command"; command: string; cwd: string | null }
  | { kind: "file_change"; writeScope: string | null }
  | { kind: "permission_grant"; toolName: string | null; permissions: Permissions }
  | { kind: "plan"; plan: string }
  | { kind: "tool_use"; presentation: { label: { pending: string }; detail?: string; title?: string } }
  | { kind: string };

function describeSubject(subject: Subject): { title: string; detail: string | null } {
  switch (subject.kind) {
    case "command": {
      const s = subject as Extract<Subject, { kind: "command" }>;
      return { title: "Wants to run a command", detail: clip(s.command, 400) };
    }
    case "file_change": {
      const s = subject as Extract<Subject, { kind: "file_change" }>;
      return { title: "Wants to change files", detail: s.writeScope };
    }
    case "permission_grant": {
      const s = subject as Extract<Subject, { kind: "permission_grant" }>;
      const writes = s.permissions.fileSystem?.write ?? [];
      const parts = [
        writes.length > 0 ? `Write: ${writes.join(", ")}` : null,
        s.permissions.network?.enabled ? "Network access" : null,
      ].filter(Boolean);
      return { title: s.toolName ? `Wants permission for ${s.toolName}` : "Wants more permissions", detail: parts.join(" · ") || null };
    }
    case "plan": {
      const s = subject as Extract<Subject, { kind: "plan" }>;
      return { title: "Wants to start on a plan", detail: clip(s.plan.trim(), 400) };
    }
    case "tool_use": {
      const s = subject as Extract<Subject, { kind: "tool_use" }>;
      return { title: s.presentation.label.pending, detail: s.presentation.detail ?? s.presentation.title ?? null };
    }
    default:
      return { title: "Wants your approval", detail: null };
  }
}

/** The first pending interaction in `interactions`, as something to show. */
export function askOf(interactions: readonly InteractionLike[]): Ask | null {
  const pending = interactions.find((interaction) => interaction.status === "pending");
  if (pending === undefined) return null;
  const payload = pending.payload;

  if (payload.kind === "approval") {
    const decisions = (payload.availableDecisions as string[] | undefined) ?? [];
    const subject = payload.subject as Subject;
    const described = describeSubject(subject);
    const reason = typeof payload.reason === "string" ? payload.reason : null;
    const granted = subject.kind === "permission_grant" ? (subject as { permissions: Permissions }).permissions : null;
    if (!decisions.includes("deny") || !(decisions.includes("allow_once") || decisions.includes("allow_for_session"))) {
      return { kind: "open", id: pending.id, ...described };
    }
    return {
      kind: "approval",
      id: pending.id,
      title: described.title,
      detail: described.detail ?? reason,
      approve: {
        decision: decisions.includes("allow_once") ? "allow_once" : "allow_for_session",
        grantedPermissions: granted,
      },
      reject: { decision: "deny" },
    };
  }

  if (payload.kind === "user_question") {
    const questions = (payload.questions as {
      id: string;
      prompt: string;
      multiSelect: boolean;
      options?: { label: string; value: string; description?: string }[];
    }[]) ?? [];
    const only = questions.length === 1 ? questions[0] : undefined;
    if (only && !only.multiSelect && only.options && only.options.length > 0 && only.options.length <= 6) {
      return {
        kind: "choice",
        id: pending.id,
        title: only.prompt,
        detail: null,
        options: only.options.map((option) => ({
          label: option.label,
          description: option.description ?? null,
          resolution: { kind: "user_answer", answers: { [only.id]: { selected: [option.value] } } },
        })),
      };
    }
    const title = questions[0]?.prompt ?? "Asked you a question";
    return { kind: "open", id: pending.id, title, detail: questions.length > 1 ? `${questions.length} questions` : null };
  }

  const title = typeof payload.title === "string" ? payload.title : "Waiting on you";
  return { kind: "open", id: pending.id, title, detail: null };
}
