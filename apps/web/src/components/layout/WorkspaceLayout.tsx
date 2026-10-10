"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { workspaceCopy } from "@/components/layout/copy";
import {
  destinationForHash,
  destinationForMode,
  destinationForPath,
  isConversationPage,
  pageCopy,
  type WorkspaceLocale,
  type WorkspaceTab,
  workspacePaths,
  workspaceTabs,
} from "@/components/layout/navigation";
import { WorkspacePageHeader } from "@/components/layout/WorkspacePageHeader";
import { WorkspaceSidebar } from "@/components/layout/WorkspaceSidebar";
import { WorkspaceDialog } from "@/components/ui/WorkspaceDialog";
import { SessionProvider } from "@/context/SessionContext";
import {
  ConversationProvider,
  useConversation,
} from "@/features/conversations/ConversationContext";
import { HistoryProvider, useHistory } from "@/features/history/HistoryContext";
import { KnowledgeView } from "@/features/knowledge/KnowledgeView";
import {
  ProfileControl,
  ProfileProvider,
} from "@/features/profile/ProfileContext";
import type { ProcessingLocation } from "@/features/settings/device-specs";
import { EnginesView } from "@/features/settings/EnginesView";
import { ModelProvider } from "@/features/settings/ModelContext";
import { PrivacyView } from "@/features/settings/PrivacyView";
import { useRuntime } from "@/features/settings/use-runtime";
import { copy } from "@/lib/copy";

