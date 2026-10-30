import { useRpc, type PluginEnvironmentProviderInputsProps } from "@get-bb/plugin-sdk/app";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { z } from "zod";
import type { refChoicesSchema } from "./contract";
import { existingInputsSchema, parseRef, type Resolved } from "./existing-branch";
import { createFocusRegistry } from "./focus-field";
import type { quickComposeRpcContract } from "./server";

type Choices = z.infer<typeof refChoicesSchema>;
type Check = { status: "empty" } | { status: "checking" } | { status: "error"; message: string } | { status: "ok"; resolved: Resolved };

const RESOLVE_DELAY_MS = 350;

const registry = createFocusRegistry();

/** True on phone-width screens, where the list becomes a bottom sheet above the keyboard. */
function useNarrow() {
  const [narrow, setNarrow] = useState(() => window.matchMedia("(max-width: 640px)").matches);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 640px)");
    const update = () => setNarrow(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return narrow;
}

/** Space the on-screen keyboard covers at the bottom of the layout viewport, and the visible height. */
function useKeyboard(active: boolean) {
  const [state, setState] = useState({ inset: 0, height: window.innerHeight });
  useEffect(() => {
    const vv = window.visualViewport;
    if (!active || !vv) return;
    const update = () => setState({ inset: Math.max(0, window.innerHeight - vv.height - vv.offsetTop), height: vv.height });
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => { vv.removeEventListener("resize", update); vv.removeEventListener("scroll", update); };
  }, [active]);
  return state;
}

