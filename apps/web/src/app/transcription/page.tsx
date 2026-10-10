"use client";

import { useWorkspace } from "@/components/layout/WorkspaceLayout";
import { TranscriptionView } from "@/features/documents/TranscriptionView";
import { useHistory } from "@/features/history/HistoryContext";

export default function TranscriptionPage() {
  const { locale, processingLocation, runtime, selectSource } = useWorkspace();
  const history = useHistory();
  return (
    <TranscriptionView
      key={history.currentId}
      locale={locale}
      processingLocation={processingLocation}
      runtime={runtime.data}
      onSelectSource={selectSource}
    />
  );
}
