import { test } from "node:test";
import assert from "node:assert/strict";
import { childForest, childListHeight, CHILD_ROW_H } from "./children.ts";

const t = (id: string, parentThreadId: string | null, createdAt = 0) => ({ id, parentThreadId, createdAt });

test("children and grandchildren fold into the top-level card, oldest first", () => {
  const { rootOf, rowsOf } = childForest([
    t("root", null),
    t("b", "root", 2),
    t("a", "root", 1),
    t("a1", "a", 3),
    t("solo", null),
  ]);
  assert.deepEqual(rowsOf.get("root"), [
    { id: "a", depth: 1 },
    { id: "a1", depth: 2 },
    { id: "b", depth: 1 },
  ]);
  assert.equal(rootOf.get("a1"), "root");
  assert.equal(rowsOf.has("solo"), false);
  assert.equal(rootOf.has("root"), false);
});

test("a child whose parent isn't on the canvas stays top-level", () => {
  const { rootOf, rowsOf } = childForest([t("orphan", "archived-parent"), t("kid", "orphan")]);
  assert.equal(rootOf.has("orphan"), false);
  assert.equal(rootOf.get("kid"), "orphan");
  assert.equal(rowsOf.get("orphan")?.length, 1);
});

test("a parent cycle in bad data keeps every thread, under its lowest id", () => {
  const { rootOf, rowsOf } = childForest([t("x", "y"), t("y", "x")]);
  assert.deepEqual(rowsOf.get("x"), [{ id: "y", depth: 1 }]);
  assert.equal(rootOf.get("y"), "x");
  assert.equal(rootOf.has("x"), false);
});

test("childListHeight grows by a row height per child", () => {
  assert.equal(childListHeight(0), 0);
  assert.equal(childListHeight(3) - childListHeight(2), CHILD_ROW_H);
});
