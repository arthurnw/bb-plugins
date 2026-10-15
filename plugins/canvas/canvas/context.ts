import { createContext, useContext } from "react";
import type { FrameColor, Note } from "../server";

/** Actions the node components call; provided once by the canvas. */
export interface CanvasActions {
  select(threadId: string): void;
  open(threadId: string, split: boolean): void;
  newThread(projectId: string): void;
  setFrameColor(projectId: string, color: FrameColor): void;
  updateNote(note: Note): void;
  deleteNote(id: string): void;
}

export const CanvasActionsContext = createContext<CanvasActions | null>(null);

export function useCanvasActions(): CanvasActions {
  const actions = useContext(CanvasActionsContext);
  if (actions === null) throw new Error("CanvasActionsContext is missing");
  return actions;
}
