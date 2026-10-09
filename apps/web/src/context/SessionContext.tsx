"use client";

import type { ConsentGrant, SessionResponse } from "@arogya/contracts";
import type React from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  createConsent as apiCreateConsent,
  createSession as apiCreateSession,
  deleteUserData as apiDeleteUserData,
  revokeConsent as apiRevokeConsent,
} from "@/lib/api";

export type ProcessingPurpose =
  | "translation"
  | "speech_transcription"
  | "speech_synthesis"
  | "image_transcription"
  | "document_explanation"
  | "conversation_restore";
interface SessionContextType {
  forgetProcessing: (purpose: ProcessingPurpose) => void;
  scopedConsents: Partial<Record<ProcessingPurpose, ConsentGrant>>;
  grantProcessing: (
    purpose: ProcessingPurpose,
  ) => Promise<{ token: string; consent: ConsentGrant } | null>;
  revokeProcessing: (purpose: ProcessingPurpose) => Promise<void>;
  token: string | null;
  expiresAt: string | null;
  consent: ConsentGrant | null;
  isSessionLoading: boolean;
  isConsentLoading: boolean;
  error: string | null;
  isExpired: boolean;
  hasActiveConsent: boolean;
  initSession: () => Promise<string | null>;
  grantConsent: () => Promise<ConsentGrant | null>;
  revokeConsent: () => Promise<void>;
  deleteSession: () => Promise<void>;
  clearError: () => void;
}

