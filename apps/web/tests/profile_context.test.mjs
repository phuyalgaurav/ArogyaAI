import assert from "node:assert/strict";
import test from "node:test";
import { contextPreview } from "../src/features/profile/context.ts";

test("context preserves user words and dates without turning questions into facts", () => {
  const value = contextPreview("Prefers Nepali", [
    { text: "Could this be diabetes?", timestamp: "2026-10-10T10:00:00Z" },
  ]);
  assert.match(value, /Could this be diabetes\?/);
  assert.match(value, /not a verified medical fact/);
  assert.match(value, /2026-10-10/);
  assert.doesNotMatch(value, /has diabetes/);
});

test("the exact preview stays within the API limit and excludes excess history", () => {
  const value = contextPreview(
    "n".repeat(2000),
    Array.from({ length: 50 }, (_, i) => ({
      text: `${i}: ${"x".repeat(500)}`,
      timestamp: "2026-10-10T10:00:00Z",
    })),
  );
  assert.ok(value.length <= 4000);
  assert.ok(value.includes("0: "));
  assert.ok(!value.includes("49: "));
});
