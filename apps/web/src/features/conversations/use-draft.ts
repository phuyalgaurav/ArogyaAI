"use client";
import { type SetStateAction, useCallback, useState } from "react";
import { useHistory } from "@/features/history/HistoryContext";

// Unsubmitted text and photos stay in memory only, bounded to 50 sessions.
const drafts = new Map<string, Map<string, unknown>>();
export function useDraft<T>(
  name: string,
  initial: T,
): [T, (next: SetStateAction<T>) => void, boolean] {
  const { currentId } = useHistory();
  const saved = drafts.get(currentId);
  const existed = saved?.has(name) ?? false;
  const [value, setValue] = useState<T>(() =>
    existed ? (saved?.get(name) as T) : initial,
  );
  const update = useCallback(
    (next: SetStateAction<T>) =>
      setValue((old) => {
        const value =
          typeof next === "function" ? (next as (old: T) => T)(old) : next;
        if (!drafts.has(currentId)) drafts.set(currentId, new Map());
        drafts.get(currentId)?.set(name, value);
        if (drafts.size > 50)
          drafts.delete(drafts.keys().next().value as string);
        return value;
      }),
    [currentId, name],
  );
  return [value, update, existed];
}