interface WorkspaceContextValue {
  locale: WorkspaceLocale;
  setLocale: (locale: WorkspaceLocale) => void;
  runtime: ReturnType<typeof useRuntime>;
  processingLocation: ProcessingLocation;
  initialQuery: string | null;
  open: (target: WorkspaceTab) => void;
  resume: (id: string) => Promise<void>;
  startChat: () => void;
  selectSource: (id: string) => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function useWorkspace() {
  const workspace = useContext(WorkspaceContext);
  if (!workspace) throw new Error("WorkspaceLayout is required");
  return workspace;
}

function WorkspaceShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const activeTab = destinationForPath(pathname);
  const [locale, updateLocale] = useState<WorkspaceLocale>("en");
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const [initialQuery, setInitialQuery] = useState<string | null>(null);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [enginesOpen, setEnginesOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [processingLocation, setProcessingLocation] =
    useState<ProcessingLocation>("server");
  const runtime = useRuntime();
  const history = useHistory();
  const conversation = useConversation();
  const workflowIds = useRef<Partial<Record<WorkspaceTab, string>>>({});
  const previousTab = useRef(activeTab);
  const preparedDestination = useRef<WorkspaceTab | null>(null);
  const routeIsChanging =
    previousTab.current !== activeTab ||
    (preparedDestination.current !== null &&
      preparedDestination.current !== activeTab);
  const current = useRef({ activeTab, history, conversation, locale });
  current.current = { activeTab, history, conversation, locale };
  const ne = locale === "ne";
  const text = copy[ne ? "ne" : "en"];
  const pages = pageCopy(locale);
  const page = pages[activeTab];

  useEffect(() => {
    try {
      const saved = localStorage.getItem("arogya-locale");
      if (saved === "en" || saved === "ne" || saved === "tam")
        updateLocale(saved);
    } catch {
      /* Language selection still works when storage is unavailable. */
    }
  }, []);

  function setLocale(next: WorkspaceLocale) {
    updateLocale(next);
    try {
      localStorage.setItem("arogya-locale", next);
    } catch {
      /* Optional preference. */
    }
  }

  useEffect(() => {
    document.documentElement.lang = ne ? "ne" : "en";
    document.title = `${page.title} · ArogyaAI`;
  }, [ne, page.title]);

  const canNavigate = useCallback(() => {
    const state = current.current;
    if (!state.conversation.loading && !state.history.sending) {
      setNavigationError(null);
      return true;
    }
    setNavigationError(
      state.locale === "ne"
        ? "प्रक्रिया चल्दै छ। रोक्नुहोस् वा पर्खनुहोस्।"
        : "Processing is in progress. Cancel it or wait before switching conversations.",
    );
    return false;
  }, []);

  // Runs for links, task starts, and browser Back/Forward. Providers stay mounted
  // in the root layout, so each workflow retains its conversation and drafts.
  const prepareNavigation = useCallback(
    (target: WorkspaceTab, from = current.current.activeTab) => {
      if (!canNavigate()) return false;
      const { history } = current.current;
      if (target !== from) {
        if (isConversationPage(from))
          workflowIds.current[from] = history.currentId;
        if (isConversationPage(target)) {
          const previous = workflowIds.current[target];
          if (previous) history.selectChat(previous);
          else history.newChat();
        }
      }
      preparedDestination.current = target;
      return true;
    },
    [canNavigate],
  );

  function open(target: WorkspaceTab) {
    if (prepareNavigation(target)) router.push(workspacePaths[target]);
  }

  useEffect(() => {
    if (previousTab.current === activeTab) return;
    if (
      preparedDestination.current !== activeTab &&
      !prepareNavigation(activeTab, previousTab.current)
    ) {
      router.replace(workspacePaths[previousTab.current], { scroll: false });
      return;
    }
    previousTab.current = activeTab;
    preparedDestination.current = null;
    setPrivacyOpen(false);
    setEnginesOpen(false);
    setSourcesOpen(false);
    document.getElementById("workspace-title")?.focus({ preventScroll: true });
  }, [activeTab, prepareNavigation, router]);

  // Bookmarked fragment URLs from earlier builds open the corresponding page.
  useEffect(() => {
    function migrateHash() {
      const hash = window.location.hash;
      const target = destinationForHash(hash);
      if (target && prepareNavigation(target))
        router.replace(workspacePaths[target]);
      if (hash === "#privacy") setPrivacyOpen(true);
      if (hash === "#engines") setEnginesOpen(true);
      if (hash === "#knowledge") setSourcesOpen(true);
    }
    migrateHash();
    window.addEventListener("hashchange", migrateHash);
    return () => window.removeEventListener("hashchange", migrateHash);
  }, [prepareNavigation, router]);

  async function resume(id: string) {
    if (!canNavigate()) return;
    try {
      const saved = await history.readContext(id);
      if (!canNavigate()) return;
      const target = destinationForMode(saved?.mode);
      if (isConversationPage(activeTab))
        workflowIds.current[activeTab] = history.currentId;
      workflowIds.current[target] = id;
      history.selectChat(id);
      setInitialQuery(null);
      preparedDestination.current = target;
      router.push(workspacePaths[target]);
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
    // A route change and session selection can commit in separate renders.
    // Do not mistake the outgoing snapshot for a mismatch in the new workflow.
    if (routeIsChanging) return;
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
    routeIsChanging,
  ]);

  function startChat() {
    if (!canNavigate()) return;
    if (isConversationPage(activeTab))
      workflowIds.current[activeTab] = history.currentId;
    delete workflowIds.current.chat;
    history.newChat();
    setInitialQuery(null);
    preparedDestination.current = "chat";
    router.push(workspacePaths.chat);
  }

  function selectSource(id: string) {
    setSelectedSourceId(id);
    setSourcesOpen(true);
  }

  const icons = {
    dashboard: "home",
    transcription: "image",
    medicines: "medicine",
    history: "library",
    chat: "ask",
  } as const;

  return (
    <WorkspaceContext.Provider
      value={{
        locale,
        setLocale,
        runtime,
        processingLocation,
        initialQuery,
        open,
        resume,
        startChat,
        selectSource,
      }}
    >
      <div
        className={`shell workspace-shell${activeTab === "chat" ? " workspace-chat" : ""}`}
      >
        <button
          type="button"
          className="skip-link"
          onClick={() => {
            document.getElementById("main")?.focus();
          }}
        >
          {text.skipToContent}
        </button>
        <WorkspaceSidebar
          items={workspaceTabs.map((id) => ({
            id,
            label: pages[id].title,
            icon: icons[id],
          }))}
          active={activeTab}
          locale={locale}
          preview={workspaceCopy[ne ? "ne" : "en"].preview}
          languageLabel={text.languageSelect}
          onLocale={setLocale}
          onNavigate={prepareNavigation}
          onOpenPrivacy={() => setPrivacyOpen(true)}
          onOpenEngines={() => setEnginesOpen(true)}
        />
        <main id="main" tabIndex={-1} className="workspace-main">
          <WorkspacePageHeader
            title={page.title}
            description={page.description}
          />
          <ProfileControl
            active={isConversationPage(activeTab)}
            locale={locale}
          />
          {navigationError && (
            <div className="notice notice-warning" role="alert">
              <p>{navigationError}</p>
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => {
                  void conversation
                    .cancel()
                    .then(() => setNavigationError(null))
                    .catch((failure) => setNavigationError(String(failure)));
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
          <div className="workspace-page-body">{children}</div>
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
              onClick={() => setPrivacyOpen(true)}
            >
              {ne ? "गोपनीयता" : "Privacy"}
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => setEnginesOpen(true)}
            >
              {ne ? "औजार तथा मोडेल" : "Tools & models"}
            </button>
          </div>
          <p>{text.footer}</p>
        </footer>
        {privacyOpen && (
          <WorkspaceDialog
            title={ne ? "गोपनीयता तथा डेटा नियन्त्रण" : "Privacy & Data Controls"}
            onClose={() => setPrivacyOpen(false)}
          >
            <PrivacyView
              locale={locale}
              onOpenHistory={() => {
                if (!canNavigate()) return;
                setPrivacyOpen(false);
                open("history");
              }}
            />
          </WorkspaceDialog>
        )}
        {enginesOpen && (
          <WorkspaceDialog
            title={ne ? "औजार तथा मोडेल विवरण" : "Tools & Model Diagnostics"}
            onClose={() => setEnginesOpen(false)}
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
        {sourcesOpen && (
          <WorkspaceDialog
            title={ne ? "स्वास्थ्य जानकारीका स्रोत" : "Health information sources"}
            onClose={() => setSourcesOpen(false)}
          >
            <KnowledgeView
              locale={locale}
              initialSourceId={selectedSourceId}
              onSelectQuestion={(question) => {
                if (!canNavigate()) return;
                setInitialQuery(question);
                setSourcesOpen(false);
                open("chat");
              }}
            />
          </WorkspaceDialog>
        )}
      </div>
    </WorkspaceContext.Provider>
  );
}

export function WorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <ModelProvider>
      <SessionProvider>
        <HistoryProvider>
          <ProfileProvider>
            <ConversationProvider>
              <WorkspaceShell>{children}</WorkspaceShell>
            </ConversationProvider>
          </ProfileProvider>
        </HistoryProvider>
      </SessionProvider>
    </ModelProvider>
  );
}
