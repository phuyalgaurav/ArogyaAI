"use client";

import { useEffect, useRef, useState } from "react";
import { workspaceCopy } from "@/components/layout/copy";
import { TaskHome, type WorkspaceTab } from "@/components/layout/TaskHome";
import { WorkspaceSidebar } from "@/components/layout/WorkspaceSidebar";
import { WorkspaceDialog } from "@/components/ui/WorkspaceDialog";
import { SessionProvider } from "@/context/SessionContext";
import { ChatView } from "@/features/chat/ChatView";
import {
  ConversationProvider,
  useConversation,
} from "@/features/conversations/ConversationContext";
import { TranscriptionView } from "@/features/documents/TranscriptionView";
import { HistoryProvider, useHistory } from "@/features/history/HistoryContext";
import { HistoryView } from "@/features/history/HistoryView";
import { KnowledgeView } from "@/features/knowledge/KnowledgeView";
import { MedicineView } from "@/features/medicines/MedicineView";
import type { ProcessingLocation } from "@/features/settings/device-specs";
import { EnginesView } from "@/features/settings/EnginesView";
import { ModelProvider } from "@/features/settings/ModelContext";
import { PrivacyView } from "@/features/settings/PrivacyView";
import { useRuntime } from "@/features/settings/use-runtime";
import { copy } from "@/lib/copy";

type Locale = "en" | "ne" | "tam";

// Exactly the five primary destinations required by Frontend Directive Section 2
const tabs: WorkspaceTab[] = [
  "dashboard",
  "transcription",
  "medicines",
  "history",
  "chat",
];

