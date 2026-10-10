"use client";

import { useWorkspace } from "@/components/layout/WorkspaceLayout";
import { ChatView } from "@/features/chat/ChatView";
import { useHistory } from "@/features/history/HistoryContext";

export default function ChatPage() {
  const { locale, setLocale, selectSource, initialQuery, open } =
    useWorkspace();
  const history = useHistory();
  return (
    <ChatView
      key={history.currentId}
      locale={locale}
      onSelectSource={selectSource}
      initialQuery={initialQuery}
      onNepaliVoice={() => setLocale("ne")}
      onOpenHistory={() => open("history")}
    />
  );
}
