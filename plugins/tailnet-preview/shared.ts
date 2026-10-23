/** Realtime channel the frontend listens on to open a URL. */
export const OPEN_CHANNEL = "open-url";

export type OpenPayload = {
  id: string;
  url: string;
  /** Thread that requested the preview; null when run outside a thread. */
  threadId: string | null;
};
