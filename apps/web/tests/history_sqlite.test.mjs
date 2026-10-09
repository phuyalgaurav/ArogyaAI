import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(new URL("../package.json", import.meta.url));
const init = require("sql.js");
const { ChatSQLite } = require("./public/history-sqlite.js");
const SQL = await init();
const id = (number) => number.toString(16).padStart(32, "0");
const time = "2026-10-10T00:00:00.000Z";
const chat = (
  number = 1,
  message = 1,
  text = "Synthetic 2.5 mg — not treatment",
) => ({
  id: id(number),
  title: "Synthetic ' SQL; --",
  language: "en",
  created_at: time,
  updated_at: time,
  messages: [{ id: id(message), sender: "user", text, timestamp: time }],
});

test("real SQLite export reopens with complete messages and dates", () => {
  const first = new ChatSQLite(SQL);
  first.put(chat());
  first.current(id(1));
  const bytes = first.export();
  first.close();
  assert.equal(
    new TextDecoder().decode(bytes.slice(0, 16)),
    "SQLite format 3\0",
  );
  const reopened = new ChatSQLite(SQL, bytes);
  assert.equal(
    reopened.list()[0].messages[0].text,
    "Synthetic 2.5 mg — not treatment",
  );
  assert.equal(reopened.list()[0].messages[0].timestamp, time);
  assert.equal(reopened.current(), id(1));
  assert.equal(reopened.list()[0].title, "Synthetic ' SQL; --");
  assert.ok(!new TextDecoder().decode(bytes).includes("history_"));
  reopened.close();
});

test("stale snapshots merge immutable messages without duplicate records", () => {
  const db = new ChatSQLite(SQL);
  db.put(chat());
  db.put(chat(1, 2, "Second message"));
  db.put(chat());
  assert.equal(db.list()[0].messages.length, 2);
  assert.throws(
    () => db.put(chat(1, 1, "Changed message")),
    /previously saved message/,
  );
  assert.equal(
    db.list()[0].messages[0].text,
    "Synthetic 2.5 mg — not treatment",
  );
  db.close();
});

test("deletion tombstones survive export and stop offline resurrection", () => {
  const db = new ChatSQLite(SQL);
  db.put(chat());
  db.remove(id(1));
  assert.deepEqual(db.pendingDeleted(), [id(1)]);
  db.acknowledgeDeleted(id(1));
  assert.deepEqual(db.pendingDeleted(), []);
  const reopened = new ChatSQLite(SQL, db.export());
  assert.deepEqual(reopened.deleted(), [id(1)]);
  assert.throws(() => reopened.put(chat()), /deleted/);
  reopened.remove(id(1));
  assert.equal(reopened.list().length, 0);
  reopened.close();
  db.close();
});

test("bounded database rejects oversized chats and future formats", () => {
  const db = new ChatSQLite(SQL);
  assert.throws(() => db.put(chat(1, 1, "x".repeat(2001))), /Invalid/);
  const large = chat();
  large.messages = Array.from(
    { length: 101 },
    (_, i) => chat(1, i).messages[0],
  );
  assert.throws(() => db.put(large), /Invalid/);
  for (let i = 1; i <= 50; i++) db.put(chat(i));
  assert.throws(() => db.put(chat(51)), /History is full/);
  const future = new SQL.Database();
  future.run("PRAGMA user_version=99");
  assert.throws(() => new ChatSQLite(SQL, future.export()), /Unsupported/);
  db.close();
  future.close();
});

test("reviewed document context and dialogue survive SQLite export and are erased on deletion", () => {
  const db = new ChatSQLite(SQL);
  db.put(chat());
  const snapshot = {
    id: id(1),
    mode: "document",
    context_revision: 2,
    attachments: [
      {
        id: id(2),
        original_text: "Hb: १२.५ g/dL\nFriday",
        reviewed_text: "Hb: १२.५ g/dL\nMonday",
        review_history: [{ text: "Friday" }, { text: "Monday" }],
      },
    ],
    turns: [
      {
        id: id(3),
        message: "Which day?",
        answer: "Monday",
        references: [{ line_id: "L2", quote: "Monday" }],
      },
    ],
  };
  db.putContext(id(1), snapshot);
  const bytes = db.export();
  db.close();
  const restored = new ChatSQLite(SQL, bytes);
  assert.deepEqual(restored.context(id(1)), snapshot);
  restored.remove(id(1));
  assert.equal(restored.context(id(1)), null);
  assert.throws(
    () => restored.putContext(id(1), snapshot),
    /Invalid conversation/,
  );
  const deleted = new ChatSQLite(SQL, restored.export());
  assert.equal(deleted.context(id(1)), null);
  deleted.close();
  restored.close();
});
