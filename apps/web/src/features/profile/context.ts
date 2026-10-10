export interface UserProfile {
  notes: string;
  choices: Record<string, string>;
}

export function contextPreview(
  notes: string,
  messages: { text: string; timestamp: string }[],
): string {
  const parts = notes.trim()
    ? [`User-saved profile notes (unverified):\n${notes.trim()}`]
    : [];
  for (const message of messages) {
    const entry = `User's previous words, ${message.timestamp.slice(0, 10)} (not a verified medical fact):\n${message.text}`;
    if ([...parts, entry].join("\n\n").length <= 4000) parts.push(entry);
  }
  return parts.join("\n\n");
}
