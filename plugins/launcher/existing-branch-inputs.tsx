import { useRpc, type PluginEnvironmentProviderInputsProps } from "@get-bb/plugin-sdk/app";
import { useEffect, useMemo, useRef, useState } from "react";
import type { z } from "zod";
import type { refChoicesSchema } from "./contract";
import { existingInputsSchema, parseRef, type Resolved } from "./existing-branch";
import { createFocusRegistry } from "./focus-field";
import type { quickComposeRpcContract } from "./server";

type Choices = z.infer<typeof refChoicesSchema>;
type Check = { status: "empty" } | { status: "checking" } | { status: "error"; message: string } | { status: "ok"; resolved: Resolved };

const RESOLVE_DELAY_MS = 350;

const registry = createFocusRegistry();

/** Focuses a visible PR/branch field matching `within`; returns false when none is mounted yet. */
export const focusExistingRef = registry.focus;
export const existingRefShown = registry.shown;

/** The status line under the field, and its dot color. */
export function describe(resolved: Resolved): { text: string; short: string; tone: "good" | "warn" | "bad" | "neutral" } {
  const { pr } = resolved;
  if (resolved.busyAt) return { text: `Branch is already checked out at ${resolved.busyAt}`, short: "Checked out elsewhere", tone: "bad" };
  if (!pr) return { text: `No PR · diff against ${resolved.base.replace(/^origin\//, "")}`, short: "No PR", tone: "neutral" };
  const where = pr.isCrossRepository ? `fork ${pr.headRefName}` : `into ${pr.baseRefName}`;
  const text = `PR #${pr.number} · ${pr.title} · ${where}`;
  const short = `#${pr.number} ${pr.title}`;
  return pr.state === "OPEN" ? { text, short, tone: "good" }
    : { text: `${pr.state === "MERGED" ? "Merged" : "Closed"} ${text}`, short: `${pr.state === "MERGED" ? "Merged" : "Closed"} ${short}`, tone: "warn" };
}

const TONES = { good: "#16a34a", warn: "#d97706", bad: "#dc2626", neutral: "#a1a1aa" } as const;

export function ExistingBranchInputs(props: PluginEnvironmentProviderInputsProps) {
  const targetKey = props.target.kind === "existing-host" ? props.target.hostId : "new-host";
  return <Inputs key={`${props.projectId}:${targetKey}`} {...props} />;
}

