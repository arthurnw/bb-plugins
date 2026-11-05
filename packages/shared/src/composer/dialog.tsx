import { useEffect, useRef, useState, type ComponentProps, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { experimental_NewThreadComposer as NewThreadComposer, useBbNavigate } from "@get-bb/plugin-sdk/app";
import { isBackgroundSubmit } from "./keys.ts";
import { HOST_MODEL_PICKER, useModelSlot } from "./model-slot.ts";

type ComposerProps = ComponentProps<typeof NewThreadComposer>;
export type ComposerRequest = Parameters<NonNullable<ComposerProps["onSubmit"]>>[0];

const MAC = /Mac|iPhone|iPad/.test(navigator.platform);

// The SDK exposes no draft state for the embedded composer. Check the editor
// text, then bb's persisted draft (which also covers attachments). The storage
// key format is bb-internal (0.46.1); if it changes, attachment-only drafts
// re-seed their selections, but the draft itself is kept by draftKey.
export function hasDraft(section: HTMLElement | null, draftKey: string): boolean {
  return !!section?.querySelector("[data-promptbox-editor-content]")?.textContent?.trim()
    || localStorage.getItem(`bb.promptbox.contents-plugin-draft-${encodeURIComponent(draftKey)}-3`) !== null;
}

export interface ComposerDialogProps {
  visible: boolean;
  /** The dialog's accessible name. */
  label: string;
  placeholder: string;
  /** Append the "↵ open · ⌘↵ background" hint to the placeholder. Default true. */
  hint?: boolean;
  draftKey: string;
  focusRequest: number | undefined;
  /** The dialog element, for the caller's own key handling and draft checks. */
  sectionRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  /** While a popup is open, Escape belongs to it. */
  popupOpen?: boolean;
  /** False while the caller loads what the composer needs to seed. */
  ready: boolean;
  composerProps: Omit<ComposerProps, "layout" | "draftKey" | "focusRequest" | "placeholder" | "onSubmit">;
  /**
   * Undefined keeps bb's model picker. Otherwise bb's picker is hidden, and a
   * node is shown in its place (null shows nothing).
   */
  modelTrigger?: ReactNode | null;
  /** Shown before bb's model picker, which stays visible. Ignored when `modelTrigger` is set. */
  chip?: ReactNode;
  /** Starts the thread; the dialog then closes, and opens it or toasts for a background start. */
  submit: (request: ComposerRequest) => Promise<{ threadId: string }>;
  /** Called after a thread starts, before navigating. */
  onStarted: () => void;
  /** Toast text for a background start. */
  startedMessage?: string;
  /** Popups shown under the composer. */
  children?: ReactNode;
}

/**
 * The floating dialog around bb's new-thread composer: backdrop, Escape
 * (after Composer Vim and bb's @-menu), Enter to open the new thread and
 * Cmd/Ctrl+Enter to start it in the background.
 */
export function ComposerDialog({
  visible, label, placeholder, hint = true, draftKey, focusRequest, sectionRef, onClose, popupOpen = false, ready,
  composerProps, modelTrigger, chip, submit, onStarted, startedMessage = "Thread started", children,
}: ComposerDialogProps) {
  const navigate = useBbNavigate();
  const [composerRoot, setComposerRoot] = useState<HTMLDivElement | null>(null);
  const modelSlot = useModelSlot(composerRoot, (modelTrigger ?? chip ?? null) !== null);
  // Enter opens the new thread; Cmd+Enter (Ctrl+Enter elsewhere) leaves it in the background.
  const backgroundRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // bb's editor calls preventDefault on every Escape, so this listens in the
  // capture phase. It is added after composer-vim's capture listener, so an
  // Escape that vim consumes (Insert → Normal) is already defaultPrevented;
  // the next Escape reaches here and closes.
  useEffect(() => {
    if (!visible || popupOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      const section = sectionRef.current;
      if (!section || !(event.target instanceof Node) || !section.contains(event.target)) return;
      // Let bb close its @-mention and command menu first.
      if (section.querySelector("[data-promptbox-typeahead-menu]")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [visible, popupOpen, sectionRef]);

  const close = (e: { target: EventTarget; currentTarget: EventTarget }) => { if (e.target === e.currentTarget) onClose(); };
  return <div style={{ display: visible ? "block" : "none", position: "fixed", inset: 0, zIndex: 50, background: "rgb(0 0 0 / .3)" }} onPointerDown={close}>
    <div style={{ position: "absolute", inset: 0, display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "15vh 16px 16px", overflowY: "auto", boxSizing: "border-box" }} onPointerDown={close}>
    <section role="dialog" aria-label={label} style={{ width: "100%", maxWidth: 720, padding: 16, borderRadius: 12, background: "var(--background)", color: "var(--foreground)" }} ref={sectionRef}
      onPointerDownCapture={() => { backgroundRef.current = false; }}
      onKeyDownCapture={(event: ReactKeyboardEvent) => {
        if (event.key !== "Enter" || !composerRoot?.contains(event.target as Node)) return;
        backgroundRef.current = isBackgroundSubmit(event.nativeEvent, MAC);
        if (!backgroundRef.current) return;
        event.preventDefault();
        event.stopPropagation();
        composerRoot.querySelector<HTMLFormElement>("form[data-promptbox]")?.requestSubmit();
      }}>
      {modelTrigger !== undefined && <style>{`[data-bb-composer-root] ${HOST_MODEL_PICKER} { display: none !important; }`}</style>}
      {ready && <div ref={setComposerRoot} data-bb-composer-root=""><NewThreadComposer
        {...composerProps}
        draftKey={draftKey}
        layout="document"
        focusRequest={focusRequest}
        placeholder={hint ? `${placeholder}  ·  ↵ open  ·  ${MAC ? "⌘↵" : "Ctrl+↵"} background` : placeholder}
        onSubmit={async request => {
          const background = backgroundRef.current;
          backgroundRef.current = false;
          try {
            const { threadId } = await submit(request);
            onStarted();
            if (background) toast.success(startedMessage, { action: { label: "Open", onClick: () => navigate.toThread(threadId) } });
            else navigate.toThread(threadId);
          } catch (error) { toast.error(`Could not start thread: ${String(error)}`); throw error; }
        }}
      />
      {modelSlot && (modelTrigger ?? chip) && createPortal(modelTrigger ?? chip, modelSlot)}
      </div>}
      {children}
    </section>
    </div>
  </div>;
}
