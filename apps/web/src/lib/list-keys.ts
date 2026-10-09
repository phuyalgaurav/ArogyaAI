export function stableTextEntries(values: readonly string[]) {
  const occurrences = new Map<string, number>();
  return values.map((text) => {
    const occurrence = occurrences.get(text) ?? 0;
    occurrences.set(text, occurrence + 1);
    return { text, key: `${text}:${occurrence}` };
  });
}
