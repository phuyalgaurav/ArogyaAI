"use client";

import type { RuntimeStatus } from "@arogya/contracts";
import { useEffect, useRef, useState } from "react";
import type { WorkspaceTab } from "@/components/layout/navigation";
import { WorkspaceIcon } from "@/components/layout/WorkspaceIcon";
import { useHistory } from "@/features/history/HistoryContext";

interface TaskHomeProps {
  locale: "en" | "ne" | "tam";
  onOpen: (tab: WorkspaceTab) => void;
  runtime: RuntimeStatus | null;
  onContinueChat?: (id: string) => void;
}

export function TaskHome({
  locale,
  onOpen,
  runtime,
  onContinueChat,
}: TaskHomeProps) {
  const ne = locale === "ne";
  const history = useHistory();
  const recentChats = history.conversations.slice(0, 4);

  const t = {
    transcriptionTitle: ne
      ? "प्रेस्क्रिप्सन र रिपोर्ट उतार"
      : "Prescription / Report transcription",
    transcriptionBody: ne
      ? "फोटो खिच्नुहोस् वा पाठ राख्नुहोस्। उतारेको पाठ जाँच्नुहोस्, सरल व्याख्या पढ्नुहोस् र थप प्रश्न सोध्नुहोस्।"
      : "Read a photo or paste text, check the wording, and discuss it.",
    transcriptionAction: ne ? "कागजात सुरु गर्नुहोस्" : "Start transcription",
    medicineTitle: ne ? "औषधि जानकारी" : "Medicine info",
    medicineBody: ne
      ? "प्याकेजिङको तस्बिर लिनुहोस् वा नाम खोज्नुहोस्। पहिचान समीक्षा गर्नुहोस् र सोधपुछ जारी राख्नुहोस्।"
      : "Photograph or search a medicine, review its candidate identity, and continue asking questions.",
    medicineAction: ne ? "औषधि खोजी वा तस्बिर" : "Identify medicine",
    chatTitle: ne ? "स्वास्थ्य जिज्ञासा" : "Quick health question",
    chatBody: ne
      ? "नेपालीमा बोल्नुहोस् वा टाइप गर्नुहोस्। जवाफका लागि समीक्षित सामग्री चाहिन्छ।"
      : "Ask by typing or Nepali voice, explore health sources and continue with follow-up questions.",
    chatAction: ne ? "प्रश्न सोध्नुहोस्" : "Ask a question",
    recentHeading: ne ? "हालैका कुराकानीहरू" : "Recent conversations",
    viewAllHistory: ne ? "सबै विगतका कुराकानीहरू हेर्नुहोस्" : "View all past records",
    noHistory: ne
      ? "कुनै कुराकानी सुरक्षित छैन। नयाँ कुराकानी सुरु गर्न माथिका विकल्पहरू रोज्नुहोस्।"
      : "No saved conversations yet. Choose an action above to start a session.",
    continueAction: ne ? "जारी राख्नुहोस्" : "Continue",
    messagesLabel: ne ? "सन्देश" : "messages",
    offlineNotice: ne
      ? "सर्भर सेवा उपलब्ध छैन। केही सुविधाहरू ढिला हुन सक्छन्।"
      : "Server service is currently offline or busy. Some actions may be limited.",
  };

  const [modes, setModes] = useState<Record<string, string>>({});
  const current = useRef(history);
  current.current = history;
  useEffect(() => {
    let live = true;
    void Promise.all(
      history.conversations.map(async (item) => [
        item.id,
        (await current.current.readContext(item.id))?.mode || "",
      ]),
    )
      .then((entries) => {
        if (live) setModes(Object.fromEntries(entries));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [history.conversations]);
  function chatBadge(id: string) {
    return modes[id] === "document"
      ? ne
        ? "कागजात"
        : "Document"
      : modes[id] === "medicine"
        ? ne
          ? "औषधि"
          : "Medicine"
        : modes[id] === "health"
          ? ne
            ? "स्वास्थ्य"
            : "Health"
          : ne
            ? "कुराकानी"
            : "Conversation";
  }

  return (
    <section className="dashboard-container" aria-labelledby="workspace-title">
      {runtime &&
        runtime.engines.length > 0 &&
        !runtime.engines.some((e) => e.state === "ready") && (
          <div className="notice notice-service-issue" role="alert">
            <p>{t.offlineNotice}</p>
          </div>
        )}

      <section className="dashboard-actions-grid" aria-label="Core actions">
        <button
          type="button"
          className="dashboard-task"
          aria-label={t.transcriptionAction}
          onClick={() => onOpen("transcription")}
        >
          <WorkspaceIcon name="image" size={23} />
          <span>
            <strong>{t.transcriptionTitle}</strong>
            <small>
              {ne
                ? "फोटो वा पाठबाट सुरु गर्नुहोस्"
                : "Start with a photo or document text"}
            </small>
          </span>
          <WorkspaceIcon name="arrow" size={18} />
        </button>
        <button
          type="button"
          className="dashboard-task"
          aria-label={t.medicineAction}
          onClick={() => onOpen("medicines")}
        >
          <WorkspaceIcon name="medicine" size={23} />
          <span>
            <strong>{t.medicineTitle}</strong>
            <small>
              {ne
                ? "लेबलको फोटो वा औषधिको नाम"
                : "Use a label photo or medicine name"}
            </small>
          </span>
          <WorkspaceIcon name="arrow" size={18} />
        </button>
        <button
          type="button"
          className="dashboard-task"
          aria-label={t.chatAction}
          onClick={() => onOpen("chat")}
        >
          <WorkspaceIcon name="ask" size={23} />
          <span>
            <strong>{t.chatTitle}</strong>
            <small>
              {ne
                ? "लेख्नुहोस् वा नेपालीमा बोल्नुहोस्"
                : "Type a question or speak in Nepali"}
            </small>
          </span>
          <WorkspaceIcon name="arrow" size={18} />
        </button>
      </section>
      {runtime?.reviewed_questions === 0 && (
        <p className="dashboard-source-note">
          {ne
            ? "सामान्य जानकारी WHO/NHS स्रोतमा आधारित छ। उपचार र औषधिको पहिचान स्वास्थ्यकर्मीले जाँच्नुपर्छ।"
            : "General information uses WHO/NHS sources. Ask a clinician about treatment or medicine identity."}
        </p>
      )}

      {/* Recent Conversations Section */}
      <section
        className="dashboard-recents-section"
        aria-labelledby="recents-heading"
      >
        <div className="recents-header">
          <h2 id="recents-heading">{t.recentHeading}</h2>
          {history.conversations.length > 0 && (
            <button
              type="button"
              className="btn-link"
              onClick={() => onOpen("history")}
            >
              {t.viewAllHistory} ({history.conversations.length}) →
            </button>
          )}
        </div>

        {recentChats.length === 0 ? (
          <div className="recents-empty-state">
            <p>{t.noHistory}</p>
          </div>
        ) : (
          <div className="recents-list">
            {recentChats.map((conv) => (
              <article key={conv.id} className="recent-chat-card">
                <div className="recent-chat-info">
                  <div className="recent-badge-row">
                    <span className="recent-badge">{chatBadge(conv.id)}</span>
                    <time dateTime={conv.updated_at}>
                      {new Date(conv.updated_at).toLocaleDateString(
                        ne ? "ne-NP" : "en-US",
                        {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        },
                      )}
                    </time>
                  </div>
                  <h3 className="recent-chat-title">{conv.title}</h3>
                  <small className="recent-chat-meta">
                    {conv.messages.length} {t.messagesLabel}
                  </small>
                </div>
                <button
                  type="button"
                  className="btn btn-sm btn-outline"
                  onClick={() => {
                    if (onContinueChat) {
                      onContinueChat(conv.id);
                    } else {
                      onOpen("chat");
                    }
                  }}
                >
                  {t.continueAction}
                </button>
              </article>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}
