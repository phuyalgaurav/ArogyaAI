"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { WorkspaceDialog } from "@/components/ui/WorkspaceDialog";
import { useHistory } from "@/features/history/HistoryContext";
import { LocalHistory } from "@/features/history/local-history";
import { contextPreview, type UserProfile } from "./context";

interface Value {
  profile: UserProfile | null;
  error: string | null;
  update: (change: {
    notes?: string;
    clear?: boolean;
    choice?: { id: string; context: string };
  }) => Promise<void>;
  contextFor: (id: string) => Promise<string>;
}
const Context = createContext<Value | null>(null);

export function ProfileProvider({ children }: { children: ReactNode }) {
  const db = useRef<LocalHistory | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const local = new LocalHistory();
    db.current = local;
    let alive = true;
    local
      .request<UserProfile>("profile")
      .then((value) => {
        if (alive) setProfile(value);
      })
      .catch((failure) => {
        if (alive) setError(String(failure));
      });
    return () => {
      alive = false;
      local.close();
    };
  }, []);
  const update = useCallback(async (change: Parameters<Value["update"]>[0]) => {
    if (!db.current) throw new Error("Profile storage is not ready.");
    const value = await db.current.request<UserProfile>("put-profile", change);
    setProfile(value);
    setError(null);
  }, []);
  async function contextFor(id: string) {
    const value = await db.current?.request<UserProfile>("profile");
    if (!value || !Object.hasOwn(value.choices, id))
      throw new Error(
        "Choose whether to include saved context before starting this chat.",
      );
    return value.choices[id];
  }
  return (
    <Context.Provider value={{ profile, error, update, contextFor }}>
      {children}
    </Context.Provider>
  );
}

export function useProfile() {
  const value = useContext(Context);
  if (!value) throw new Error("ProfileProvider is required.");
  return value;
}

