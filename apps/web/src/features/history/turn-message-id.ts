// History IDs must remain 32 hexadecimal characters, including on turn retries.
export function turnUserMessageId(turnId: string): string {
  if (!/^[a-f0-9]{32}$/.test(turnId)) throw new Error("Invalid turn ID.");
  // Preserve the random ID's entropy and distinguish the paired user message.
  // This also works on local-network HTTP, where crypto.subtle is unavailable.
  return (Number.parseInt(turnId[0], 16) ^ 8).toString(16) + turnId.slice(1);
}
