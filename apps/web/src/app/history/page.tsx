"use client";

import { useWorkspace } from "@/components/layout/WorkspaceLayout";
import { HistoryView } from "@/features/history/HistoryView";

export default function HistoryPage() {
  const { locale, resume, startChat } = useWorkspace();
  return <HistoryView locale={locale} onOpen={resume} onNew={startChat} />;
}
