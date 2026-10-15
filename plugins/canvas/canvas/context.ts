import { createContext, useContext } from "react";
import type { Note } from "../server";
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
  deleteNote(id: string): void;
}

export const CanvasActionsContext = createContext<CanvasActions | null>(null);

export function useCanvasActions(): CanvasActions {
  const actions = useContext(CanvasActionsContext);
  if (actions === null) throw new Error("CanvasActionsContext is missing");
  return actions;
}
