/* Shared SQLite operations for the browser worker and actual SQLite tests. */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
function normalizedMessage(message) {
  if (
    !/^[a-f0-9]{32}$/.test(message.id) ||
    !["user", "assistant"].includes(message.sender) ||
    !message.text ||
    message.text.length > (message.sender === "user" ? 2000 : 6000) ||
    !Number.isFinite(Date.parse(message.timestamp))
  )
    throw new Error("Invalid saved chat message.");
  if (
    (message.sender === "user" && message.error) ||
    (message.error && message.error.length > 6000) ||
    (message.response &&
      (message.sender !== "assistant" ||
        message.response.answer !== message.text))
  )
    throw new Error("Saved answer does not match its response.");
  return {
    id: message.id,
    sender: message.sender,
    text: message.text,
    timestamp: new Date(message.timestamp).toISOString(),
    response: message.response ?? null,
    error: message.error ?? null,
  };
}
function normalizedConversation(value) {
  if (
    !/^[a-f0-9]{32}$/.test(value.id) ||
    !value.title ||
    value.title.length > 80 ||
    !["en", "ne", "tam"].includes(value.language) ||
    !value.messages.length ||
    value.messages.length > 100 ||
    !Number.isFinite(Date.parse(value.created_at)) ||
    !Number.isFinite(Date.parse(value.updated_at)) ||
    Date.parse(value.updated_at) < Date.parse(value.created_at)
  )
    throw new Error("Invalid saved conversation.");
  const messages = value.messages.map(normalizedMessage);
  if (new Set(messages.map((m) => m.id)).size !== messages.length)
    throw new Error("Duplicate message IDs.");
  const result = {
    ...value,
    created_at: new Date(value.created_at).toISOString(),
    updated_at: new Date(value.updated_at).toISOString(),
    messages,
  };
  if (new TextEncoder().encode(JSON.stringify(result)).length > 800000)
    throw new Error("This conversation is too large. Start a new chat.");
  return result;
}
class ChatSQLite {
  constructor(SQL, bytes) {
    this.db = new SQL.Database(bytes);
    const version = Number(this.db.exec("PRAGMA user_version")[0].values[0][0]);
    if (version !== 0 && version !== 1) {
      this.db.close();
      throw new Error("Unsupported chat database version.");
    }
    this.db.run(
      "PRAGMA secure_delete=ON; CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY,payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS deleted(id TEXT PRIMARY KEY,pending INTEGER NOT NULL DEFAULT 1); CREATE TABLE IF NOT EXISTS contexts(id TEXT PRIMARY KEY,payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS preferences(key TEXT PRIMARY KEY,value TEXT); PRAGMA user_version=1;",
    );
  }
  rows(sql, params = []) {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally {
      stmt.free();
    }
  }
  list() {
    return this.rows("SELECT payload FROM conversations")
      .map((row) => normalizedConversation(JSON.parse(row.payload)))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }
  deleted() {
    return this.rows("SELECT id FROM deleted").map((row) => String(row.id));
  }
  put(raw) {
    const incoming = normalizedConversation(raw);
    if (this.deleted().includes(incoming.id))
      throw new Error("This conversation was deleted.");
    const old = this.rows("SELECT payload FROM conversations WHERE id=?", [
      incoming.id,
    ])[0];
    let merged = incoming;
    if (old) {
      const previous = normalizedConversation(JSON.parse(old.payload));
      const messages = new Map(previous.messages.map((m) => [m.id, m]));
      for (const message of incoming.messages) {
        if (
          messages.has(message.id) &&
          JSON.stringify(canonical(messages.get(message.id))) !==
            JSON.stringify(canonical(message))
        )
          throw new Error("A previously saved message changed.");
        messages.set(message.id, message);
      }
      merged = normalizedConversation({
        ...previous,
        updated_at:
          incoming.updated_at > previous.updated_at
            ? incoming.updated_at
            : previous.updated_at,
        messages: [...messages.values()].sort(
          (a, b) =>
            a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id),
        ),
      });
    } else if (this.list().length >= 50)
      throw new Error(
        "History is full. Export or delete an older chat before saving more.",
      );
    this.db.run(
      "INSERT INTO conversations VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
      [merged.id, JSON.stringify(merged)],
    );
    return merged;
  }
  context(id) {
    const row = this.rows("SELECT payload FROM contexts WHERE id=?", [id])[0];
    return row ? JSON.parse(row.payload) : null;
  }
  profile() {
    const row = this.rows(
      "SELECT value FROM preferences WHERE key='user-profile'",
    )[0];
    return row ? JSON.parse(row.value) : { notes: "", choices: {} };
  }
  updateProfile(change) {
    const profile = this.profile();
    if (change.clear) {
      profile.notes = "";
      profile.choices = {};
    }
    if (change.notes !== undefined) {
      if (typeof change.notes !== "string" || change.notes.length > 2000)
        throw new Error("Profile notes must be at most 2000 characters.");
      profile.notes = change.notes;
    }
    if (change.choice) {
      const { id, context } = change.choice;
      if (
        !/^[a-f0-9]{32}$/.test(id) ||
        typeof context !== "string" ||
        context.length > 4000
      )
        throw new Error("Invalid per-chat context choice.");
      profile.choices[id] = context;
      const keys = Object.keys(profile.choices);
      for (const old of keys.slice(0, Math.max(0, keys.length - 100)))
        delete profile.choices[old];
    }
    this.db.run(
      "INSERT INTO preferences(key,value) VALUES('user-profile',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      [JSON.stringify(profile)],
    );
    return profile;
  }
  putContext(id, value) {
    if (
      !/^[a-f0-9]{32}$/.test(id) ||
      !/^[a-f0-9]{32}$/.test(value.id) ||
      !["document", "medicine", "health"].includes(value.mode) ||
      !Array.isArray(value.attachments) ||
      !Array.isArray(value.turns) ||
      this.deleted().includes(id)
    )
      throw new Error("Invalid conversation context.");
    const payload = JSON.stringify(value);
    if (new TextEncoder().encode(payload).length > 800000)
      throw new Error("This conversation context is too large.");
    if (!this.context(id) && this.rows("SELECT id FROM contexts").length >= 50)
      throw new Error("Context history is full. Delete an older conversation.");
    this.db.run(
      "INSERT INTO contexts VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
      [id, payload],
    );
  }
  remove(id) {
    if (!/^[a-f0-9]{32}$/.test(id)) throw new Error("Invalid conversation ID.");
    if (this.deleted().includes(id)) return;
    if (this.deleted().length >= 1000)
      throw new Error(
        "Deletion history is full. Export and reset this database.",
      );
    this.db.run("DELETE FROM conversations WHERE id=?", [id]);
    this.db.run("DELETE FROM contexts WHERE id=?", [id]);
    const profile = this.profile();
    delete profile.choices[id];
    this.db.run("UPDATE preferences SET value=? WHERE key='user-profile'", [
      JSON.stringify(profile),
    ]);
    this.db.run("INSERT OR IGNORE INTO deleted(id) VALUES(?)", [id]);
    this.db.run("VACUUM");
  }
  pendingDeleted() {
    return this.rows("SELECT id FROM deleted WHERE pending=1").map((row) =>
      String(row.id),
    );
  }
  acknowledgeDeleted(id) {
    this.db.run("UPDATE deleted SET pending=0 WHERE id=?", [id]);
  }
  current(id) {
    if (id !== undefined)
      this.db.run(
        "INSERT INTO preferences VALUES('current',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        [id],
      );
    return (
      this.rows("SELECT value FROM preferences WHERE key='current'")[0]
        ?.value || null
    );
  }
  export() {
    return this.db.export();
  }
  close() {
    this.db.close();
  }
}
if (typeof module !== "undefined")
  module.exports = { ChatSQLite, normalizedConversation };
else self.ChatSQLite = ChatSQLite;
