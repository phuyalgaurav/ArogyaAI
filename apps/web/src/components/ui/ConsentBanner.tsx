"use client";

import { workspaceCopy } from "@/components/layout/copy";
import { useSession } from "@/context/SessionContext";
import { copy } from "@/lib/copy";

export function ConsentBanner({
  locale,
  compact = false,
}: {
  locale: "en" | "ne" | "tam";
  compact?: boolean;
}) {
  const ne = locale === "ne";
  const text = copy[locale === "ne" ? "ne" : "en"];
  const t = workspaceCopy[locale === "ne" ? "ne" : "en"];
  const {
    hasActiveConsent,
    isConsentLoading,
    grantConsent,
    revokeConsent,
    error,
  } = useSession();
  if (compact) {
    return (
      <section className="chat-sharing" aria-label={t.consentDetails}>
        {!hasActiveConsent && (
          <div className="chat-sharing-prompt">
            <p>
              {ne
                ? "जवाफका लागि प्रश्न र कुराकानी ArogyaAI मा पठाइन्छ।"
                : "Questions and conversation are sent to ArogyaAI for an answer."}
            </p>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={grantConsent}
              disabled={isConsentLoading}
            >
              {isConsentLoading
                ? text.checking
                : ne
                  ? "अनुमति दिनुहोस्"
                  : "Allow questions"}
            </button>
          </div>
        )}
        <details>
          <summary>
            {hasActiveConsent
              ? ne
                ? "प्रश्न पठाउने अनुमति छ · विवरण"
                : "Question sharing is on · Details"
              : t.consentDetails}
          </summary>
          <p>{t.sharingBody}</p>
          <ul className="consent-details">
            <li>{text.consentDataCategory}</li>
            <li>{text.consentPurpose}</li>
            <li>{text.consentStorageNotice}</li>
            <li>{text.consentDuration}</li>
          </ul>
          {hasActiveConsent && (
            <button
              type="button"
              className="text-button"
              onClick={revokeConsent}
              disabled={isConsentLoading}
            >
              {isConsentLoading ? text.checking : text.revokeConsentBtn}
            </button>
          )}
        </details>
        {error && <p role="alert">{error}</p>}
      </section>
    );
  }
  return (
    <section
      className="consent-banner compact-consent"
      aria-labelledby="consent-title"
    >
      <div className="sharing-summary">
        <div>
          <h2 id="consent-title">
            {hasActiveConsent ? t.consentAfter : t.consentBefore}
          </h2>
          <p>{t.sharingBody}</p>
        </div>
        <button
          type="button"
          className={hasActiveConsent ? "btn-secondary" : ""}
          onClick={hasActiveConsent ? revokeConsent : grantConsent}
          disabled={isConsentLoading}
        >
          {isConsentLoading
            ? text.checking
            : hasActiveConsent
              ? text.revokeConsentBtn
              : text.grantConsentBtn}
        </button>
      </div>
      <details>
        <summary>{t.consentDetails}</summary>
        <ul className="consent-details">
          <li>{text.consentDataCategory}</li>
          <li>{text.consentPurpose}</li>
          <li>{text.consentStorageNotice}</li>
          <li>{text.consentDuration}</li>
        </ul>
      </details>
      {error && (
        <p className="consent-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
