import type { DocumentExplainResult } from "@arogya/contracts";

export function documentLines(text: string) {
  // Match Python splitlines so references survive CRLF and Unicode separators.
  return (
    text
      // biome-ignore lint/suspicious/noControlCharactersInRegex: Python splitlines treats these control characters as document line boundaries.
      .split(/\r\n|[\n\r\v\f\x1c-\x1e\u0085\u2028\u2029]/)
      .map((line) => line.trim())
      .filter(Boolean)
  );
}
export function admissibleDocument(text: string) {
  const lines = documentLines(text);
  return (
    text.length <= 8000 &&
    lines.length > 0 &&
    lines.length <= 40 &&
    lines.every((line) => line.length <= 500)
  );
}
export function referencesMatch(
  text: string,
  result: Pick<DocumentExplainResult, "items" | "answer_line_ids">,
) {
  const lines = documentLines(text);
  const ids = result.items.map((item) => item.line_id);
  return (
    new Set(ids).size === ids.length &&
    result.items.every(
      (item) =>
        /^L[1-9][0-9]?$/.test(item.line_id) &&
        item.quote === lines[Number(item.line_id.slice(1)) - 1],
    ) &&
    new Set(result.answer_line_ids).size === result.answer_line_ids.length &&
    result.answer_line_ids.every((id) => ids.includes(id))
  );
}
