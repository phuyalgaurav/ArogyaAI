import assert from "node:assert/strict";
import test from "node:test";
import {
  admissibleDocument,
  documentLines,
  referencesMatch,
} from "../src/features/documents/lib/document-text.ts";

test("document references preserve decimal wording across common and Unicode line breaks", () => {
  const text =
    "\n Hb: 12.5 g/dL\r\nFollow-up Friday\u2028Example: 2.5 mg OD?\r";
  assert.deepEqual(documentLines(text), [
    "Hb: 12.5 g/dL",
    "Follow-up Friday",
    "Example: 2.5 mg OD?",
  ]);
  assert.equal(
    referencesMatch(text, {
      items: [{ line_id: "L3", quote: "Example: 2.5 mg OD?" }],
      answer_line_ids: ["L3"],
    }),
    true,
  );
});
test("changed amounts, unknown or duplicate references fail closed", () => {
  for (const result of [
    { items: [{ line_id: "L1", quote: "Amount: 25 mg" }], answer_line_ids: [] },
    {
      items: [{ line_id: "L01", quote: "Amount: 2.5 mg" }],
      answer_line_ids: [],
    },
    {
      items: [
        { line_id: "L1", quote: "Amount: 2.5 mg" },
        { line_id: "L1", quote: "Amount: 2.5 mg" },
      ],
      answer_line_ids: [],
    },
    { items: [], answer_line_ids: ["L9"] },
  ])
    assert.equal(referencesMatch("Amount: 2.5 mg", result), false);
});
test("document admission avoids silently dropping long lines or later pages", () => {
  assert.equal(admissibleDocument(""), false);
  assert.equal(admissibleDocument("a".repeat(501)), false);
  assert.equal(admissibleDocument("line\n".repeat(41)), false);
  assert.equal(admissibleDocument("line\n".repeat(40)), true);
  assert.equal(admissibleDocument(`${"a".repeat(499)}\n`), true);
});
