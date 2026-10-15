import { createContext, useContext } from "react";
import type { Note, PinnedChat } from "../server";
import type { FrameNodeData } from "./nodes";
import type { FrameColor } from "./shared.ts";

/** Actions the node components call; provided once by the canvas. */
export interface CanvasActions {
  select(threadId: string): void;
  open(threadId: string, split: boolean): void;
  newThreadIn(frame: FrameNodeData): void;
  setFrameColor(frameKey: string, color: FrameColor): void;
  renameSection(sectionId: string, name: string): void;
  deleteSection(sectionId: string): void;
  updateNote(note: Note): void;
  updateChat(chat: PinnedChat): void;
  /** Pins a thread's chat beside its card, or unpins it. */
  togglePin(threadId: string): void;
  unpinChat(threadId: string): void;
  /** Marks a pinned chat as the one being worked with. */
  focusChat(threadId: string): void;
  /** Hands keyboard focus back to the canvas. */
  releaseFocus(): void;
  deleteNote(id: string): void;
}

export const CanvasActionsContext = createContext<CanvasActions | null>(null);

export function useCanvasActions(): CanvasActions {
  const actions = useContext(CanvasActionsContext);
  if (actions === null) throw new Error("CanvasActionsContext is missing");
  return actions;
}
