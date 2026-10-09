/** Local endpoint detection. Audio stays on the device until a turn ends. */
export function createTurnDetector() {
  let speechMs = 0;
  let lastSpeechAt = 0;
  let previousAt: number | null = null;
  return (level: number, now: number) => {
    const step = previousAt === null ? 0 : Math.min(100, now - previousAt);
    previousAt = now;
    if (level >= 0.012) {
      speechMs += step;
      lastSpeechAt = now;
    }
    return {
      heardSpeech: speechMs >= 300,
      ended: speechMs >= 300 && now - lastSpeechAt >= 1200,
    };
  };
}

export function splitSpeech(answer: string, limit = 300) {
  const sentences = answer.match(/[^।.!?\n]+[।.!?]?/gu) || [answer];
  const parts: string[] = [];
  for (const sentence of sentences) {
    let rest = sentence.trim();
    while (rest.length > limit) {
      const space = rest.lastIndexOf(" ", limit);
      const cut = space > limit / 2 ? space : limit;
      parts.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) parts.push(rest);
  }
  return parts;
}
