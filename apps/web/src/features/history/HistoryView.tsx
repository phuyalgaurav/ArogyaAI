"use client";

import { useEffect, useRef, useState } from "react";
import { historyOrigin } from "@/features/history/api";
import { useHistory } from "@/features/history/HistoryContext";

export function HistoryView({
  locale,
  onOpen,
  onNew,
}: {
  locale: "en" | "ne" | "tam";
  onOpen: (id: string) => Promise<void>;
  onNew: () => void;
}) {
  const ne = locale === "ne";
  const history = useHistory();
  const [modes, setModes] = useState<
    Record<string, "document" | "medicine" | "health">
  >({});
  const latest = useRef(history);
  latest.current = history;
  useEffect(() => {
    let live = true;
    void Promise.all(
      history.conversations.map(
        async (item) =>
          [item.id, await latest.current.readContext(item.id)] as const,
      ),
    )
      .then((entries) => {
        if (live) {
          setAttachmentText(
            Object.fromEntries(
              entries.map(([id, context]) => [
                id,
                context?.attachments
                  ?.map((item) => item.reviewed_text || item.original_text)
                  .join(" ") || "",
              ]),
            ),
          );
          setModes(
            Object.fromEntries(
              entries
                .filter((entry) => entry[1])
                .map(([id, context]) => [id, context?.mode]),
            ) as Record<string, "document" | "medicine" | "health">,
          );
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [history.conversations]);
  const [attachmentText, setAttachmentText] = useState<Record<string, string>>(
    {},
  );
  const [resumeErrors, setResumeErrors] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<
    "all" | "document" | "medicine" | "health"
  >("all");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [allowed, setAllowed] = useState(false);
  const [action, setAction] = useState<"enable" | "disable" | string>("");
  const dialog = useRef<HTMLDialogElement>(null);
  const locked = busy || history.sending || history.syncing || history.saving;

  function getBadgeLabel(cat: "document" | "medicine" | "health") {
    switch (cat) {
      case "document":
        return ne ? "कागजात / रिपोर्ट" : "Prescription & Report";
      case "medicine":
        return ne ? "औषधि" : "Medicine Info";
      case "health":
        return ne ? "स्वास्थ्य जिज्ञासा" : "Health Question";
    }
  }

  const visible = history.conversations.filter((item) => {
    const msgs = item.messages.map((m) => m.text).join(" ");
    const matchesSearch =
      `${item.title}\n${msgs}\n${attachmentText[item.id] || ""}`
        .toLowerCase()
        .includes(query.toLowerCase());
    if (!matchesSearch) return false;
    if (categoryFilter === "all") return true;
    return modes[item.id] === categoryFilter;
  });

  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setStatus(null);
    try {
      await work();
    } catch (failure) {
      setStatus(
        failure instanceof Error ? failure.message : "History action failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  function confirm(next: string) {
    setAction(next);
    setAllowed(false);
    dialog.current?.showModal();
  }

  async function download() {
    const bytes = await history.exportSqlite();
    const url = URL.createObjectURL(
      new Blob([Uint8Array.from(bytes).buffer], {
        type: "application/vnd.sqlite3",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "arogya-chat.sqlite";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus(
      "SQLite export downloaded. Keep it somewhere private; it contains your saved messages.",
    );
  }

  return (
    <section className="history-workspace" aria-labelledby="history-title">
      <header className="workspace-heading">
        <span className="eyebrow">
          {ne ? "सुरक्षित कुराकानीहरू" : "PAST CHAT RECORDS"}
        </span>
        <h1 id="history-title">
          {ne ? "विगतका कुराकानीहरू" : "Past chat records"}
        </h1>
        <p>
          {ne
            ? "कागजात, औषधि तथा स्वास्थ्य सम्बन्धी विगतका सबै कुराकानी खोल्नुहोस् वा जारी राख्नुहोस्।"
            : "Find and continue a document, medicine or health conversation."}
        </p>
      </header>

      <button
        type="button"
        className="btn btn-outline"
        disabled={locked}
        onClick={onNew}
      >
        {ne ? "नयाँ कुराकानी" : "New chat"}
      </button>
      {/* Filter Tabs & Search Row */}
      <div className="history-filter-controls">
        <fieldset
          className="history-category-pills"
          aria-label={ne ? "कुराकानीको प्रकार" : "Filter by type"}
        >
          {(
            [
              { id: "all", label: ne ? "सबै" : "All" },
              {
                id: "document",
                label: ne ? "कागजात" : "Prescriptions & Reports",
              },
              { id: "medicine", label: ne ? "औषधि" : "Medicines" },
              { id: "health", label: ne ? "स्वास्थ्य" : "Health Questions" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`filter-pill ${categoryFilter === tab.id ? "active" : ""}`}
              aria-pressed={categoryFilter === tab.id}
              onClick={() => setCategoryFilter(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </fieldset>

        <label className="history-search">
          <span className="sr-only">Search saved chats</span>
          <input
            type="search"
            value={query}
            placeholder={
              ne ? "शीर्षक वा सन्देश खोज्नुहोस्..." : "Search titles or messages..."
            }
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>

      {status && (
        <p role="status" className="notice">
          {status}
        </p>
      )}

      {/* Conversations List */}
      <div className="history-list">
        {visible.map((item) => {
          const cat = modes[item.id];
          return (
            <article key={item.id} className="history-row">
              <div>
                <div className="history-row-header">
                  <span className={`badge-chat-cat cat-${cat}`}>
                    {cat ? getBadgeLabel(cat) : ne ? "कुराकानी" : "Conversation"}
                  </span>
                  <time dateTime={item.updated_at}>
                    {new Date(item.updated_at).toLocaleString()}
                  </time>
                </div>
                <h2>{item.title}</h2>
                <p>
                  {item.messages.length} messages ·{" "}
                  {item.language.toUpperCase()}
                </p>
                <small>{item.messages.at(-1)?.text.slice(0, 160)}</small>
              </div>
              <div className="history-row-actions">
                {resumeErrors[item.id] && (
                  <p role="alert">{resumeErrors[item.id]}</p>
                )}
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  disabled={locked}
                  onClick={() => {
                    setResumeErrors((old) => ({ ...old, [item.id]: "" }));
                    void onOpen(item.id).catch((error) =>
                      setResumeErrors((old) => ({
                        ...old,
                        [item.id]: String(error),
                      })),
                    );
                  }}
                >
                  {ne ? "जारी राख्नुहोस्" : "Continue"}
                </button>
                <button
                  type="button"
                  className="text-button"
                  disabled={locked}
                  onClick={() => confirm(item.id)}
                >
                  Delete
                </button>
              </div>
            </article>
          );
        })}
        {history.localState !== "loading" && !visible.length && (
          <p className="history-empty">
            {query
              ? "No saved chats match this search."
              : "No conversations found in this category. Start a session from the Dashboard."}
          </p>
        )}
      </div>

      {/* Delete / Server Confirmation Dialog */}
      <details className="history-management">
        <summary>
          {ne ? "सुरक्षित कुराकानी व्यवस्थापन" : "Manage saved chats"}
        </summary>
        <p>
          {ne
            ? "निर्यातमा SQLite फाइल आउँछ, जसमा कुराकानी र जाँचिएको पाठ हुन्छ। सुरक्षित राख्नुहोस्।"
            : "Export downloads a SQLite file containing your conversations and reviewed text. Keep it private."}
        </p>{" "}
        <div className="history-toolbar">
          <button
            type="button"
            className="btn-secondary"
            disabled={locked || history.localState !== "ready"}
            onClick={() => void run(download)}
          >
            {ne ? "सुरक्षित कुराकानी निर्यात" : "Export saved chats"}
          </button>
          <button
            type="button"
            className="text-button"
            disabled={locked}
            onClick={() => void run(history.refresh)}
          >
            {ne ? "पुनः लोड" : "Refresh"}
          </button>
        </div>
        <div className="history-storage-grid">
          <section className="history-storage-card">
            <h2>{ne ? "यो ब्राउजरमा सुरक्षित" : "On this browser"}</h2>
            <p role="status">
              {history.localState === "loading"
                ? "Opening SQLite…"
                : history.saving
                  ? "Saving changes…"
                  : history.localState === "ready"
                    ? `${history.conversations.length}/50 conversations saved locally`
                    : "Some changes may be in memory only"}
            </p>
            <p>
              Messages, reviewed context, answers, dates, and their recorded
              sources stay in a local SQLite database. Clearing this site’s
              browser data removes it.
            </p>
            {history.error && (
              <p className="input-error-alert" role="alert">
                {history.error}
              </p>
            )}
            {history.localState === "unavailable" && (
              <button
                type="button"
                disabled={locked}
                onClick={() => void run(history.retryLocal)}
              >
                Retry local save
              </button>
            )}
          </section>

          <section className="history-storage-card">
            <h2>{ne ? "ऐच्छिक सर्भर ब्याकअप" : "Optional server copy"}</h2>
            <p role="status">{history.serverStatus}</p>
            <p>
              {history.server ? "Enabled on " : "When allowed, copy chats to "}
              <span className="history-server-address">
                {history.server?.origin || historyOrigin()}
              </span>
            </p>
            {history.server && (
              <p>
                Access expires{" "}
                {new Date(history.server.expires_at).toLocaleString()}. Copies
                are removed when this 30-day period ends.
              </p>
            )}
            {history.server ? (
              <div className="history-toolbar">
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => void run(history.sync)}
                >
                  {history.server.pending_delete
                    ? "Retry server deletion"
                    : history.syncing
                      ? "Syncing…"
                      : "Sync / restore chats"}
                </button>
                {!history.server.pending_delete && (
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={locked}
                    onClick={() => confirm("disable")}
                  >
                    Stop & delete server copy
                  </button>
                )}
              </div>
            ) : (
              <button
                type="button"
                disabled={locked || history.localState !== "ready"}
                onClick={() => confirm("enable")}
              >
                Enable server copy
              </button>
            )}
          </section>
        </div>
      </details>
      <dialog
        ref={dialog}
        className="history-dialog"
        onCancel={() => setAction("")}
        aria-labelledby="history-confirm-title"
      >
        <h2 id="history-confirm-title">
          {action === "enable"
            ? "Allow server history?"
            : action === "disable"
              ? "Remove the server copy?"
              : "Delete this conversation?"}
        </h2>
        <p>
          {action === "enable"
            ? `Saved message history and new conversations with their reviewed document or medicine context will be sent to ${historyOrigin()} and stored in a separate SQLite file for up to 30 days. Only enable this on a server you trust.`
            : action === "disable"
              ? "Stop future uploads and delete this history vault on the server. Local chats stay on this browser."
              : "Delete this chat locally and from its enabled server copy. This cannot be undone."}
        </p>
        {action === "enable" && (
          <label className="document-check">
            <input
              type="checkbox"
              checked={allowed}
              onChange={(e) => setAllowed(e.target.checked)}
            />
            I allow storage of saved messages and new reviewed conversation
            context on this server for 30 days.
          </label>
        )}
        <div className="history-toolbar">
          <button
            type="button"
            disabled={busy || (action === "enable" && !allowed)}
            onClick={() => {
              const choice = action;
              dialog.current?.close();
              setAction("");
              void run(
                choice === "enable"
                  ? history.enableServer
                  : choice === "disable"
                    ? history.disableServer
                    : () => history.removeChat(choice),
              );
            }}
          >
            {action === "enable" ? "Allow server storage" : "Confirm deletion"}
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              dialog.current?.close();
              setAction("");
            }}
          >
            Cancel
          </button>
        </div>
      </dialog>
    </section>
  );
}
