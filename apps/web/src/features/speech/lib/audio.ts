export function encodeWav(samples: Float32Array, sampleRate = 16000) {
  const data = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(data);
  const write = (at: number, text: string) =>
    [...text].forEach((char, i) => {
      view.setUint8(at + i, char.charCodeAt(0));
    });
  write(0, "RIFF");
  view.setUint32(4, data.byteLength - 8, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, i) => {
    const value = Math.min(1, Math.max(-1, sample));
    view.setInt16(44 + i * 2, value < 0 ? value * 32768 : value * 32767, true);
  });
  return new Blob([data], { type: "audio/wav" });
}

export async function prepareAudio(blob: Blob) {
  if (blob.size > 4 * 1024 * 1024)
    throw new Error("Choose a clip smaller than 4 MB.");
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    if (decoded.duration < 0.3 || decoded.duration > 20)
      throw new Error("Use a clip between 0.3 and 20 seconds.");
    const output = new OfflineAudioContext(
      1,
      Math.round(decoded.duration * 16000),
      16000,
    );
    const source = output.createBufferSource();
    source.buffer = decoded;
    source.connect(output.destination);
    source.start();
    const rendered = await output.startRendering();
    return encodeWav(rendered.getChannelData(0));
  } finally {
    await context.close();
  }
}

export async function audioBase64(blob: Blob) {
  const data = new Uint8Array(await blob.arrayBuffer());
  let text = "";
  for (let offset = 0; offset < data.length; offset += 8192)
    text += String.fromCharCode(...data.subarray(offset, offset + 8192));
  return btoa(text);
}

export function audioBlob(encoded: string) {
  return new Blob(
    [Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0))],
    { type: "audio/wav" },
  );
}
