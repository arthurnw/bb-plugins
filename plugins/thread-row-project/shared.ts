export const DISPLAY_MODES = ["icon", "name", "both"] as const;
export type DisplayMode = (typeof DISPLAY_MODES)[number];

export const isImageUrl = (value: string) => /^(https?:\/\/|data:image\/)/i.test(value);