function Inputs({ projectId, target, value, onChange }: PluginEnvironmentProviderInputsProps) {
  const rpc = useRpc<typeof quickComposeRpcContract>();
  const hostId = target.kind === "existing-host" ? target.hostId : null;
  const saved = existingInputsSchema.safeParse(value);
  const [text, setText] = useState(saved.success ? saved.data.ref : "");
  const [review, setReview] = useState(saved.success ? saved.data.review : false);
  const reviewTouched = useRef(saved.success);
  const [check, setCheck] = useState<Check>({ status: "empty" });
  const [choices, setChoices] = useState<Choices | null>(null);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => (field.current ? registry.register(field.current) : undefined), []);

  // Load the picker's candidates the first time the field opens.
  useEffect(() => {
    if (!open || choices !== null || hostId === null || projectId === null) return;
    let cancelled = false;
    rpc.call("existingRefs", { projectId, hostId }).then((result) => { if (!cancelled) setChoices(result); },
      () => { if (!cancelled) setChoices({ prs: [], branches: [], prError: "Could not load branches." }); });
    return () => { cancelled = true; };
  }, [open, choices, hostId, projectId, rpc]);

  useEffect(() => {
    const parsed = parseRef(text);
    if (text.trim() === "") { setCheck({ status: "empty" }); return; }
    if (parsed.kind === "invalid") { setCheck({ status: "error", message: parsed.reason }); return; }
    if (hostId === null || projectId === null) { setCheck({ status: "error", message: "Choose an existing machine first." }); return; }
    setCheck({ status: "checking" });
    let cancelled = false;
    const timer = setTimeout(() => {
      rpc.call("resolveExisting", { projectId, hostId, ref: text.trim() }).then((result) => {
        if (cancelled) return;
        if (result.resolved === null) setCheck({ status: "error", message: result.error ?? "Could not resolve that branch or PR." });
        else {
          setCheck({ status: "ok", resolved: result.resolved });
          if (!reviewTouched.current) setReview(result.resolved.kind === "pr");
        }
      }, (error: unknown) => { if (!cancelled) setCheck({ status: "error", message: error instanceof Error ? error.message : String(error) }); });
    }, RESOLVE_DELAY_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [text, hostId, projectId, rpc]);

  useEffect(() => {
    if (check.status === "empty") onChange({ status: "blocked", reason: "Enter a PR number, a PR URL, or a branch name." });
    else if (check.status === "checking") onChange({ status: "blocked", reason: "Checking the branch or PR…" });
    else if (check.status === "error") onChange({ status: "blocked", reason: check.message });
    else if (check.resolved.busyAt) onChange({ status: "blocked", reason: describe(check.resolved).text });
    else onChange({ status: "ready", value: { ref: text.trim(), review } });
  }, [check, text, review, onChange]);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const query = text.trim().toLowerCase();
  const prs = useMemo(() => (choices?.prs ?? []).filter((pr) => !query || `#${pr.number} ${pr.title} ${pr.headRefName}`.toLowerCase().includes(query)), [choices, query]);
  const branches = useMemo(() => (choices?.branches ?? []).filter((name) => !query || name.toLowerCase().includes(query)).slice(0, 40), [choices, query]);
  const pick = (next: string) => { reviewTouched.current = false; setText(next); setOpen(false); };

  const status = check.status === "ok" ? describe(check.resolved)
    : check.status === "error" ? { text: check.message, short: check.message, tone: "bad" as const }
    : check.status === "checking" ? { text: "Checking…", short: "Checking…", tone: "neutral" as const } : null;

  return (
    <div ref={box} style={{ position: "relative", display: "flex", alignItems: "center", gap: 8, minWidth: 0, flexShrink: 1 }}>
      <input ref={field} aria-label="PR number, URL, or branch" placeholder="PR number, URL, or branch" value={text}
        onFocus={() => setOpen(true)}
        onChange={(event) => { reviewTouched.current = false; setText(event.target.value); setOpen(true); }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === "Escape") { event.preventDefault(); setOpen(false); }
          if (!event.metaKey && !event.ctrlKey && !event.altKey) event.stopPropagation();
        }}
        style={{ flex: "0 10 170px", width: 170, minWidth: 90, padding: "4px 8px", border: "1px solid var(--border)", borderRadius: 4,
          background: "transparent", color: "var(--foreground)", fontSize: 13 }} />
      <button type="button" role="switch" aria-checked={review} title="Start with a Plannotator guided review"
        onClick={() => { reviewTouched.current = true; setReview(!review); }}
        style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 6px", border: 0, borderRadius: 4, background: "transparent",
          color: "var(--foreground)", fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" }}>
        <span style={{ width: 26, height: 15, borderRadius: 8, position: "relative", background: review ? "var(--primary, #6d5bd0)" : "#d4d4d8", transition: ".15s" }}>
          <span style={{ position: "absolute", top: 2, left: review ? 13 : 2, width: 11, height: 11, borderRadius: "50%", background: "#fff", transition: ".15s" }} />
        </span>
        Review
      </button>
      {status && (
        <span title={status.text} style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0, overflow: "hidden", fontSize: 12,
          color: "var(--muted-foreground)", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", flex: "none", background: TONES[status.tone] }} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{status.short}</span>
        </span>
      )}
      {open && (
        <div role="listbox" style={{ position: "absolute", zIndex: 60, top: "calc(100% + 4px)", left: 0, width: 420, maxHeight: 320, overflowY: "auto",
          border: "1px solid var(--border)", borderRadius: 8, background: "var(--popover, var(--background))", padding: 4, fontSize: 13 }}>
          {choices === null && <Row muted>Loading…</Row>}
          {choices?.prError && <Row muted>PRs unavailable: {choices.prError}</Row>}
          {prs.length > 0 && <Section>Open pull requests</Section>}
          {prs.map((pr) => <Row key={pr.number} onPick={() => pick(`#${pr.number}`)} meta={pr.headRefName}>#{pr.number} {pr.title}</Row>)}
          {branches.length > 0 && <Section>Remote branches</Section>}
          {branches.map((name) => <Row key={name} onPick={() => pick(name)}>{name}</Row>)}
          {choices !== null && prs.length === 0 && branches.length === 0 && <Row muted>No matches. Enter uses the text as typed.</Row>}
        </div>
      )}
    </div>
  );
}

function Section({ children }: { children: string }) {
  return <div style={{ padding: "6px 8px 2px", fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--muted-foreground)" }}>{children}</div>;
}

function Row({ children, meta, muted, onPick }: { children: React.ReactNode; meta?: string; muted?: boolean; onPick?: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <div role={onPick ? "option" : undefined} aria-selected={false} onPointerDown={(event) => { if (onPick) { event.preventDefault(); onPick(); } }}
      onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}
      style={{ display: "flex", gap: 8, padding: "6px 8px", borderRadius: 6, cursor: onPick ? "pointer" : "default",
        color: muted ? "var(--muted-foreground)" : "var(--foreground)", background: hover && onPick ? "var(--accent, #f4f4f5)" : "transparent" }}>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{children}</span>
      {meta && <span style={{ marginLeft: "auto", color: "var(--muted-foreground)", fontSize: 12, whiteSpace: "nowrap" }}>{meta}</span>}
    </div>
  );
}
