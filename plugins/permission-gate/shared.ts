// Values shared by server.ts and app.tsx. Kept free of SDK imports so the app
// bundle doesn't pull in server code.
export const permissionModes = ["protected", "permissive", "yolo"] as const;
export type PermissionMode = (typeof permissionModes)[number];

export const MODE_CHANGED = "mode-changed";
export interface ModeChanged {
  threadId: string;
  mode: PermissionMode;
}
