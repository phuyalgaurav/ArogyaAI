// Only names are sent to the public reference lookup, never the full document.
export function medicineNames(
  text: string,
  medicineQuotes: string[] = [],
): string[] {
  const selected = new Set(medicineQuotes);
  const names = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const wording = line.trim();
    if (
      !selected.has(wording) &&
      !/\b(?:tab(?:let)?s?\.?|cap(?:sule)?s?\.?|syrup|injection|cream|ointment|drops|\d+(?:\.\d+)?\s*(?:mg|mcg|ml))\b/i.test(
        wording,
      )
    )
      continue;
    const name = wording
      .replace(/^\s*(?:\d+[.)]\s*|[-•]\s*)/, "")
      .replace(/^(?:Rx\s*[:.]?\s*)/i, "")
      .replace(
        /^(?:tab(?:let)?s?|cap(?:sule)?s?|syrup|injection|cream|ointment|drops)\.?\s+/i,
        "",
      )
      .split(
        /\s+\d|\s*[:;,]|\s+(?:OD|BD|BID|TID|QID|once|twice|daily|at night|after|before)\b/i,
      )[0]
      .replace(/\s+(?:tablets?|capsules?|syrup|cream|ointment|drops)$/i, "")
      .trim();
    if (
      name.length < 2 ||
      name.length > 100 ||
      !/^[\p{L}\s()+/-]+$/u.test(name)
    )
      continue;
    if (
      /^(?:take|apply|use|dose|Hb|hemoglobin|glucose|creatinine|cholesterol|vitamin level)$/i.test(
        name,
      )
    )
      continue;
    names.set(name.toLowerCase(), name);
    if (names.size === 12) break;
  }
  return [...names.values()];
}
