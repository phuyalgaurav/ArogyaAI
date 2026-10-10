"use client";

import type {
  Conversation,
  ConversationRecognitionRequest,
  ConversationSpeechResult,
  ConversationTranscriptionResult,
  ConversationTurn,
  ConversationTurnRequest,
  RecognitionJob,
} from "@arogya/contracts";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useSession } from "@/context/SessionContext";
import { useHistory } from "@/features/history/HistoryContext";
import { useProfile } from "@/features/profile/ProfileContext";
import { ApiError, createRequestId } from "@/lib/api";
import { type ConversationAccess, conversationRequest } from "./api";

type Mode = Conversation["mode"];
type Language = Conversation["language"];
interface Entry {
  alias: string;
  snapshot: Conversation;
  access: ConversationAccess;
}
interface ContextValue {
  snapshots: Record<string, Conversation>;
  loading: boolean;
  error: string | null;
  ensure: (mode: Mode, language: Language) => Promise<Entry>;
  refresh: () => Promise<Conversation>;
  text: (
    mode: Mode,
    language: Language,
    text: string,
    kind: ConversationRecognitionRequest["kind"],
    consent: string,
  ) => Promise<Conversation>;
  review: (
    mode: Mode,
    language: Language,
    text: string,
    consent: string,
    medicineId?: string,
  ) => Promise<Conversation>;
  recognize: (
    mode: Mode,
    language: Language,
    request: Omit<
      ConversationRecognitionRequest,
      "request_id" | "expected_context_revision"
    >,
  ) => Promise<Conversation>;
  turn: (
    mode: Mode,
    language: Language,
    message: string,
    consent: string,
    model: "qwen" | "bonsai",
    operation?: "question" | "explain",
  ) => Promise<ConversationTurn>;
  transcribe: (
    mode: Mode,
    language: Language,
    audio: { audio_base64: string; language: "ne"; consent_id: string },
  ) => Promise<ConversationTranscriptionResult>;
  speech: (
    mode: Mode,
    language: Language,
    turnId: string,
    consent: string,
    chunk: number,
  ) => Promise<ConversationSpeechResult>;
  cancel: () => Promise<void>;
}
const Context = createContext<ContextValue | null>(null);

