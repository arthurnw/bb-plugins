import { z } from "zod";

export const DEFAULT_ROOT = "~/.bb/worktrees";

/** Shape check only; each host checks the expanded path against its own filesystem. */
export const worktreeRootSchema = z.string().refine(
  (value) => { const text = value.trim(); return text === "" || /^(~|~\/.*|\/.*)$/.test(text) && !/[\0\r\n]/.test(text); },
  { message: 'Enter an absolute path or one starting with "~/", or leave it empty for the default.' },
);
