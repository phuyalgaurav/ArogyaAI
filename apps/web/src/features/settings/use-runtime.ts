"use client";

import type { RuntimeStatus } from "@arogya/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchRuntime } from "@/lib/api";

export function useRuntime() {
  const [data, setData] = useState<RuntimeStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    const timeout = setTimeout(() => controller.abort(), 10000);
    setLoading(true);
    try {
      const result = await fetchRuntime(controller.signal);
      if (pending.current !== controller) return;
      if (
        !Array.isArray(result.engines) ||
        result.engines.length < 2 ||
        result.engines.length > 7 ||
        new Set(result.engines.map((engine) => engine.id)).size !==
          result.engines.length ||
        !result.checked_at
      )
        throw new Error("Invalid runtime status");
      setData(result);
      setFailed(false);
    } catch {
      if (pending.current === controller) {
        setData(null);
        setFailed(true);
      }
    } finally {
      clearTimeout(timeout);
      if (pending.current === controller) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const poll = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const interval = setInterval(poll, 15000);
    document.addEventListener("visibilitychange", poll);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", poll);
      pending.current?.abort();
      pending.current = null;
    };
  }, [refresh]);
  return { data, loading, failed, refresh };
}
