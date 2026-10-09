import assert from "node:assert/strict";
import test from "node:test";
import {
  audioBase64,
  audioBlob,
  encodeWav,
} from "../src/features/speech/lib/audio.ts";

test("audio upload encodes real mono PCM headers, length and clipped samples", async () => {
  const blob = encodeWav(new Float32Array([-2, -1, 0, 1, 2]));
  const bytes = await blob.arrayBuffer();
  const view = new DataView(bytes);
  assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), "RIFF");
  assert.equal(new TextDecoder().decode(bytes.slice(8, 12)), "WAVE");
  assert.equal(view.getUint32(4, true), 46);
  assert.equal(view.getUint16(20, true), 1);
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(24, true), 16000);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(40, true), 10);
  assert.deepEqual(
    [0, 1, 2, 3, 4].map((i) => view.getInt16(44 + i * 2, true)),
    [-32768, -32768, 0, 32767, 32767],
  );
});

test("twenty second audio survives chunked base64 upload and playback decoding", async () => {
  const samples = Float32Array.from({ length: 320000 }, (_, i) =>
    Math.sin(i / 10),
  );
  const original = encodeWav(samples);
  const restored = audioBlob(await audioBase64(original));
  assert.equal(restored.size, 640044);
  assert.deepEqual(await restored.arrayBuffer(), await original.arrayBuffer());
});
