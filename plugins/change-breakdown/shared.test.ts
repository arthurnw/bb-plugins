import assert from "node:assert/strict";
import { test } from "node:test";
import { classify, summarize } from "./shared.ts";

test("classifies paths", () => {
  const cases: Record<string, string> = {
    "src/app.ts": "code",
    "src/app.test.ts": "tests",
    "pkg/foo_test.go": "tests",
    "tests/test_api.py": "tests",
    "src/__tests__/a.ts": "tests",
    "tests/fixtures/user.json": "mocks",
    "src/__mocks__/api.ts": "mocks",
    "src/__snapshots__/a.snap": "mocks",
    "README.md": "docs",
    "docs/plans/x.yaml": "docs",
    "package-lock.json": "generated",
    "web/dist/app.js": "generated",
    "api/user.pb.go": "generated",
    "src/latest/index.ts": "code",
  };
  for (const [path, kind] of Object.entries(cases)) assert.equal(classify(path), kind, path);
});

test("sums by kind in fixed order and omits empty kinds", () => {
  const { groups, total } = summarize([
    { path: "a.test.ts", additions: 10, deletions: 1 },
    { path: "a.ts", additions: 3, deletions: 2 },
    { path: "b.ts", additions: 1, deletions: 0 },
  ]);
  assert.deepEqual(groups.map((g) => [g.kind, g.additions, g.deletions, g.files.length]), [
    ["code", 4, 2, 2],
    ["tests", 10, 1, 1],
  ]);
  assert.deepEqual(total, { additions: 14, deletions: 3 });
});