export function ProfileControl({
  active,
  locale,
}: {
  active: boolean;
  locale: string;
}) {
  const { profile, error, update } = useProfile();
  const history = useHistory();
  const current = useRef(history);
  current.current = history;
  const ne = locale === "ne";
  const [asking, setAsking] = useState(false);
  const [editing, setEditing] = useState(false);
  const [preview, setPreview] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setAsking(false);
    if (
      !active ||
      !history.currentId ||
      !profile ||
      history.localState === "loading"
    )
      return;
    if (Object.hasOwn(profile.choices, history.currentId)) return;
    void (async () => {
      const existing = await current.current.readContext(history.currentId);
      if (!alive) return;
      if (existing) {
        await update({
          choice: {
            id: history.currentId,
            context: existing.user_context || "",
          },
        });
        return;
      }
      const chats = current.current.conversations.filter(
        (chat) => chat.id !== history.currentId,
      );
      const archives = await Promise.all(
        chats.map(async (chat) => {
          const saved = await current.current.readContext(chat.id);
          if (!saved || saved.mode === "health")
            return chat.messages.filter((message) => message.sender === "user");
          return [
            ...(saved.turns || []).map((turn) => ({
              text: turn.message,
              timestamp: turn.timestamp,
            })),
            ...(saved.attachments || [])
              .filter((item) => item.reviewed_text)
              .map((item) => ({
                text: `User-reviewed document text: ${item.reviewed_text}`,
                timestamp: item.created_at,
              })),
          ];
        }),
      );
      if (!alive) return;
      const messages = archives
        .flat()
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      setPreview(contextPreview(profile.notes, messages));
      setAsking(true);
    })().catch((reason) => {
      if (alive) setFailure(String(reason));
    });
    return () => {
      alive = false;
    };
  }, [active, history.currentId, history.localState, profile, update]);
  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setFailure(null);
    try {
      await action();
    } catch (reason) {
      setFailure(String(reason));
    } finally {
      setBusy(false);
    }
  }
  const chosen = profile?.choices[history.currentId];
  return (
    <section
      className="profile-control"
      aria-label={ne ? "सुरक्षित व्यक्तिगत सन्दर्भ" : "Saved user context"}
    >
      <div className="profile-control-row">
        <span>
          {active
            ? chosen === undefined
              ? ne
                ? "कुराकानीको सन्दर्भ छान्नुहोस्"
                : "Choose context for this chat"
              : chosen
                ? ne
                  ? "यो कुराकानीमा सुरक्षित सन्दर्भ समावेश छ"
                  : "Saved context included in this chat"
                : ne
                  ? "यो कुराकानीमा विगतको सन्दर्भ छैन"
                  : "This chat uses no saved context"
            : ne
              ? "व्यक्तिगत सन्दर्भ यो उपकरणमा सुरक्षित हुन्छ"
              : "User context is saved on this device"}
        </span>
        <button
          type="button"
          className="text-button"
          onClick={() => {
            setNotes(profile?.notes || "");
            setEditing(true);
          }}
        >
          {ne ? "व्यक्तिगत विवरण" : "Your saved details"}
        </button>
      </div>
      {(failure || error) && (
        <p role="alert" className="notice">
          {failure || error}
        </p>
      )}
      {asking && !editing && (
        <WorkspaceDialog
          title={
            ne
              ? "यस कुराकानीमा विगतको सन्दर्भ समावेश गर्ने?"
              : "Include your saved context in this chat?"
          }
          onClose={() => {
            if (!busy)
              void perform(async () => {
                await update({
                  choice: { id: history.currentId, context: "" },
                });
                setAsking(false);
              });
          }}
        >
          <p>
            {ne
              ? "समावेश गरेमा तलको पाठ सर्भरमा पठाइन्छ। तपाईंको छनोट यो कुराकानीका लागि मात्र हो।"
              : "If you include it, the text below will be sent to the server for this chat. Your choice applies only to this conversation. Enabled server history also saves this copy."}
          </p>
          <label className="profile-label">
            {ne
              ? "समावेश हुने सन्दर्भ जाँच्नुहोस् र सम्पादन गर्नुहोस्"
              : "Review and edit exactly what will be included"}
            <textarea
              rows={10}
              maxLength={4000}
              value={preview}
              disabled={busy}
              onChange={(event) => setPreview(event.target.value)}
              placeholder={
                ne
                  ? "अहिले कुनै विवरण छैन। चाहेको विवरण यहाँ लेख्नुहोस्।"
                  : "No saved details yet. Add anything you want this chat to know."
              }
            />
          </label>
          <p>
            {ne
              ? "विगतका प्रश्नहरू प्रमाणित चिकित्सा तथ्य होइनन्। नयाँ कुराकानीमा फेरि सोधिन्छ।"
              : "Past questions are your previous words, not verified medical facts. You will be asked again for each new chat. All saved history remains available in Past chat records."}
          </p>
          {failure && <p role="alert">{failure}</p>}
          <div className="profile-actions">
            <button
              type="button"
              className="btn btn-outline"
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  await update({
                    choice: { id: history.currentId, context: "" },
                  });
                  setAsking(false);
                })
              }
            >
              {ne ? "सन्दर्भ बिना सुरु गर्ने" : "Start without context"}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !preview.trim()}
              onClick={() =>
                void perform(async () => {
                  await update({
                    choice: { id: history.currentId, context: preview.trim() },
                  });
                  setAsking(false);
                })
              }
            >
              {ne ? "यो सन्दर्भ समावेश गर्ने" : "Include this context"}
            </button>
          </div>
        </WorkspaceDialog>
      )}
      {editing && (
        <WorkspaceDialog
          title={ne ? "तपाईंका सुरक्षित विवरण" : "Your saved details"}
          onClose={() => {
            if (!busy) setEditing(false);
          }}
        >
          <p>
            {ne
              ? "आफ्नो नाम, भाषा, एलर्जी वा सम्झनुपर्ने विवरण लेख्नुहोस्। अनुमान गरिएका तथ्य सुरक्षित गरिँदैनन्।"
              : "Save details you want to reuse, such as your name, language, allergies or questions to discuss. Chat messages and document text are already stored in Past chat records. These notes are stored on this device; each new chat asks before using them."}
          </p>
          <label className="profile-label">
            {ne ? "व्यक्तिगत विवरण" : "Profile notes"}
            <textarea
              rows={8}
              maxLength={2000}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </label>
          {failure && <p role="alert">{failure}</p>}
          <div className="profile-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  await update({ notes });
                  setEditing(false);
                })
              }
            >
              {ne ? "सुरक्षित गर्ने" : "Save details"}
            </button>
            <button
              type="button"
              className="btn btn-outline"
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  await update({ clear: true });
                  setNotes("");
                  setEditing(false);
                })
              }
            >
              {ne ? "व्यक्तिगत विवरण मेटाउने" : "Clear profile notes and choices"}
            </button>
          </div>
          <p>
            {ne
              ? "विगतका कुराकानी मेटाउन विगतका रेकर्ड खोल्नुहोस्।"
              : "To delete previous messages and document text, delete the relevant chat in Past chat records. Clearing notes does not remove context already included in existing chats."}
          </p>
        </WorkspaceDialog>
      )}
    </section>
  );
}
