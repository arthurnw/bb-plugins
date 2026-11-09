export const KINDS = ["code", "tests", "mocks", "generated", "docs"] as const;
export type Kind = (typeof KINDS)[number];

export const KIND_LABELS: Record<Kind, string> = {
  code: "Code",
  tests: "Tests",
  mocks: "Mocks",
  generated: "Generated",
  docs: "Docs",
};

export type ChangedFile = { path: string; additions: number; deletions: number; binary?: boolean };
export type Totals = { additions: number; deletions: number };
export type Group = Totals & { kind: Kind; files: ChangedFile[] };

const dir = (names: string) => new RegExp(`(^|/)(${names})/`, "i");

// Checked in order; the first match wins. Mocks precede tests so that
// `tests/fixtures/**` counts as mocks.
const RULES: Array<[Kind, RegExp[]]> = [
  [
    "generated",
    [
      /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|Gemfile\.lock|poetry\.lock|uv\.lock|composer\.lock|go\.sum|mix\.lock|Podfile\.lock|flake\.lock)$/,
      /\.lock$/,
      /\.(min|bundle)\.(js|css)$/,
      /\.(generated|gen)\.[^/]+$/,
      /\.(pb\.go|pb2\.py|pb2_grpc\.py|g\.dart)$/,
      /\.map$/,
      dir("dist|build|vendor|node_modules|generated|__generated__"),
    ],
  ],
  [
    "mocks",
    [
      dir("__mocks__|mocks?|fixtures?|__fixtures__|cassettes|__snapshots__|testdata|stubs?"),
      /\.(snap|cassette\.ya?ml)$/,
      /\.(mock|stub|fixture)s?\.[^/]+$/,
    ],
  ],
  [
    "tests",
    [
      /\.(test|spec)\.[^/]+$/,
      /(_test|_spec)\.[^/]+$/,
      /(^|\/)test_[^/]+\.py$/,
      /(Test|Tests|Spec)\.(java|kt|swift|cs|scala)$/,
      dir("tests?|__tests__|specs?|e2e|cypress|playwright"),
    ],
  ],
  [
    "docs",
    [
      /\.(md|mdx|rst|txt|adoc)$/i,
      /(^|\/)(LICENSE|CHANGELOG|NOTICE|CODEOWNERS)[^/]*$/,
      dir("docs?"),
    ],
  ],
];

export function classify(path: string): Kind {
  for (const [kind, patterns] of RULES) {
    if (patterns.some((pattern) => pattern.test(path))) return kind;
  }
  return "code";
}

/** Groups files by kind in KINDS order, omitting kinds with no files. */
export function summarize(files: ChangedFile[]): { groups: Group[]; total: Totals } {
  const byKind = new Map<Kind, Group>();
  const total = { additions: 0, deletions: 0 };
  for (const file of files) {
    const kind = classify(file.path);
    const group = byKind.get(kind) ?? { kind, additions: 0, deletions: 0, files: [] };
    group.additions += file.additions;
    group.deletions += file.deletions;
    group.files.push(file);
    byKind.set(kind, group);
    total.additions += file.additions;
    total.deletions += file.deletions;
  }
  return { groups: KINDS.flatMap((kind) => byKind.get(kind) ?? []), total };
}
