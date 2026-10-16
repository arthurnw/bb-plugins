import { useEffect, useState } from "react";
import {
  experimental_useThreadActions as useThreadActions,
  useSdk,
  type PluginSidebarThread,
  type PluginThreadActionTarget,
} from "@get-bb/plugin-sdk/app";

/** bb's own archive action: its confirmation for threads with children, and Undo. */
const ARCHIVE_KEY = "bb--core/archive";

export function threadTarget(thread: PluginSidebarThread): PluginThreadActionTarget {
  const environment = thread.environment;
  return {
    id: thread.id,
    projectId: thread.projectId,
    parentThreadId: thread.parentThreadId,
    archivedAt: thread.archivedAt,
    pinnedAt: thread.pinnedAt,
    sectionId: thread.sectionId,
    isUnread: thread.isUnread,
    status: thread.status,
    environment: environment?.id != null ? { id: environment.id, path: environment.path } : null,
  };
}

/** Runs bb's archive action for `thread`, or null when bb offers none (already archived). */
export function useArchive(thread: PluginSidebarThread): (() => void) | null {
  const [entry] = useThreadActions(threadTarget(thread), { keys: [ARCHIVE_KEY] });
  if (entry === undefined || thread.archivedAt !== null) return null;
  return () => void entry.action.run();
}

export interface Shortcut {
  key: string;
  mod: boolean;
  meta: boolean;
  control: boolean;
  alt: boolean;
  shift: boolean;
}

const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform);

/** The user's binding for bb's "Archive thread" command, read once from bb's settings. */
export function useArchiveShortcut(): Shortcut | null {
  const sdk = useSdk();
  const [shortcut, setShortcut] = useState<Shortcut | null>(null);
  useEffect(() => {
    let cancelled = false;
    sdk.system.config().then(
      (config) => {
        const binding = config.keybindings.find((entry) => entry.command === "thread.archive");
        if (!cancelled) setShortcut(binding?.shortcut ?? null);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [sdk]);
  return shortcut;
}

/** Whether a key event is `shortcut`; `mod` is Cmd on macOS and Ctrl elsewhere. */
export function matchesShortcut(event: KeyboardEvent, shortcut: Shortcut): boolean {
  const mac = isMac();
  const wantMeta = shortcut.meta || (shortcut.mod && mac);
  const wantControl = shortcut.control || (shortcut.mod && !mac);
  return (
    event.key.toLowerCase() === shortcut.key.toLowerCase() &&
    event.metaKey === wantMeta &&
    event.ctrlKey === wantControl &&
    event.altKey === shortcut.alt &&
    event.shiftKey === shortcut.shift
  );
}

export function shortcutLabel(shortcut: Shortcut): string {
  const mac = isMac();
  const parts: string[] = [];
  if (shortcut.control || (shortcut.mod && !mac)) parts.push(mac ? "⌃" : "Ctrl+");
  if (shortcut.alt) parts.push(mac ? "⌥" : "Alt+");
  if (shortcut.shift) parts.push(mac ? "⇧" : "Shift+");
  if (shortcut.meta || (shortcut.mod && mac)) parts.push("⌘");
  return parts.join("") + shortcut.key.toUpperCase();
}
