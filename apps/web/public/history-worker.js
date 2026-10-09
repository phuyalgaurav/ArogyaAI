/* SQLite bytes are persisted on this browser, never sent by this worker. */
importScripts("/sqlite/sql-wasm.js", "/history-sqlite.js");
const SQL = initSqlJs({ locateFile: (file) => `/sqlite/${file}` });
let queue = Promise.resolve();

function storage() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("arogya-local-history", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("files");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(new Error("Browser storage is unavailable."));
  });
}
async function read(key) {
  const db = await storage();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction("files", "readonly");
      const request = transaction.objectStore("files").get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}
async function write(key, value, expected) {
  const db = await storage();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("files", "readwrite");
      const files = tx.objectStore("files");
      let accepted = false;
      if (expected === undefined) {
        files.put(value, key);
        accepted = true;
      } else {
        const request = files.get(key);
        request.onsuccess = () => {
          if ((request.result?.version || 0) === expected) {
            files.put(value, key);
            accepted = true;
          }
        };
      }
      tx.oncomplete = () => resolve(accepted);
      tx.onerror = () =>
        reject(tx.error || new Error("History could not be saved."));
      tx.onabort = () =>
        reject(tx.error || new Error("History write was cancelled."));
    });
  } finally {
    db.close();
  }
}
async function privateFile() {
  if (!navigator.storage?.getDirectory || !navigator.locks) return false;
  try {
    await navigator.locks.request("arogya-history-file", async () => {
      const latest = await read("arogya-chat.sqlite");
      const directory = await navigator.storage.getDirectory();
      const file = await directory.getFileHandle("arogya-chat.sqlite", {
        create: true,
      });
      const writer = await file.createWritable();
      try {
        await writer.write(latest.bytes);
        await writer.close();
      } catch (error) {
        await writer.abort();
        throw error;
      }
    });
    return true;
  } catch {
    return false;
  }
}
async function permission(action, data) {
  const db = await storage();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("files", "readwrite");
      const files = tx.objectStore("files");
      let result;
      let failure;
      const profileRequest = files.get("server-access");
      profileRequest.onsuccess = () => {
        const profile = profileRequest.result;
        const keyRequest = files.get("history-key");
        keyRequest.onsuccess = () => {
          try {
            const key = keyRequest.result;
            if (action === "clear-meta") {
              result = profile?.access_token === data;
              if (result) {
                files.put(null, "server-access");
                files.put(null, "history-key");
              }
            } else if (action === "set-meta") {
              if (
                key?.token !== data.access_token ||
                (profile?.pending_delete && !data.pending_delete)
              )
                throw new Error(
                  "Server permission changed in another tab. Refresh history.",
                );
              files.put(data, "server-access");
              result = true;
            } else {
              if (profile?.pending_delete)
                throw new Error("Finish the pending server deletion first.");
              result =
                key?.token ||
                `history_${Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
              if (!key) files.put({ version: 1, token: result }, "history-key");
            }
          } catch (error) {
            failure = error;
            tx.abort();
          }
        };
      };
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () =>
        reject(
          failure ||
            tx.error ||
            new Error("History permission could not be saved."),
        );
    });
  } finally {
    db.close();
  }
}
async function execute(action, data) {
  if (["provision-key", "set-meta", "clear-meta"].includes(action))
    return permission(action, data);
  if (action === "meta") return read("server-access");
  const engine = await SQL;
  for (let attempt = 0; attempt < 5; attempt++) {
    const stored = await read("arogya-chat.sqlite");
    const db = new self.ChatSQLite(engine, stored?.bytes);
    try {
      if (action === "context") return db.context(data);
      if (action === "put-context") db.putContext(data.id, data.snapshot);
      if (action === "export") return { bytes: db.export() };
      if (action === "put") db.put(data);
      if (action === "delete") db.remove(data);
      if (action === "ack-delete") db.acknowledgeDeleted(data);
      if (action === "current") db.current(data);
      if (action === "merge") {
        for (const id of data.deleted_ids) {
          db.remove(id);
          db.acknowledgeDeleted(id);
        }
        const deleted = new Set(db.deleted());
        for (const conversation of data.conversations)
          if (!deleted.has(conversation.id)) db.put(conversation);
      }
      const result = {
        conversations: db.list(),
        deleted_ids: db.deleted(),
        pending_deleted_ids: db.pendingDeleted(),
        current_id: db.current(),
        storage: "indexeddb",
      };
      if (action === "list" && stored) return result;
      const bytes = db.export();
      if (bytes.byteLength > 16000000)
        throw new Error(
          "Local history has reached 16 MB. Export or delete older conversations.",
        );
      if (
        await write(
          "arogya-chat.sqlite",
          { bytes, version: (stored?.version || 0) + 1 },
          stored?.version || 0,
        )
      ) {
        result.storage = (await privateFile()) ? "private_file" : "indexeddb";
        return result;
      }
    } finally {
      db.close();
    }
  }
  throw new Error("Another tab is saving history. Try again.");
}
self.onmessage = (event) => {
  const { id, action, data } = event.data;
  queue = queue
    .catch(() => {})
    .then(async () => {
      try {
        self.postMessage({ id, result: await execute(action, data) });
      } catch (error) {
        self.postMessage({
          id,
          error:
            error instanceof Error ? error.message : "History storage failed.",
        });
      }
    });
};
