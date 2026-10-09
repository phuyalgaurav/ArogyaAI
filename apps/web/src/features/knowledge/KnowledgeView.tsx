"use client";

import type { KnowledgeSource, ReviewedQuestion } from "@arogya/contracts";
import { useEffect, useState } from "react";
import {
  fetchKnowledgeManifest,
  fetchQuestions,
  fetchSigningKey,
  fetchSource,
  type KnowledgeManifestResponse,
  type SigningKeyDescriptor,
} from "@/lib/api";
import { copy } from "@/lib/copy";
import { stableTextEntries } from "@/lib/list-keys";

interface KnowledgeViewProps {
  locale: "en" | "ne" | "tam";
  initialSourceId?: string | null;
  onSelectQuestion?: (question: string) => void;
}

export function KnowledgeView({
  locale,
  initialSourceId,
  onSelectQuestion,
}: KnowledgeViewProps) {
  const text = copy[locale === "ne" ? "ne" : "en"];
  const [questions, setQuestions] = useState<ReviewedQuestion[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [search, setSearch] = useState<string>("");
  const [manifestData, setManifestData] =
    useState<KnowledgeManifestResponse | null>(null);
  const [signingKeyData, setSigningKeyData] =
    useState<SigningKeyDescriptor | null>(null);
  const [showBundleInfo, setShowBundleInfo] = useState<boolean>(false);

  const [activeSourceId, setActiveSourceId] = useState<string | null>(
    initialSourceId || null,
  );
  const [sourceData, setSourceData] = useState<KnowledgeSource | null>(null);
  const [loadingSource, setLoadingSource] = useState<boolean>(false);
  const [sourceError, setSourceError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const lang = locale === "ne" ? "ne" : "en";
    fetchQuestions(lang, 50)
      .then((data) => {
        if (active) setQuestions(data);
      })
      .catch(() => {
        if (active) setQuestions([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [locale]);

  useEffect(() => {
    if (!activeSourceId) {
      setSourceData(null);
      return;
    }
    let active = true;
    setLoadingSource(true);
    setSourceError(null);
    fetchSource(activeSourceId)
      .then((src) => {
        if (active) setSourceData(src);
      })
      .catch((err) => {
        if (active) {
          setSourceError(
            err instanceof Error ? err.message : "Failed to load source",
          );
        }
      })
      .finally(() => {
        if (active) setLoadingSource(false);
      });
    return () => {
      active = false;
    };
  }, [activeSourceId]);

  useEffect(() => {
    let active = true;
    Promise.allSettled([fetchKnowledgeManifest(), fetchSigningKey()]).then(
      ([manifestRes, keyRes]) => {
        if (!active) return;
        if (manifestRes.status === "fulfilled") {
          setManifestData(manifestRes.value);
        }
        if (keyRes.status === "fulfilled") {
          setSigningKeyData(keyRes.value);
        }
      },
    );
    return () => {
      active = false;
    };
  }, []);

  const filteredQuestions = questions.filter((q) =>
    q.question.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <section className="knowledge-view" aria-labelledby="knowledge-title">
      <header className="knowledge-header">
        <h2 id="knowledge-title">{text.knowledgeTitle}</h2>
        <p className="knowledge-subtitle">{text.knowledgeSubtitle}</p>
      </header>

      {/* Offline Bundles & Governance Card */}
      <section
        className="bundle-governance-card"
        aria-labelledby="bundle-heading"
      >
        <div className="bundle-card-header">
          <div>
            <h3 id="bundle-heading">
              📦 Offline Bundles & Cryptographic Trust
            </h3>
            <p className="bundle-subtitle">
              {manifestData?.offline_bundle_available
                ? "Signed offline packages ready for disconnected clinical lookup."
                : "No verified bundle published yet. Redistribution requires cryptographic signatures."}
            </p>
          </div>
          <button
            type="button"
            className="btn btn-sm btn-outline"
            onClick={() => setShowBundleInfo((prev) => !prev)}
            aria-expanded={showBundleInfo}
          >
            {showBundleInfo ? "Hide Trust Info" : "Inspect Trust"}
          </button>
        </div>

        {showBundleInfo && (
          <div className="bundle-details-grid">
            <div className="bundle-detail-item">
              <span className="bundle-detail-label">
                Total Catalog Sources:{" "}
              </span>
              <strong>{manifestData?.total_sources ?? 0}</strong>
            </div>
            <div className="bundle-detail-item">
              <span className="bundle-detail-label">
                Verification Algorithm:{" "}
              </span>
              <strong>{signingKeyData?.algorithm ?? "Ed25519 (Strict)"}</strong>
            </div>
            <div className="bundle-detail-item">
              <span className="bundle-detail-label">Key Descriptor: </span>
              <code className="bundle-hash-code">
                {signingKeyData?.key_id
                  ? `${signingKeyData.key_id.slice(0, 16)}…`
                  : "Pinned out-of-band"}
              </code>
            </div>
            <div className="bundle-detail-item">
              <span className="bundle-detail-label">
                Redistribution Policy:{" "}
              </span>
              <span>Signed & approved clinical sources only</span>
            </div>
          </div>
        )}
      </section>

      {/* Source Details Modal / Card */}
      {activeSourceId && (
        <div
          className="source-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="source-modal-title"
        >
          <div className="source-modal-content">
            <div className="source-modal-header">
              <h3 id="source-modal-title">
                {sourceData?.title ||
                  `${text.sourceDetails}: ${activeSourceId}`}
              </h3>
              <button
                type="button"
                className="btn-close"
                onClick={() => setActiveSourceId(null)}
                aria-label="Close source preview"
              >
                ✕
              </button>
            </div>

            {loadingSource ? (
              <p className="loading-state">{text.checking}</p>
            ) : sourceError ? (
              <p className="error-state" role="alert">
                {sourceError}
              </p>
            ) : sourceData ? (
              <div className="source-body">
                <div className="source-meta-grid">
                  <div>
                    <strong>{text.versionLabel}:</strong> {sourceData.version}
                  </div>
                  <div>
                    <strong>{text.statusLabel}:</strong>{" "}
                    <span
                      className={`status-pill status-${sourceData.review_status}`}
                    >
                      {sourceData.review_status}
                    </span>
                  </div>
                  <div>
                    <strong>{text.licenseLabel}:</strong> {sourceData.license}
                  </div>
                  <div>
                    <strong>{text.validUntilLabel}:</strong>{" "}
                    {sourceData.valid_until}
                  </div>
                  {sourceData.source_url && (
                    <div>
                      <strong>URL:</strong>{" "}
                      <a
                        href={sourceData.source_url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {sourceData.source_url}
                      </a>
                    </div>
                  )}
                </div>

                <div className="source-sections">
                  <h4>Sections ({sourceData.sections.length})</h4>
                  {sourceData.sections.map((sec) => (
                    <div key={sec.id} className="source-section-card">
                      <div className="section-head">
                        <span className="section-id">§ {sec.id}</span>
                        {sec.kind && (
                          <span className="section-kind">{sec.kind}</span>
                        )}
                      </div>
                      <div className="section-sentences">
                        {stableTextEntries(sec.sentences).map(
                          ({ text: sentence, key }, idx) => (
                            <p key={key} className="sentence-item">
                              <span className="sentence-num">[{idx + 1}]</span>{" "}
                              {sentence}
                            </p>
                          ),
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* Main Questions Browser */}
      {loading ? (
        <div className="loading-container">
          <p>{text.checking}</p>
        </div>
      ) : questions.length === 0 ? (
        <section
          className="empty-catalog-card"
          aria-labelledby="empty-cat-title"
        >
          <div className="empty-icon" aria-hidden="true">
            📋
          </div>
          <h3 id="empty-cat-title">{text.knowledgeEmptyTitle}</h3>
          <p>{text.knowledgeEmptyBody}</p>
          <small>{text.requestNote}</small>
        </section>
      ) : (
        <div className="catalog-browser">
          <div className="search-bar">
            <input
              type="text"
              className="search-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={text.searchQuestions}
              aria-label={text.searchQuestions}
            />
          </div>

          <div className="questions-grid">
            {filteredQuestions.map((item) => (
              <article
                key={`${item.source_id}-${item.section_id}-${item.question}`}
                className="question-card"
              >
                <h3 className="question-title">{item.question}</h3>
                <div className="question-footer">
                  <span className="source-tag">
                    {item.source_id} (v{item.version})
                  </span>
                  <div className="question-actions">
                    <button
                      type="button"
                      className="btn btn-sm btn-outline"
                      onClick={() => setActiveSourceId(item.source_id)}
                    >
                      {text.sourceDetails}
                    </button>
                    {onSelectQuestion && (
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        onClick={() => onSelectQuestion(item.question)}
                      >
                        {text.askBtn}
                      </button>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
