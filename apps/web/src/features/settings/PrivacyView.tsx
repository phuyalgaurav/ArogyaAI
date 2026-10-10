"use client";

import { useState } from "react";
import { type ProcessingPurpose, useSession } from "@/context/SessionContext";
import { exportUserData } from "@/lib/api";
import { copy } from "@/lib/copy";

interface PrivacyViewProps {
  locale: "en" | "ne" | "tam";
  onOpenHistory: () => void;
}

export function PrivacyView({ locale, onOpenHistory }: PrivacyViewProps) {
  const text = copy[locale === "ne" ? "ne" : "en"];
  const {
    token,
    expiresAt,
    consent,
    isExpired,
    hasActiveConsent,
    initSession,
    deleteSession,
    scopedConsents,
    revokeProcessing,
  } = useSession();

  const [exportedData, setExportedData] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  async function handleExport() {
    if (!token) return;
    setIsExporting(true);
    setStatusMessage(null);
    try {
      const data = await exportUserData(token);
      setExportedData(data);
    } catch (err) {
      setStatusMessage(
        err instanceof Error ? err.message : "Failed to export data",
      );
    } finally {
      setIsExporting(false);
    }
  }

  async function handleDelete() {
    setIsDeleting(true);
    setStatusMessage(null);
    try {
      await deleteSession();
      setExportedData(null);
      setStatusMessage(text.deleteSuccess);
    } catch (err) {
      setStatusMessage(
        err instanceof Error ? err.message : "Failed to delete session",
      );
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <section className="privacy-view" aria-labelledby="privacy-heading">
      <header className="privacy-header">
        <h2 id="privacy-heading">{text.privacyTitle}</h2>
        <p className="privacy-subtitle">{text.privacySubtitle}</p>
      </header>

      {statusMessage && (
        <div className="status-notification" role="status">
          {statusMessage}
        </div>
      )}

      <section className="history-storage-card">
        <h3>Chat storage</h3>
        <p>
          Chats are saved in SQLite on this browser. Optional server copies
          require separate permission and expire after 30 days. Session deletion
          below removes processing permissions and session metadata; chat
          history is managed separately.
        </p>
        <button type="button" className="text-button" onClick={onOpenHistory}>
          {locale === "ne"
            ? "कुराकानी निर्यात, मेटाउन वा सर्भर प्रतिलिपि व्यवस्थापन गर्न विगतका रेकर्ड खोल्नुहोस्"
            : "Open chat history to export, delete or manage server copies"}
        </button>
      </section>
      {/* Session Metadata Card */}
      <div className="session-card">
        <div className="session-card-head">
          <h3>
            {token ? (
              <span className="status-indicator status-indicator-online">
                ● {isExpired ? text.sessionExpired : text.sessionActive}
              </span>
            ) : (
              <span className="status-indicator status-indicator-offline">
                ○ No Active Session
              </span>
            )}
          </h3>

          {!token ? (
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => initSession()}
            >
              {text.createNewSession}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-outline-danger"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? text.checking : text.deleteDataBtn}
            </button>
          )}
        </div>

        {token && (
          <div className="session-details">
            <div className="detail-item">
              <strong>{text.sessionExpires}:</strong>{" "}
              <span>
                {expiresAt ? new Date(expiresAt).toLocaleString() : "—"}
              </span>
            </div>
            <div className="detail-item">
              <strong>{text.consentTitle}:</strong>{" "}
              <span>
                {hasActiveConsent
                  ? text.consentGrantedBadge
                  : consent?.revoked
                    ? text.consentRevokedBadge
                    : "Not Granted"}
              </span>
            </div>
            {consent && (
              <div className="detail-item">
                <strong>Consent Expiry:</strong>{" "}
                <span>{new Date(consent.expires_at).toLocaleString()}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {token && (
        <section
          className="scoped-privacy"
          aria-label={
            locale === "ne"
              ? "तस्बिर, भाषा र आवाजको अनुमति"
              : "Image, language and voice permissions"
          }
        >
          <h3>
            {locale === "ne"
              ? "तस्बिर, भाषा र आवाजको अनुमति"
              : "Image, language and voice permissions"}
          </h3>
          {(
            [
              "image_transcription",
              "document_explanation",
              "conversation_restore",
              "translation",
              "speech_transcription",
              "speech_synthesis",
            ] as ProcessingPurpose[]
          ).map((purpose) => {
            const grant = scopedConsents[purpose];
            const active =
              grant &&
              !grant.revoked &&
              Date.parse(grant.expires_at) > Date.now() &&
              !isExpired;
            const label = {
              conversation_restore:
                locale === "ne"
                  ? "सुरक्षित कुराकानी पुनः सुरु"
                  : "Resume saved conversation context",
              image_transcription: "Image transcription on the server",
              document_explanation: "Document text and questions on the server",
              translation: "Translation text",
              speech_transcription: "Nepali audio transcription",
              speech_synthesis: "Nepali speech playback",
            }[purpose];
            return (
              <div key={purpose}>
                <span>
                  {label} ·{" "}
                  {active
                    ? "Enabled until " +
                      new Date(grant.expires_at).toLocaleTimeString()
                    : "Not enabled"}
                </span>
                {active && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={async () => {
                      try {
                        await revokeProcessing(purpose);
                        setStatusMessage("Permission revoked.");
                      } catch {
                        setStatusMessage(
                          "Could not revoke permission. Check the server connection.",
                        );
                      }
                    }}
                  >
                    Revoke
                  </button>
                )}
              </div>
            );
          })}
        </section>
      )}
      {/* Export / Delete Action Panel */}
      {token && (
        <div className="privacy-actions-panel">
          <button
            type="button"
            className="btn btn-outline"
            onClick={handleExport}
            disabled={isExporting}
          >
            {isExporting ? text.checking : text.exportDataBtn}
          </button>
        </div>
      )}

      {/* Exported JSON Viewer */}
      {exportedData && (
        <section className="exported-data-box" aria-labelledby="export-title">
          <h3 id="export-title">{text.exportTitle}</h3>
          <pre className="json-display">
            {JSON.stringify(exportedData, null, 2)}
          </pre>
        </section>
      )}
    </section>
  );
}
