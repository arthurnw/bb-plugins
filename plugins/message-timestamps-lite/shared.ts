// Imported by both server.ts and app.tsx; keep it free of server-only imports.
export const LAST_REPLY_CHANNEL = "last-reply";
export type LastReplySignal = { threadId: string; at: number };
