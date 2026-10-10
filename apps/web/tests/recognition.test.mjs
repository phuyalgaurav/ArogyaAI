import assert from "node:assert/strict";
import test from "node:test";
import {
  pollRecognition,
  recognitionError,
} from "../src/features/conversations/recognition.ts";

test("recognition polling returns the completed job", async () => {
  const signal = new AbortController().signal;
  let calls = 0;
  const result = await pollRecognition(
    { status: "processing" },
    async (bounded) => {
      assert.equal(bounded.aborted, false);
      calls++;
      return { status: calls === 2 ? "completed" : "processing" };
    },
    signal,
    500,
    1,
  );
  assert.equal(result.status, "completed");
  assert.equal(calls, 2);
});

test("a stalled poll respects the overall recognition deadline", async () => {
  // Keep the test event loop alive: AbortSignal.timeout uses an unref'ed timer.
  const keepAlive = setInterval(() => {}, 1000);
  try {
    await assert.rejects(
      pollRecognition(
        { status: "processing" },
        (signal) =>
          new Promise((_, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), {
              once: true,
            });
          }),
        new AbortController().signal,
        30,
        1,
      ),
      /Image reading timed out/,
    );
  } finally {
    clearInterval(keepAlive);
  }
});

test("cancelling between polls stops without issuing another request", async () => {
  const controller = new AbortController();
  let called = false;
  const pending = pollRecognition(
    { status: "processing" },
    async () => {
      called = true;
      return { status: "completed" };
    },
    controller.signal,
    500,
    100,
  );
  controller.abort();
  await assert.rejects(pending, /Image reading cancelled/);
  assert.equal(called, false);
});

test("reader failures give actionable messages", () => {
  assert.match(recognitionError("model_busy"), /another request/);
  assert.match(
    recognitionError("invalid_photo_draft"),
    /another reading model/,
  );
  assert.match(recognitionError("prescription_vision_timeout"), /timed out/);
});