const SessionContext = createContext<SessionContextType | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  // In-memory token and consent storage as mandated by privacy requirements
  const [token, setToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [consent, setConsent] = useState<ConsentGrant | null>(null);
  const [isSessionLoading, setIsSessionLoading] = useState<boolean>(false);
  const [isConsentLoading, setIsConsentLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isExpired, setIsExpired] = useState<boolean>(false);

  const [scopedConsents, setScopedConsents] = useState<
    Partial<Record<ProcessingPurpose, ConsentGrant>>
  >({});
  const identity = useRef<{ token: string | null; expiresAt: string | null }>({
    token: null,
    expiresAt: null,
  });
  const grants = useRef<
    Partial<Record<ProcessingPurpose, { token: string; consent: ConsentGrant }>>
  >({});
  const chatGrant = useRef<{ token: string; consent: ConsentGrant } | null>(
    null,
  );
  const pendingSession = useRef<Promise<string | null> | null>(null);
  const forgetProcessing = useCallback((purpose: ProcessingPurpose) => {
    delete grants.current[purpose];
    setScopedConsents((old) => {
      const next = { ...old };
      delete next[purpose];
      return next;
    });
  }, []);

  // Periodically check session expiry
  useEffect(() => {
    if (!expiresAt) return;
    const interval = setInterval(() => {
      const now = Date.now();
      const expiry = new Date(expiresAt).getTime();
      if (now >= expiry) {
        setIsExpired(true);
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  const initSession = useCallback(async (): Promise<string | null> => {
    if (
      identity.current.token &&
      identity.current.expiresAt &&
      Date.parse(identity.current.expiresAt) > Date.now()
    )
      return identity.current.token;
    if (pendingSession.current) return pendingSession.current;
    const request = (async () => {
      setIsSessionLoading(true);
      setError(null);
      try {
        const res: SessionResponse = await apiCreateSession();
        identity.current = {
          token: res.access_token,
          expiresAt: res.expires_at,
        };
        setToken(res.access_token);
        setExpiresAt(res.expires_at);
        setIsExpired(false);
        grants.current = {};
        chatGrant.current = null;
        setConsent(null);
        setScopedConsents({});
        return res.access_token;
      } catch (failure) {
        setError(
          failure instanceof Error
            ? failure.message
            : "Failed to initialize session",
        );
        return null;
      } finally {
        setIsSessionLoading(false);
        pendingSession.current = null;
      }
    })();
    pendingSession.current = request;
    return request;
  }, []);

  const grantProcessing = useCallback(
    async (purpose: ProcessingPurpose) => {
      let current = identity.current.token;
      const expiry = identity.current.expiresAt;
      if (!current || !expiry || Date.parse(expiry) <= Date.now()) {
        current = await initSession();
      }
      if (!current) return null;
      const cached = grants.current[purpose];
      if (
        cached?.token === current &&
        !cached.consent.revoked &&
        Date.parse(cached.consent.expires_at) > Date.now()
      )
        return cached;
      const category = {
        translation: "translation_text",
        speech_transcription: "audio_clip",
        speech_synthesis: "speech_text",
        image_transcription: "image_bytes",
        document_explanation: "document_text",
        conversation_restore: "conversation_context",
      } as const;
      try {
        const grant = await apiCreateConsent(
          current,
          3600,
          undefined,
          purpose,
          category[purpose],
        );
        grants.current[purpose] = { token: current, consent: grant };
        setScopedConsents((old) => ({ ...old, [purpose]: grant }));
        return { token: current, consent: grant };
      } catch (failure) {
        setError(
          failure instanceof Error
            ? failure.message
            : "Permission could not be saved.",
        );
        return null;
      }
    },
    [initSession],
  );
  const revokeProcessing = useCallback(
    async (purpose: ProcessingPurpose) => {
      const grant = scopedConsents[purpose];
      if (!token || !grant) return;
      await apiRevokeConsent(token, grant.id);
      delete grants.current[purpose];
      setScopedConsents((old) => ({
        ...old,
        [purpose]: { ...grant, revoked: true },
      }));
    },
    [token, scopedConsents],
  );

  const grantConsent = useCallback(async (): Promise<ConsentGrant | null> => {
    let currentToken = identity.current.token;
    if (
      !currentToken ||
      !identity.current.expiresAt ||
      Date.parse(identity.current.expiresAt) <= Date.now()
    ) {
      currentToken = await initSession();
      if (!currentToken) return null;
    }
    if (
      chatGrant.current?.token === currentToken &&
      !chatGrant.current.consent.revoked &&
      Date.parse(chatGrant.current.consent.expires_at) > Date.now()
    )
      return chatGrant.current.consent;
    setIsConsentLoading(true);
    setError(null);
    try {
      const grant = await apiCreateConsent(currentToken, 3600);
      chatGrant.current = { token: currentToken, consent: grant };
      setConsent(grant);
      return grant;
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to grant consent";
      setError(msg);
      return null;
    } finally {
      setIsConsentLoading(false);
    }
  }, [initSession]);

  const revokeConsent = useCallback(async (): Promise<void> => {
    if (!token || !consent?.id) return;
    setIsConsentLoading(true);
    setError(null);
    try {
      await apiRevokeConsent(token, consent.id);
      chatGrant.current = null;
      setConsent((prev) => (prev ? { ...prev, revoked: true } : null));
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to revoke consent";
      setError(msg);
    } finally {
      setIsConsentLoading(false);
    }
  }, [token, consent]);

  const deleteSession = useCallback(async (): Promise<void> => {
    if (token) {
      try {
        await apiDeleteUserData(token);
      } catch {
        throw new Error(
          "Server deletion is not confirmed. Your session is retained so you can retry when connected.",
        );
      }
    }
    grants.current = {};
    chatGrant.current = null;
    identity.current = { token: null, expiresAt: null };
    setToken(null);
    setExpiresAt(null);
    setConsent(null);
    setIsExpired(false);
    setError(null);
    setScopedConsents({});
  }, [token]);

  const clearError = useCallback(() => setError(null), []);

  const hasActiveConsent = Boolean(
    token &&
      expiresAt &&
      Date.parse(expiresAt) > Date.now() &&
      consent &&
      !consent.revoked &&
      new Date(consent.expires_at).getTime() > Date.now(),
  );

  return (
    <SessionContext.Provider
      value={{
        forgetProcessing,
        scopedConsents,
        grantProcessing,
        revokeProcessing,
        token,
        expiresAt,
        consent,
        isSessionLoading,
        isConsentLoading,
        error,
        isExpired,
        hasActiveConsent,
        initSession,
        grantConsent,
        revokeConsent,
        deleteSession,
        clearError,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionContextType {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error("useSession must be used within a SessionProvider");
  }
  return ctx;
}