function resolveDestination(hash: string): WorkspaceTab {
  const clean = hash.replace(/^#/, "");
  if (clean === "dashboard" || clean === "home" || !clean) return "dashboard";
  if (
    clean === "transcription" ||
    clean === "images" ||
    clean === "prescriptions" ||
    clean === "documents"
  ) {
    return "transcription";
  }
  if (clean === "medicines") return "medicines";
  if (clean === "history") return "history";
  if (clean === "chat") return "chat";
  return "dashboard";
}

function MainContent() {
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const [locale, setLocale] = useState<Locale>("en");
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("dashboard");
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [initialQuery, setInitialQuery] = useState<string | null>(null);
  const [medicineQuery, setMedicineQuery] = useState<string | null>(null);
  const [documentDraft, setDocumentDraft] = useState<string | null>(null);

  // Contextual dialog states
  const [privacyModalOpen, setPrivacyModalOpen] = useState(false);
  const [enginesModalOpen, setEnginesModalOpen] = useState(false);
  const [sourceModalOpen, setSourceModalOpen] = useState(false);

  const runtime = useRuntime();
  const history = useHistory();
  const conversation = useConversation();
  const workflowIds = useRef<Partial<Record<WorkspaceTab, string>>>({});
  const [processingLocation, setProcessingLocation] =
    useState<ProcessingLocation>("server");

  const ne = locale === "ne";
  const text = copy[ne ? "ne" : "en"];
  const t = workspaceCopy[ne ? "ne" : "en"];

  const labels: Record<WorkspaceTab, string> = {
    dashboard: ne ? "ड्यासबोर्ड" : "Dashboard",
    transcription: ne
      ? "प्रेस्क्रिप्सन र रिपोर्ट उतार"
      : "Prescription / Report transcription",
    medicines: ne ? "औषधि जानकारी" : "Medicine info",
    history: ne ? "विगतका कुराकानीहरू" : "Past chat records",
    chat: ne ? "स्वास्थ्य जिज्ञासा" : "Quick health question",
  };

  const icons: Record<
    WorkspaceTab,
    "home" | "image" | "medicine" | "library" | "ask"
  > = {
    dashboard: "home",
    transcription: "image",
    medicines: "medicine",
    history: "library",
    chat: "ask",
  };

  useEffect(() => {
    document.documentElement.lang = ne ? "ne" : "en";
  }, [ne]);

  // Sync hash routing supporting legacy URLs
  useEffect(() => {
    function syncLocation() {
      const hash = window.location.hash;
      const clean = hash.replace(/^#/, "");

      // Handle legacy contextual links
      if (clean === "privacy") {
        setPrivacyModalOpen(true);
        return;
      }
      if (clean === "engines") {
        setEnginesModalOpen(true);
        return;
      }
      if (clean === "knowledge") {
        setSourceModalOpen(true);
        return;
      }

      if (clean === "main") return;
      setPrivacyModalOpen(false);
      setEnginesModalOpen(false);
      setSourceModalOpen(false);
      const dest = resolveDestination(hash);
      setActiveTab(dest);
    }

    syncLocation();
    window.addEventListener("hashchange", syncLocation);
    return () => window.removeEventListener("hashchange", syncLocation);
  }, []);

  function open(target: WorkspaceTab, query?: string) {
    if (conversation.loading || history.sending) {
      setNavigationError(
        ne
          ? "प्रक्रिया चल्दै छ। रोक्नुहोस् वा पर्खनुहोस्।"
          : "Processing is in progress. Cancel it or wait before switching conversations.",
      );
      return;
    }
    setNavigationError(null);
    if (["transcription", "medicines", "chat"].includes(activeTab))
      workflowIds.current[activeTab] = history.currentId;
    if (
      target !== activeTab &&
      ["transcription", "medicines", "chat"].includes(target)
    ) {
      const previous = workflowIds.current[target];
      if (previous) history.selectChat(previous);
      else history.newChat();
    }
    if (target === "medicines" && query !== undefined) {
      setMedicineQuery(query);
    } else if (target === "transcription" && query !== undefined) {
      setDocumentDraft(query);
    }
    setActiveTab(target);
    window.location.hash = target;
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  async function resume(id: string) {
    if (conversation.loading || history.sending) {
      setNavigationError(
        ne
          ? "प्रक्रिया चल्दै छ। रोक्नुहोस् वा पर्खनुहोस्।"
          : "Processing is in progress. Cancel it or wait before switching conversations.",
      );
      return;
    }
    setNavigationError(null);
    try {
      const saved = await history.readContext(id);
      const target =
        saved?.mode === "document"
          ? "transcription"
          : saved?.mode === "medicine"
            ? "medicines"
            : "chat";
      workflowIds.current[target] = id;
      history.selectChat(id);
      setInitialQuery(null);
      setActiveTab(target);
      window.location.hash = target;
    } catch (failure) {
      const message =
        failure instanceof Error
          ? failure.message
          : "Could not open this conversation. Try Continue again.";
      setNavigationError(message);
      throw new Error(message);
    }
  }

  useEffect(() => {
    const expected =
      activeTab === "transcription"
        ? "document"
        : activeTab === "medicines"
          ? "medicine"
          : activeTab === "chat"
            ? "health"
            : null;
    const saved = conversation.snapshots[history.currentId];
    if (
      expected &&
      saved &&
      saved.mode !== expected &&
      !conversation.loading &&
      !history.sending
    )
      history.newChat();
  }, [
    activeTab,
    conversation.snapshots,
    conversation.loading,
    history.currentId,
    history.sending,
    history.newChat,
  ]);

  function handleSelectSource(sourceId: string) {
    setSelectedSourceId(sourceId);
    setSourceModalOpen(true);
  }

  return (
    <div className="shell workspace-shell">
      <button
        type="button"
        className="skip-link"
        onClick={() => {
          const main = document.getElementById("main");
          main?.focus();
          main?.scrollIntoView();
        }}
      >
        {text.skipToContent}
      </button>
      <WorkspaceSidebar
        busy={false}
        items={tabs.map((id) => ({ id, label: labels[id], icon: icons[id] }))}
        active={activeTab}
        locale={locale}
        preview={t.preview}
        languageLabel={text.languageSelect}
        onLocale={setLocale}
        onNavigate={open}
        onOpenPrivacy={() => setPrivacyModalOpen(true)}
        onOpenEngines={() => setEnginesModalOpen(true)}
      />

      <main id="main" tabIndex={-1} className="workspace-main">
        {navigationError && (
          <div className="notice notice-warning" role="alert">
            {navigationError}
            <button
              type="button"
              onClick={() => {
                void conversation.cancel();
                setNavigationError(null);
              }}
            >
              {ne ? "रोक्नुहोस्" : "Cancel processing"}
            </button>
          </div>
        )}
        {locale === "tam" && (
          <p className="locale-note" role="status">
            {text.tamangNotice}
          </p>
        )}

        {/* Destination 1: Dashboard */}
        {activeTab === "dashboard" && (
          <TaskHome
            locale={locale}
            onOpen={open}
            runtime={runtime.data}
            onContinueChat={(id) => {
              void resume(id).catch(() => {});
            }}
          />
        )}

        {/* Destination 2: Prescription / Report transcription */}
        {activeTab === "transcription" && (
          <TranscriptionView
            key={history.currentId}
            processingLocation={processingLocation}
            locale={locale}
            runtime={runtime.data}
            initialText={documentDraft}
            onSelectSource={handleSelectSource}
          />
        )}

        {/* Destination 3: Medicine info */}
        {activeTab === "medicines" && (
          <MedicineView
            key={history.currentId}
            processingLocation={processingLocation}
            locale={locale}
            initialQuery={medicineQuery}
            onSelectSource={handleSelectSource}
          />
        )}

        {/* Destination 4: Past chat records */}
        {activeTab === "history" && (
          <HistoryView
            locale={locale}
            onOpen={(id) => {
              return resume(id);
            }}
            onNew={() => {
              delete workflowIds.current.chat;
              history.newChat();
              setInitialQuery(null);
              setActiveTab("chat");
              window.location.hash = "chat";
            }}
          />
        )}

        {/* Destination 5: Quick health question */}
        {activeTab === "chat" && (
          <ChatView
            key={history.currentId}
            locale={locale}
            onSelectSource={handleSelectSource}
            initialQuery={initialQuery}
            onNepaliVoice={() => setLocale("ne")}
            onOpenHistory={() => open("history")}
          />
        )}

        {/* Contextual Dialog: Privacy and Data Controls */}
        {privacyModalOpen && (
          <WorkspaceDialog
            title={ne ? "गोपनीयता तथा डेटा नियन्त्रण" : "Privacy & Data Controls"}
            onClose={() => setPrivacyModalOpen(false)}
          >
            <PrivacyView locale={locale} />
          </WorkspaceDialog>
        )}

        {/* Contextual Dialog: Tools and Model Diagnostics */}
        {enginesModalOpen && (
          <WorkspaceDialog
            title={ne ? "औजार तथा मोडेल विवरण" : "Tools & Model Diagnostics"}
            onClose={() => setEnginesModalOpen(false)}
          >
            <EnginesView
              mode={processingLocation}
              onModeChange={setProcessingLocation}
              locale={locale}
              runtime={runtime.data}
              failed={runtime.failed}
              loading={runtime.loading}
              onRefresh={runtime.refresh}
            />
          </WorkspaceDialog>
        )}

        {/* Contextual Dialog: Reviewed Evidence Source Reader */}
        {sourceModalOpen && selectedSourceId && (
          <WorkspaceDialog
            title={ne ? "अनुमोदित क्लिनिकल स्रोत" : "Reviewed Clinical Source"}
            onClose={() => setSourceModalOpen(false)}
          >
            <KnowledgeView
              locale={locale}
              initialSourceId={selectedSourceId}
              onSelectQuestion={(q) => {
                setInitialQuery(q);
                setSourceModalOpen(false);
                open("chat");
              }}
            />
          </WorkspaceDialog>
        )}
      </main>

      <footer className="app-footer">
        <div className="footer-links-row">
          <span>ArogyaAI</span>
          <small>
            {ne ? "निर्माण" : "Build"}: {process.env.NEXT_PUBLIC_BUILD_ID}
          </small>
          <button
            type="button"
            className="text-button"
            onClick={() => setPrivacyModalOpen(true)}
          >
            {ne ? "गोपनीयता" : "Privacy"}
          </button>
          <button
            type="button"
            className="text-button"
            onClick={() => setEnginesModalOpen(true)}
          >
            {ne ? "औजार तथा मोडेल" : "Tools & models"}
          </button>
        </div>
        <p>{text.footer}</p>
      </footer>
    </div>
  );
}

export default function Home() {
  return (
    <ModelProvider>
      <SessionProvider>
        <HistoryProvider>
          <ConversationProvider>
            <MainContent />
          </ConversationProvider>
        </HistoryProvider>
      </SessionProvider>
    </ModelProvider>
  );
}
