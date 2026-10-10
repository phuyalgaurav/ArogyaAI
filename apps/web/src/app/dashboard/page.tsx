"use client";

import { TaskHome } from "@/components/layout/TaskHome";
import { useWorkspace } from "@/components/layout/WorkspaceLayout";

export default function DashboardPage() {
  const { locale, open, runtime, resume } = useWorkspace();
  return (
    <TaskHome
      locale={locale}
      onOpen={open}
      runtime={runtime.data}
      onContinueChat={(id) => {
        void resume(id).catch(() => {});
      }}
    />
  );
}
