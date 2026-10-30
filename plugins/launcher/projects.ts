export interface ProjectOption {
  id: string;
  name: string;
}

interface ProjectRecord {
  id: string;
  name: string;
  kind: string;
}

export const PERSONAL_LABEL = "No project";

// Keeps bb's list order and moves the personal project ("Don't work in a
// project") to the end, labeled the way the picker shows it.
export function toOptions(projects: readonly ProjectRecord[]): ProjectOption[] {
  const regular = projects.filter((p) => p.kind !== "personal").map((p) => ({ id: p.id, name: p.name }));
  const personal = projects.find((p) => p.kind === "personal");
  return personal ? [...regular, { id: personal.id, name: PERSONAL_LABEL }] : regular;
}

export function cycle(options: readonly ProjectOption[], currentId: string | null | undefined, step: 1 | -1) {
  if (options.length === 0) return null;
  const index = options.findIndex((o) => o.id === currentId);
  if (index === -1) return options[step === 1 ? 0 : options.length - 1] ?? null;
  return options[(index + step + options.length) % options.length] ?? null;
}

// Case-insensitive subsequence match, ranked: prefix, then substring, then
// subsequence. Ties keep list order.
export function filter(options: readonly ProjectOption[], query: string): ProjectOption[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [...options];
  const scored: { option: ProjectOption; score: number; index: number }[] = [];
  options.forEach((option, index) => {
    const name = option.name.toLowerCase();
    let score: number;
    if (name.startsWith(q)) score = 0;
    else if (name.includes(q)) score = 1;
    else if (isSubsequence(q, name)) score = 2;
    else return;
    scored.push({ option, score, index });
  });
  return scored.sort((a, b) => a.score - b.score || a.index - b.index).map((s) => s.option);
}

function isSubsequence(needle: string, haystack: string) {
  let i = 0;
  for (const ch of haystack) {
    if (ch === needle[i]) i++;
    if (i === needle.length) return true;
  }
  return false;
}