export function ConversationProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const history = useHistory();
  const profile = useProfile();
  const latest = useRef({ session, history, profile });
  latest.current = { session, history, profile };
  const entries = useRef(new Map<string, Entry>());
  const pending = useRef<AbortController | null>(null);
  const retry = useRef(new Map<string, string>());
  const [snapshots, setSnapshots] = useState<Record<string, Conversation>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  useEffect(() => {
    let live = true;
    const id = history.currentId;
    if (id)
      void latest.current.history
        .readContext(id)
        .then((snapshot) => {
          if (live && snapshot)
            setSnapshots((old) => ({ ...old, [id]: snapshot }));
        })
        .catch((failure) => {
          if (live) setError(String(failure));
        });
    return () => {
      live = false;
    };
  }, [history.currentId]);

  async function remember(alias: string, entry: Entry) {
    entries.current.set(alias, entry);
    setSnapshots((old) => ({ ...old, [alias]: entry.snapshot }));
    try {
      await latest.current.history.saveContext(alias, entry.snapshot);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Context could not be saved locally.",
      );
    }
    return entry.snapshot;
  }
  async function ensure(mode: Mode, language: Language): Promise<Entry> {
    const { session: current, history: records } = latest.current;
    const alias = records.currentId;
    if (!alias)
      throw new Error("History is still loading. Try again in a moment.");
    const token = await current.initSession();
    if (!token) throw new Error("The server session could not start.");
    const cached = entries.current.get(alias);
    if (
      cached?.snapshot.mode === mode &&
      (cached.snapshot.storage === "session" ||
        (records.server &&
          !records.server.pending_delete &&
          cached.access.historyToken === records.server.access_token)) &&
      cached.access.token === token &&
      Date.parse(cached.snapshot.expires_at) > Date.now()
    )
      return cached;
    const stored = cached?.snapshot || (await records.readContext(alias));
    if (stored && stored.mode !== mode)
      throw new Error("Start a new conversation for this workflow.");
    let access: ConversationAccess = { token };
    let snapshot: Conversation;
    if (
      stored?.storage === "server_history" &&
      records.server &&
      !records.server.pending_delete
    ) {
      if (!records.server || records.server.pending_delete)
        throw new Error(
          "Server history is unavailable. Enable its saved access to resume this conversation.",
        );
      access = { token, historyToken: records.server.access_token };
      snapshot = await conversationRequest<Conversation>(
        access,
        `/${stored.id}`,
      );
    } else if (stored) {
      try {
        snapshot = await conversationRequest<Conversation>(
          access,
          `/${stored.id}`,
        );
      } catch (failure) {
        if (
          !(failure instanceof ApiError) ||
          ![404, 410].includes(failure.status)
        )
          throw failure;
        const grant = await current.grantProcessing("conversation_restore");
        if (!grant)
          throw new Error(
            "Permission to resume reviewed context was not granted.",
          );
        access = { token: grant.token };
        snapshot = await conversationRequest<Conversation>(
          access,
          "/restore",
          "POST",
          { snapshot: stored, consent_id: grant.consent.id },
        );
      }
    } else {
      const server = records.server && !records.server.pending_delete;
      access = {
        token,
        ...(server ? { historyToken: records.server?.access_token } : {}),
      };
      try {
        snapshot = await conversationRequest<Conversation>(access, `/${alias}`);
      } catch (failure) {
        if (!(failure instanceof ApiError) || failure.status !== 404)
          throw failure;
        const userContext = await latest.current.profile.contextFor(alias);
        snapshot = await conversationRequest<Conversation>(access, "", "POST", {
          id: alias,
          mode,
          language,
          title: "New conversation",
          storage: server ? "server_history" : "session",
          allow_context_storage: Boolean(server),
          user_context: userContext,
          include_user_context: Boolean(userContext),
        });
      }
    }
    const entry = { alias, snapshot, access };
    await remember(alias, entry);
    return entry;
  }
  async function refresh() {
    const alias = latest.current.history.currentId;
    const entry = entries.current.get(alias);
    if (!entry) throw new Error("No active conversation.");
    entry.snapshot = await conversationRequest<Conversation>(
      entry.access,
      `/${entry.snapshot.id}`,
    );
    return remember(alias, entry);
  }
  async function operation<T>(
    mode: Mode,
    language: Language,
    work: (entry: Entry, signal: AbortSignal) => Promise<T>,
  ) {
    if (pending.current)
      throw new Error("A conversation request is already running.");
    const controller = new AbortController();
    pending.current = controller;
    setLoading(true);
    setError(null);
    try {
      return await work(await ensure(mode, language), controller.signal);
    } catch (failure) {
      if (failure instanceof ApiError && [404, 410].includes(failure.status)) {
        entries.current.delete(latest.current.history.currentId);
      }
      if (failure instanceof ApiError && failure.status === 409) {
        try {
          await refresh();
        } catch {
          /* Keep the original error and draft if offline. */
        }
      }
      setError(
        failure instanceof Error
          ? failure.message
          : "Conversation request failed.",
      );
      throw failure;
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setLoading(false);
      }
    }
  }
  async function text(
    mode: Mode,
    language: Language,
    value: string,
    kind: ConversationRecognitionRequest["kind"],
    consent: string,
  ) {
    return operation(mode, language, async (entry, signal) => {
      entry.snapshot = await conversationRequest<Conversation>(
        entry.access,
        `/${entry.snapshot.id}/attachments/text`,
        "POST",
        {
          request_id: createRequestId(),
          expected_context_revision: entry.snapshot.context_revision ?? 0,
          text: value,
          kind,
          consent_id: consent,
        },
        signal,
      );
      return remember(entry.alias, entry);
    });
  }
  async function review(
    mode: Mode,
    language: Language,
    value: string,
    consent: string,
    medicineId?: string,
  ) {
    return operation(mode, language, async (entry, signal) => {
      if (!entry.snapshot.active_attachment_id)
        throw new Error("Add a document or medicine label first.");
      entry.snapshot = await conversationRequest<Conversation>(
        entry.access,
        `/${entry.snapshot.id}/attachments/${entry.snapshot.active_attachment_id}/review`,
        "PUT",
        {
          expected_context_revision: entry.snapshot.context_revision ?? 0,
          text: value,
          text_checked: true,
          consent_id: consent,
          medicine_id: medicineId,
        },
        signal,
      );
      return remember(entry.alias, entry);
    });
  }
  async function recognize(
    mode: Mode,
    language: Language,
    request: Omit<
      ConversationRecognitionRequest,
      "request_id" | "expected_context_revision"
    >,
  ) {
    return operation(mode, language, async (entry, signal) => {
      let job = await conversationRequest<RecognitionJob>(
        entry.access,
        `/${entry.snapshot.id}/recognitions`,
        "POST",
        {
          ...request,
          request_id: createRequestId(),
          expected_context_revision: entry.snapshot.context_revision ?? 0,
        },
        signal,
      );
      const deadline = Date.now() + 165000;
      while (job.status === "processing") {
        if (Date.now() >= deadline)
          throw new Error(
            "Image recognition timed out. Cancel and try a clearer image.",
          );
        await new Promise<void>((resolve, reject) => {
          const done = () => {
            signal.removeEventListener("abort", aborted);
            resolve();
          };
          const timer = setTimeout(done, 1800);
          const aborted = () => {
            clearTimeout(timer);
            reject(new Error("Recognition cancelled."));
          };
          if (signal.aborted) aborted();
          else signal.addEventListener("abort", aborted, { once: true });
        });
        job = await conversationRequest<RecognitionJob>(
          entry.access,
          `/${entry.snapshot.id}/recognitions/${job.id}`,
          "GET",
          undefined,
          signal,
        );
      }
      if (job.status !== "completed")
        throw new Error(
          job.error_code ||
            "Recognition failed. Retake the photo or paste the wording.",
        );
      entry.snapshot = await conversationRequest<Conversation>(
        entry.access,
        `/${entry.snapshot.id}`,
        "GET",
        undefined,
        signal,
      );
      return remember(entry.alias, entry);
    });
  }
  async function turn(
    mode: Mode,
    language: Language,
    message: string,
    consent: string,
    model: "qwen" | "bonsai",
    intent: "question" | "explain" = "question",
  ) {
    const alias = latest.current.history.currentId;
    return operation(mode, language, async (entry, signal) => {
      const key = `${alias}:${entry.snapshot.context_revision}:${language}:${model}:${intent}:${message}`;
      const requestId = retry.current.get(key) || createRequestId();
      retry.current.set(key, requestId);
      const payload: ConversationTurnRequest = {
        request_id: requestId,
        message,
        operation: intent,
        expected_context_revision: entry.snapshot.context_revision ?? 0,
        language,
        model_profile: model,
        consent_id: consent,
      };
      const result = await conversationRequest<ConversationTurn>(
        entry.access,
        `/${entry.snapshot.id}/turns`,
        "POST",
        payload,
        signal,
      );
      entry.snapshot = await conversationRequest<Conversation>(
        entry.access,
        `/${entry.snapshot.id}`,
        "GET",
        undefined,
        signal,
      );
      await remember(alias, entry);
      retry.current.delete(key);
      return result;
    });
  }
  async function transcribe(
    mode: Mode,
    language: Language,
    audio: { audio_base64: string; language: "ne"; consent_id: string },
  ) {
    return operation(mode, language, (entry, signal) =>
      conversationRequest<ConversationTranscriptionResult>(
        entry.access,
        `/${entry.snapshot.id}/speech/transcribe`,
        "POST",
        {
          request_id: createRequestId(),
          expected_context_revision: entry.snapshot.context_revision ?? 0,
          audio,
        },
        signal,
      ),
    );
  }
  async function speech(
    mode: Mode,
    language: Language,
    turnId: string,
    consent: string,
    chunk: number,
  ) {
    return operation(mode, language, (entry, signal) =>
      conversationRequest<ConversationSpeechResult>(
        entry.access,
        `/${entry.snapshot.id}/speech/synthesize`,
        "POST",
        {
          turn_id: turnId,
          expected_context_revision: entry.snapshot.context_revision ?? 0,
          chunk_index: chunk,
          consent_id: consent,
        },
        signal,
      ),
    );
  }
  async function cancel() {
    const alias = latest.current.history.currentId;
    const entry = entries.current.get(alias);
    pending.current?.abort();
    if (entry)
      await conversationRequest(
        entry.access,
        `/${entry.snapshot.id}/cancel`,
        "POST",
      );
  }
  return (
    <Context.Provider
      value={{
        snapshots,
        loading,
        error,
        ensure,
        refresh,
        text,
        review,
        recognize,
        turn,
        transcribe,
        speech,
        cancel,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useConversation() {
  const context = useContext(Context);
  if (!context) throw new Error("ConversationProvider is missing.");
  return context;
}
