"use client";

import type {
  Conversation,
  ConversationIndex,
  HistoryConversation,
  HistoryMessage,
} from "@arogya/contracts";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useSession } from "@/context/SessionContext";
import { conversationRequest } from "@/features/conversations/api";
import {
  copyConversation,
  deleteServerConversation,
  enrollHistory,
  historyOrigin,
  readServerHistory,
  revokeServerHistory,
} from "@/features/history/api";
import {
  LocalHistory,
  type LocalHistoryIndex,
  type ServerHistoryAccess,
} from "@/features/history/local-history";
import { ApiError, createRequestId } from "@/lib/api";

interface HistoryContextValue {
  saveContext: (id: string, snapshot: Conversation) => Promise<void>;
  readContext: (id: string) => Promise<Conversation | null>;
  conversations: HistoryConversation[];
  currentId: string;
  selected: HistoryConversation | null;
  localState: "loading" | "ready" | "unavailable";
  error: string | null;
  server: ServerHistoryAccess | null;
  serverStatus: string;
  syncing: boolean;
  saving: boolean;
  sending: boolean;
  beginSending: () => boolean;
  endSending: () => void;
  append: (
    id: string,
    message: HistoryMessage,
    language: HistoryConversation["language"],
  ) => Promise<void>;
  newChat: () => void;
  selectChat: (id: string) => void;
  removeChat: (id: string) => Promise<void>;
  exportSqlite: () => Promise<Uint8Array>;
  enableServer: () => Promise<void>;
  disableServer: () => Promise<void>;
  sync: () => Promise<void>;
  refresh: () => Promise<void>;
  retryLocal: () => Promise<void>;
}
const Context = createContext<HistoryContextValue | null>(null);
const detail = (failure: unknown) =>
  failure instanceof Error ? failure.message : "History storage failed.";

