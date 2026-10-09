import assert from "node:assert/strict";
import test from "node:test";
import {
  createTurnDetector,
  splitSpeech,
} from "../src/features/speech/lib/voice-turn.ts";

test("silence and a brief click never submit a voice turn", () => {
  const detect = createTurnDetector();
  for (let time = 0; time < 19000; time += 50) {
    const state = detect(time === 500 ? 0.1 : 0.001, time);
    assert.equal(state.ended, false);
    assert.equal(state.heardSpeech, false);
  }
});

test("a natural pause keeps a turn open and 1.2 seconds ends it", () => {
  const detect = createTurnDetector();
  for (let time = 0; time <= 500; time += 50) detect(0.04, time);
  assert.equal(detect(0, 1200).ended, false);
  assert.equal(detect(0.04, 1250).ended, false);
  assert.equal(detect(0, 2449).ended, false);
  assert.equal(detect(0, 2450).ended, true);
});

test("sentence playback preserves Nepali text inside server limits", () => {
  const answer = `नमस्कार। आज कस्तो छ? ${"औषधिको जानकारी ".repeat(100)}`;
  const parts = splitSpeech(answer);
  assert.equal(parts[0], "नमस्कार।");
  assert.equal(parts[1], "आज कस्तो छ?");
  assert.ok(parts.every((part) => part.length > 0 && part.length <= 300));
  assert.equal(parts.join(" ").replace(/\s/g, ""), answer.replace(/\s/g, ""));
  assert.deepEqual(splitSpeech("   "), []);
  assert.ok(splitSpeech("क".repeat(700)).every((part) => part.length <= 300));
});
