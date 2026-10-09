"use client";

import { workspaceCopy } from "@/components/layout/copy";
import { useSession } from "@/context/SessionContext";
import { copy } from "@/lib/copy";

export function ConsentBanner({ locale }: { locale: "en" | "ne" | "tam" }) {
  const text = copy[locale === "ne" ? "ne" : "en"];
  const t = workspaceCopy[locale === "ne" ? "ne" : "en"];
  const {
    hasActiveConsent,
    isConsentLoading,
    grantConsent,
    revokeConsent,
    error,
  } = useSession();
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
