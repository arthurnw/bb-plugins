export const PROVIDERS = ["pi", "claude-code", "codex"] as const;
export type Provider = (typeof PROVIDERS)[number];
export const isProvider = (id: string): id is Provider => (PROVIDERS as readonly string[]).includes(id);
