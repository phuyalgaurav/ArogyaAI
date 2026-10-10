"use client";

import { useWorkspace } from "@/components/layout/WorkspaceLayout";
import { useHistory } from "@/features/history/HistoryContext";
import { MedicineView } from "@/features/medicines/MedicineView";

export default function MedicinePage() {
  const { locale, processingLocation, selectSource } = useWorkspace();
  const history = useHistory();
  return (
    <MedicineView
      key={history.currentId}
      locale={locale}
      processingLocation={processingLocation}
      onSelectSource={selectSource}
    />
  );
}
