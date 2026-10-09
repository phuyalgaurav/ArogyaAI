import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(new URL("../package.json", import.meta.url));
const ts = require("typescript");
const init = require("sql.js");
const { ChatSQLite } = require("./public/history-sqlite.js");
const source = ts.transpileModule(
  await readFile(
    new URL("../src/features/history/turn-message-id.ts", import.meta.url),
    "utf8",
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const { turnUserMessageId } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);
const moduleUrl = (text) =>
  `data:text/javascript;base64,${Buffer.from(text).toString("base64")}`;
const compile = async (path) =>
  ts.transpileModule(await readFile(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
const apiUrl = moduleUrl(await compile("../src/lib/api.ts"));
const conversationApi = await import(
  moduleUrl(
    (await compile("../src/features/conversations/api.ts")).replaceAll(
      '"@/lib/api"',
      JSON.stringify(apiUrl),
    ),
  )
);

test("a non-JSON gateway failure reports a retryable connection problem", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response("Internal Server Error", { status: 502 });
  try {
    await assert.rejects(
      conversationApi.conversationRequest({ token: "synthetic" }),
      (error) =>
        error.status === 502 && error.detail.includes("draft is still here"),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("turn message IDs save in real SQLite and remain stable when retried", async () => {
  const turnId = "a".repeat(32);
  const userId = await turnUserMessageId(turnId);
  assert.match(userId, /^[a-f0-9]{32}$/);
  assert.notEqual(userId, turnId);
  assert.equal(await turnUserMessageId(turnId), userId);
  const timestamp = "2026-10-10T00:00:00.000Z";
  const conversation = {
    id: "b".repeat(32),
    title: "Synthetic question",
    language: "en",
    created_at: timestamp,
    updated_at: timestamp,
    messages: [
      { id: userId, sender: "user", text: "Synthetic question", timestamp },
      {
        id: turnId,
        sender: "assistant",
        text: "Synthetic response",
        timestamp,
      },
    ],
  };
  const SQL = await init();
  const db = new ChatSQLite(SQL);
  db.put(conversation);
  db.put(conversation);
  const reopened = new ChatSQLite(SQL, db.export());
  assert.equal(reopened.list()[0].messages.length, 2);
  reopened.close();
  db.close();
});