export function HistoryProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const local = useRef<LocalHistory | null>(null);
  const alive = useRef(true);
  const index = useRef<HistoryConversation[]>([]);
  const unsaved = useRef(new Map<string, HistoryConversation>());
  const active = useRef("");
  const access = useRef<ServerHistoryAccess | null>(null);
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const backupQueue = useRef<Promise<unknown>>(Promise.resolve());
  const serverErrors = useRef(false);
  const syncLock = useRef(false);
  const sendLock = useRef(false);
  const requests = useRef(new Set<AbortController>());
  const [conversations, setConversations] = useState<HistoryConversation[]>([]);
  const [currentId, setCurrentId] = useState("");
  const [localState, setLocalState] =
    useState<HistoryContextValue["localState"]>("loading");
  const [error, setError] = useState<string | null>(null);
  const [server, setServer] = useState<ServerHistoryAccess | null>(null);
  const [serverStatus, setServerStatus] = useState("Server history is off.");
  const [syncing, setSyncing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);

  const apply = useCallback((result: LocalHistoryIndex) => {
    for (const id of result.deleted_ids) unsaved.current.delete(id);
    if (result.deleted_ids.includes(active.current)) {
      const id = createRequestId();
      active.current = id;
      setCurrentId(id);
      void local.current
        ?.request("current", id)
        .catch((failure) => setError(detail(failure)));
    }
    const merged = new Map(result.conversations.map((item) => [item.id, item]));
    for (const [id, item] of unsaved.current) merged.set(id, item);
    index.current = [...merged.values()].sort((a, b) =>
      b.updated_at.localeCompare(a.updated_at),
    );
    setConversations(index.current);
    setLocalState(unsaved.current.size ? "unavailable" : "ready");
  }, []);
  const refresh = useCallback(async () => {
    if (!local.current) return;
    try {
      const result = await local.current.request<LocalHistoryIndex>("list");
      const profile = await local.current.request<ServerHistoryAccess | null>(
        "meta",
      );
      if (alive.current) {
        apply(result);
        access.current = profile || null;
        setServer(profile || null);
        if (profile?.pending_delete)
          setServerStatus("Uploads stopped. Server deletion is pending.");
      }
    } catch (failure) {
      if (alive.current) {
        setLocalState("unavailable");
        setError(detail(failure));
      }
    }
  }, [apply]);
  useEffect(() => {
    alive.current = true;
    let mounted = true;
    const db = new LocalHistory();
    local.current = db;
    void (async () => {
      try {
        const result = await db.request<LocalHistoryIndex>("list");
        const profile = await db.request<ServerHistoryAccess | null>("meta");
        if (!mounted) return;
        apply(result);
        const id = result.current_id || createRequestId();
        active.current = id;
        setCurrentId(id);
        await db.request("current", id);
        access.current = profile || null;
        setServer(profile || null);
        if (profile)
          setServerStatus(
            profile.pending_delete
              ? "Uploads stopped. Server deletion is pending."
              : "Server copy enabled. Sync to check or restore saved chats.",
          );
      } catch (failure) {
        if (mounted) {
          setLocalState("unavailable");
          setError(detail(failure));
          const id = createRequestId();
          active.current = id;
          setCurrentId(id);
        }
      }
    })();
    return () => {
      mounted = false;
      alive.current = false;
      for (const request of requests.current) request.abort();
      db.close();
    };
  }, [apply]);
  useEffect(() => {
    const focused = () => void refresh();
    window.addEventListener("focus", focused);
    return () => window.removeEventListener("focus", focused);
  }, [refresh]);

  function current(id: string) {
    active.current = id;
    setCurrentId(id);
    void local.current
      ?.request("current", id)
      .catch((failure) => setError(detail(failure)));
  }
  function newChat() {
    if (!sendLock.current && !syncLock.current) current(createRequestId());
  }
  function selectChat(id: string) {
    if (!sendLock.current && !syncLock.current) current(id);
  }
  function beginSending() {
    if (sendLock.current || syncLock.current || localState === "loading")
      return false;
    sendLock.current = true;
    setSending(true);
    return true;
  }
  function endSending() {
    sendLock.current = false;
    if (alive.current) setSending(false);
  }
  async function permitted(profile: ServerHistoryAccess) {
    const stored = await local.current?.request<ServerHistoryAccess | null>(
      "meta",
    );
    return (
      stored?.access_token === profile.access_token &&
      !stored.pending_delete &&
      access.current?.access_token === profile.access_token &&
      !access.current.pending_delete
    );
  }
  function backupDelta(
    conversation: HistoryConversation,
    message: HistoryMessage,
  ) {
    const profile = access.current;
    if (!profile || profile.pending_delete) return;
    backupQueue.current = backupQueue.current
      .catch(() => {})
      .then(async () => {
        const controller = new AbortController();
        requests.current.add(controller);
        const timer = setTimeout(() => controller.abort(), 12000);
        try {
          if (!(await permitted(profile))) return;
          await copyConversation(
            profile,
            { ...conversation, messages: [message] },
            controller.signal,
          );
          if (alive.current && (await permitted(profile)))
            setServerStatus(
              serverErrors.current
                ? "Server copy incomplete. Use Sync to retry missing messages."
                : "Latest saved message copied to the server.",
            );
        } catch {
          serverErrors.current = true;
          if (
            alive.current &&
            access.current?.access_token === profile.access_token &&
            !access.current.pending_delete
          )
            setServerStatus(
              "Server copy incomplete. Local history remains; use Sync when connected.",
            );
        } finally {
          clearTimeout(timer);
          requests.current.delete(controller);
        }
      });
  }
  async function append(
    id: string,
    message: HistoryMessage,
    language: HistoryConversation["language"],
  ) {
    const operation = async () => {
      const old = index.current.find((item) => item.id === id);
      if (old?.messages.some((item) => item.id === message.id)) return;
      const conversation: HistoryConversation = old
        ? {
            ...old,
            updated_at: message.timestamp,
            messages: [...old.messages, message],
          }
        : {
            id,
            title: message.text.slice(0, 70),
            language,
            created_at: message.timestamp,
            updated_at: message.timestamp,
            messages: [message],
          };
      unsaved.current.set(id, conversation);
      index.current = [
        conversation,
        ...index.current.filter((item) => item.id !== id),
      ];
      if (alive.current) {
        setConversations(index.current);
        setSaving(true);
      }
      try {
        if (!local.current) throw new Error("Local history is unavailable.");
        const result = await local.current.request<LocalHistoryIndex>(
          "put",
          conversation,
        );
        unsaved.current.delete(id);
        if (alive.current) {
          apply(result);
          setError(null);
        }
        backupDelta(conversation, message);
      } catch (failure) {
        if (alive.current) {
          setLocalState("unavailable");
          setError(
            `${detail(failure)} Latest changes are held in memory only. Keep this page open and retry saving.`,
          );
        }
      } finally {
        if (alive.current) setSaving(false);
      }
    };
    const pending = saveQueue.current.catch(() => {}).then(operation);
    saveQueue.current = pending;
    await pending;
  }
  async function readContext(id: string) {
    return (
      (await local.current?.request<Conversation | null>("context", id)) || null
    );
  }
  async function saveContext(id: string, snapshot: Conversation) {
    if (!local.current)
      throw new Error("Local context storage is unavailable.");
    try {
      await local.current.request("put-context", { id, snapshot });
      if (
        !index.current.some((item) => item.id === id) &&
        snapshot.attachments?.length
      ) {
        await append(
          id,
          {
            id: snapshot.id,
            sender: "user",
            text: (
              snapshot.attachments?.[0]?.reviewed_text ||
              snapshot.attachments?.[0]?.original_text ||
              snapshot.turns?.[0]?.message ||
              snapshot.title
            ).slice(0, 500),
            timestamp: snapshot.created_at,
          },
          snapshot.language,
        );
      }
    } catch (failure) {
      setError(`${detail(failure)} Reviewed context is held in memory only.`);
      throw failure;
    }
  }
  async function retryLocal() {
    if (!local.current || sendLock.current || syncLock.current) return;
    setSaving(true);
    try {
      for (const [id, conversation] of unsaved.current) {
        await local.current.request("put", conversation);
        unsaved.current.delete(id);
      }
      await refresh();
      setError(null);
    } catch (failure) {
      setError(detail(failure));
    } finally {
      setSaving(false);
    }
  }
  async function disableServer() {
    if (!access.current || !local.current) return;
    for (const controller of requests.current) controller.abort();
    const profile = { ...access.current, pending_delete: true };
    access.current = profile;
    setServer(profile);
    await local.current.request("set-meta", profile);
    setServerStatus("Uploads stopped. Removing the server copy…");
    try {
      await revokeServerHistory(profile);
      await local.current.request("clear-meta", profile.access_token);
      access.current = null;
      setServer(null);
      setServerStatus("Server copy deleted. Local history remains.");
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) {
        await local.current.request("clear-meta", profile.access_token);
        access.current = null;
        setServer(null);
        setServerStatus("Server access expired or was removed.");
      } else
        setServerStatus(
          "Uploads stopped. Server deletion is pending; retry when connected.",
        );
    }
  }
  async function deleteContextOnServer(
    id: string,
    profile?: ServerHistoryAccess,
  ) {
    let token = session.token;
    if (!token || session.isExpired) token = await session.initSession();
    if (!token)
      throw new Error("Could not connect to remove the saved context.");
    try {
      await conversationRequest(
        { token, ...(profile ? { historyToken: profile.access_token } : {}) },
        `/${id}`,
        "DELETE",
      );
    } catch (failure) {
      if (!(failure instanceof ApiError) || failure.status !== 404)
        throw failure;
    }
  }
  async function sync() {
    const profile = access.current;
    if (!profile || !local.current || syncLock.current || sendLock.current)
      return;
    if (profile.pending_delete) {
      await disableServer();
      return;
    }
    syncLock.current = true;
    setSyncing(true);
    const controller = new AbortController();
    requests.current.add(controller);
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
      await backupQueue.current;
      if (!(await permitted(profile))) return;
      const before = await local.current.request<LocalHistoryIndex>("list");
      for (const id of before.pending_deleted_ids.slice(0, 50)) {
        await deleteServerConversation(profile, id, controller.signal);
        await deleteContextOnServer(id, profile);
        await local.current.request("ack-delete", id);
      }
      const remote = await readServerHistory(profile, controller.signal);
      let latest = await local.current.request<LocalHistoryIndex>(
        "merge",
        remote,
      );
      let sessionToken = session.token;
      if (!sessionToken || session.isExpired)
        sessionToken = await session.initSession();
      if (!sessionToken)
        throw new Error("Could not connect to restore reviewed context.");
      const contextAccess = {
        token: sessionToken,
        historyToken: profile.access_token,
      };
      const contextIndex = await conversationRequest<ConversationIndex>(
        contextAccess,
        "?limit=50",
        "GET",
        undefined,
        controller.signal,
      );
      for (const summary of contextIndex.conversations) {
        if (
          latest.deleted_ids.includes(summary.id) ||
          !(await permitted(profile))
        )
          continue;
        const snapshot = await conversationRequest<Conversation>(
          contextAccess,
          `/${summary.id}`,
          "GET",
          undefined,
          controller.signal,
        );
        await local.current.request("put-context", {
          id: summary.id,
          snapshot,
        });
        if (!latest.conversations.some((item) => item.id === summary.id)) {
          const turns = snapshot.turns || [];
          const messages: HistoryMessage[] = turns.flatMap((turn) => [
            {
              id: createRequestId(),
              sender: "user" as const,
              text: turn.message,
              timestamp: turn.timestamp,
            },
            {
              id: turn.id,
              sender: "assistant" as const,
              text: turn.answer,
              timestamp: turn.timestamp,
              ...(turn.health ? { response: turn.health } : {}),
            },
          ]);
          if (!messages.length)
            messages.push({
              id: createRequestId(),
              sender: "user",
              text: `[${snapshot.mode}] ${snapshot.title}`,
              timestamp: snapshot.created_at,
            });
          await local.current.request("put", {
            id: snapshot.id,
            title: snapshot.title,
            language: snapshot.language,
            created_at: snapshot.created_at,
            updated_at: snapshot.updated_at,
            messages,
          });
        }
      }
      latest = await local.current.request<LocalHistoryIndex>("list");
      if (alive.current) apply(latest);
      for (const conversation of latest.conversations) {
        if (!(await permitted(profile))) return;
        await copyConversation(profile, conversation, controller.signal);
      }
      if (alive.current && (await permitted(profile))) {
        serverErrors.current = false;
        setServerStatus(
          latest.pending_deleted_ids.length
            ? "Saved chats copied. More deletions are pending; Sync again in a minute."
            : `Server copy up to date · ${new Date().toLocaleTimeString()}`,
        );
      }
    } catch (failure) {
      serverErrors.current = true;
      if (
        alive.current &&
        access.current?.access_token === profile.access_token &&
        !access.current.pending_delete
      ) {
        if (failure instanceof ApiError && failure.status === 401) {
          await local.current.request("clear-meta", profile.access_token);
          access.current = null;
          setServer(null);
          setServerStatus(
            "Server access expired or was removed. Uploads are off; local history remains.",
          );
        } else
          setServerStatus(
            "Server copy incomplete. Local history remains; retry Sync when connected.",
          );
      }
    } finally {
      clearTimeout(timer);
      requests.current.delete(controller);
      syncLock.current = false;
      if (alive.current) setSyncing(false);
    }
  }
  async function removeChat(id: string) {
    if (sendLock.current || syncLock.current || !local.current) return;
    const context = await readContext(id);
    const result = await local.current.request<LocalHistoryIndex>("delete", id);
    unsaved.current.delete(id);
    apply(result);
    if (active.current === id) current(createRequestId());
    if (context?.storage === "session" && session.token && !session.isExpired) {
      try {
        await deleteContextOnServer(context.id);
      } catch {
        setError(
          "Deleted locally. The temporary server context will expire with its session; it could not be removed while offline.",
        );
      }
    }
    const profile = access.current;
    if (!profile || profile.pending_delete) return;
    try {
      await backupQueue.current;
      if (!(await permitted(profile))) return;
      await deleteServerConversation(profile, id);
      await deleteContextOnServer(id, profile);
      await local.current.request("ack-delete", id);
      setServerStatus(
        "Conversation removed from this browser and its server copy.",
      );
    } catch {
      setServerStatus(
        "Deleted locally. Server deletion is pending; use Sync when connected.",
      );
    }
  }
  async function exportSqlite() {
    if (!local.current || unsaved.current.size)
      throw new Error("Save pending local changes before exporting SQLite.");
    return (await local.current.request<{ bytes: Uint8Array }>("export")).bytes;
  }
  async function enableServer() {
    if (!local.current || localState !== "ready")
      throw new Error("Save local history before enabling a server copy.");
    const previous = await local.current.request<ServerHistoryAccess | null>(
      "meta",
    );
    if (previous?.pending_delete)
      throw new Error("Finish removing the previous server copy first.");
    if (previous) {
      access.current = previous;
      setServer(previous);
      await sync();
      return;
    }
    const token =
      session.token && !session.isExpired
        ? session.token
        : await session.initSession();
    if (!token) throw new Error("A session could not be created.");
    const historyKey = await local.current.request<string>("provision-key");
    const granted = await enrollHistory(token, historyKey);
    const profile = {
      origin: historyOrigin(),
      access_token: granted.access_token,
      expires_at: granted.expires_at,
    };
    try {
      await local.current.request("set-meta", profile);
    } catch (failure) {
      await revokeServerHistory(profile);
      throw failure;
    }
    access.current = profile;
    setServer(profile);
    await sync();
  }
  return (
    <Context.Provider
      value={{
        saveContext,
        readContext,
        conversations,
        currentId,
        selected: conversations.find((item) => item.id === currentId) || null,
        localState,
        error,
        server,
        serverStatus,
        syncing,
        saving,
        sending,
        beginSending,
        endSending,
        append,
        newChat,
        selectChat,
        removeChat,
        exportSqlite,
        enableServer,
        disableServer,
        sync,
        refresh,
        retryLocal,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useHistory() {
  const value = useContext(Context);
  if (!value) throw new Error("HistoryProvider is missing.");
  return value;
}
