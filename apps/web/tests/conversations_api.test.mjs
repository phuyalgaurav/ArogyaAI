import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

// Node does not resolve the Next @/ alias. Only resolve that import; exercise
// the production transport itself after stripping its TypeScript annotations.
const source = (
  await readFile(
    new URL("../src/features/conversations/api.ts", import.meta.url),
    "utf8",
  )
).replace(
  '"@/lib/api"',
  JSON.stringify(new URL("../src/lib/api.ts", import.meta.url).href),
);
const { conversationRequest } = await import(
  `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString("base64")}`
);

test("context transport keeps session and history authorization separate and propagates cancellation", async () => {
  const original = globalThis.fetch;
  const controller = new AbortController();
  let sent;
  globalThis.fetch = async (url, options) => {
    sent = { url, options };
    return new Response(JSON.stringify({ id: "a".repeat(32) }), {
      status: 201,
    });
  };
  try {
    const value = await conversationRequest(
      { token: "session-fixture", historyToken: "vault-fixture" },
      "",
      "POST",
      { mode: "document" },
      controller.signal,
    );
    assert.equal(value.id, "a".repeat(32));
    assert.equal(sent.url.endsWith("/api/v1/conversations"), true);
    assert.equal(sent.options.headers.Authorization, "Bearer session-fixture");
    assert.equal(sent.options.headers["X-History-Token"], "vault-fixture");
    assert.deepEqual(JSON.parse(sent.options.body), { mode: "document" });
    assert.equal(sent.options.credentials, "omit");
    assert.equal(sent.options.cache, "no-store");
    controller.abort();
    assert.equal(sent.options.signal.aborted, true);
  } finally {
    globalThis.fetch = original;
  }
});

test("structured stale-context failures show the backend message and retain status", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        detail: {
          code: "stale_context",
          retryable: false,
          message: "The reviewed context changed. Refresh before continuing.",
        },
      }),
      { status: 409 },
    );
  try {
    await assert.rejects(
      conversationRequest({ token: "session-fixture" }),
      (error) =>
        error.status === 409 &&
        error.detail ===
          "The reviewed context changed. Refresh before continuing.",
    );
  } finally {
    globalThis.fetch = original;
  }
});