/** Focuses a visible PR/branch field matching `within`; returns false when none is mounted yet. */
export const focusExistingRef = registry.focus;
export const existingRefFocused = registry.focused;

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
  const [filter, setFilter] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const chip = useRef<HTMLButtonElement>(null);
  const filterField = useRef<HTMLInputElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const narrow = useNarrow();
  const keyboard = useKeyboard(open && narrow);
  // A command that focuses the chip also opens the picker, whose filter field then takes focus.
  useEffect(() => (chip.current ? registry.register(chip.current, () => setOpen(true)) : undefined), []);
  useEffect(() => (open && filterField.current ? registry.register(filterField.current) : undefined), [open]);
  // On a phone the keyboard would cover the list, so only desktop focuses the filter on open.
  useEffect(() => { if (open && !narrow) filterField.current?.focus(); }, [open, narrow]);

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
    const onOutside = (event: PointerEvent) => { const target = event.target as Node;
      if (!box.current?.contains(target) && !sheet.current?.contains(target)) close(); };
    document.addEventListener("pointerdown", onOutside);
    return () => document.removeEventListener("pointerdown", onOutside);
  }, [open]);

  const query = filter.trim().toLowerCase();
  const prs = useMemo(() => (choices?.prs ?? []).filter((pr) => !query || `#${pr.number} ${pr.title} ${pr.headRefName}`.toLowerCase().includes(query)), [choices, query]);
  const branches = useMemo(() => (choices?.branches ?? []).filter((name) => !query || name.toLowerCase().includes(query)).slice(0, 40), [choices, query]);
  const typed = filter.trim();
  const offerTyped = typed !== "" && parseRef(typed).kind !== "invalid"
    && !(choices?.branches ?? []).includes(typed) && !prs.some((pr) => `#${pr.number}` === typed);
  const close = () => { setOpen(false); setFilter(""); };
  const pick = (next: string) => { reviewTouched.current = false; setText(next); close(); chip.current?.focus(); };

  const status = check.status === "ok" ? describe(check.resolved)
    : check.status === "error" ? { text: check.message, short: check.message, tone: "bad" as const }
    : check.status === "checking" ? { text: "Checking…", short: "Checking…", tone: "neutral" as const } : null;

  return (
    <div ref={box} style={{ position: "relative", display: "flex", alignItems: "center", gap: 8, minWidth: 0, flexShrink: 1 }}>
      <button ref={chip} type="button" aria-haspopup="listbox" aria-expanded={open} title={status?.text ?? "Choose a PR or branch"}
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={(event) => { if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key !== "Tab") event.stopPropagation(); }}
        style={{ flex: "0 1 260px", minWidth: 0, display: "inline-flex", alignItems: "center", gap: 6, // On phones, match the host dropdowns beside it: no border, same text size.
          boxSizing: "border-box", height: narrow ? undefined : 32,
          padding: narrow ? "6px 4px" : "0 8px", border: narrow ? "1px solid transparent" : "1px solid var(--border)", lineHeight: 1.2,
          borderRadius: 4, background: "transparent", color: status ? "var(--foreground)" : "var(--muted-foreground)", fontSize: narrow ? 15 : 13,
          cursor: "pointer", whiteSpace: "nowrap", textAlign: "left" }}>
        {status && <span style={{ width: 8, height: 8, borderRadius: "50%", flex: "none", background: TONES[status.tone] }} />}
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", flex: 1 }}>{status ? (check.status === "ok" ? status.short : text.trim()) : "Choose PR or branch…"}</span>
        <span aria-hidden style={{ flex: "none", opacity: 0.6, lineHeight: 1, alignSelf: "center" }}>⌄</span>
      </button>
      <button type="button" role="switch" aria-checked={review} title="Start with a Plannotator guided review"
        onClick={() => { reviewTouched.current = true; setReview(!review); }}
        style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 6px", border: 0, borderRadius: 4, background: "transparent",
          color: "var(--foreground)", fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" }}>
        <span style={{ width: 26, height: 15, borderRadius: 8, position: "relative", background: review ? "var(--primary, #6d5bd0)" : "var(--muted-foreground, #a1a1aa)", transition: ".15s" }}>
          <span style={{ position: "absolute", top: 2, left: review ? 13 : 2, width: 11, height: 11, borderRadius: "50%", background: "var(--background, #fff)", transition: ".15s" }} />
        </span>
        Review
      </button>
      {open && (() => {
        const list = (
          <div ref={sheet} style={narrow
            ? { position: "fixed", zIndex: 1000, left: 0, right: 0, bottom: keyboard.inset, maxHeight: Math.min(keyboard.height * 0.7, 460), display: "flex", flexDirection: "column",
                border: "1px solid var(--border)", borderRadius: "12px 12px 0 0", background: "var(--popover, var(--background))", color: "var(--foreground)",
                padding: 8, fontSize: 15, boxShadow: "0 -8px 24px rgb(0 0 0 / .18)" }
            : { position: "absolute", zIndex: 60, top: "calc(100% + 4px)", left: 0, width: 420, maxHeight: 360, display: "flex", flexDirection: "column",
                border: "1px solid var(--border)", borderRadius: 8, background: "var(--popover, var(--background))", padding: 4, fontSize: 13 }}>
            <input ref={filterField} aria-label="Filter PRs and branches" placeholder="Filter, or type a PR number, URL, or branch" value={filter}
              onChange={(event) => setFilter(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") { event.preventDefault(); close(); chip.current?.focus(); }
                if (event.key === "Enter") {
                  event.preventDefault();
                  const first = offerTyped ? typed : prs[0] ? `#${prs[0].number}` : branches[0];
                  if (first) pick(first);
                }
                if (!event.metaKey && !event.ctrlKey && !event.altKey) event.stopPropagation();
              }}
              // iOS zooms the page when a focused field is under 16px.
              style={{ margin: narrow ? "0 0 8px" : "0 0 4px", padding: "6px 8px", border: "1px solid var(--border)", borderRadius: 6, background: "transparent",
                color: "var(--foreground)", fontSize: narrow ? 16 : 13, flex: "none" }} />
            <div role="listbox" style={{ overflowY: "auto", overscrollBehavior: "contain", touchAction: "pan-y", minHeight: 0 }}>
              {choices === null && <Row muted>Loading…</Row>}
              {choices?.prError && <Row muted>PRs unavailable: {choices.prError}</Row>}
              {offerTyped && <Row tall={narrow} onPick={() => pick(typed)}>Use “{typed}”</Row>}
              {prs.length > 0 && <Section>Open pull requests</Section>}
              {prs.map((pr) => <Row key={pr.number} tall={narrow} onPick={() => pick(`#${pr.number}`)} meta={narrow ? undefined : pr.headRefName}>#{pr.number} {pr.title}</Row>)}
              {branches.length > 0 && <Section>Remote branches</Section>}
              {branches.map((name) => <Row key={name} tall={narrow} onPick={() => pick(name)}>{name}</Row>)}
              {choices !== null && !offerTyped && prs.length === 0 && branches.length === 0 && <Row muted>No matches.</Row>}
            </div>
          </div>
        );
        // A portal keeps the sheet out of any transformed or clipped ancestor, so `fixed` is relative to the screen.
        return narrow ? createPortal(list, document.body) : list;
      })()}
    </div>
  );
}

function Section({ children }: { children: string }) {
  return <div style={{ padding: "6px 8px 2px", fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--muted-foreground)" }}>{children}</div>;
}

function Row({ children, meta, muted, tall, onPick }: { children: React.ReactNode; meta?: string; muted?: boolean; tall?: boolean; onPick?: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <div role={onPick ? "option" : undefined} aria-selected={false} onMouseDown={(event) => { if (onPick) event.preventDefault(); }}
      onClick={() => onPick?.()}
      onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}
      style={{ display: "flex", gap: 8, padding: tall ? "12px 8px" : "6px 8px", borderRadius: 6, cursor: onPick ? "pointer" : "default",
        color: muted ? "var(--muted-foreground)" : "var(--foreground)", background: hover && onPick ? "var(--accent, #f4f4f5)" : "transparent" }}>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{children}</span>
      {meta && <span style={{ marginLeft: "auto", color: "var(--muted-foreground)", fontSize: 12, whiteSpace: "nowrap" }}>{meta}</span>}
    </div>
  );
}
