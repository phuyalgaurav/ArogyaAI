"use client";

import type { RuntimeStatus } from "@arogya/contracts";
import { useEffect, useState } from "react";
import { workspaceCopy } from "@/components/layout/copy";
import { WorkspaceIcon } from "@/components/layout/WorkspaceIcon";
import { DeviceProcessing } from "@/features/settings/DeviceProcessing";
import type { ProcessingLocation } from "@/features/settings/device-specs";
import { ModelChoice } from "@/features/settings/ModelChoice";
import { ApiError, manageOperatorModel } from "@/lib/api";

export function EnginesView({
  locale,
  mode,
  onModeChange,
  runtime,
  loading,
  failed,
  onRefresh,
}: {
  locale: "en" | "ne" | "tam";
  mode: ProcessingLocation;
  onModeChange: (mode: ProcessingLocation) => void;
  runtime: RuntimeStatus | null;
  loading: boolean;
  failed: boolean;
  onRefresh: () => void;
}) {
  const t = workspaceCopy[locale === "ne" ? "ne" : "en"];
  const [ocrAvailable, setOcrAvailable] = useState<boolean | null>(null);
  const [operatorToken, setOperatorToken] = useState("");
  const [opBusy, setOpBusy] = useState(false);
  const [opMessage, setOpMessage] = useState<string | null>(null);
  const [opError, setOpError] = useState<string | null>(null);

  const locations: Record<string, string> = {
    bonsai: "Python computer (isolated Prism MLX worker)",
    qwen_selector: "Private inference worker (CPU/GPU)",
    laya_router: "Private inference worker (PyTorch CPU)",
    translation: "Language service (OPUS-MT)",
    nepali_stt: "Language service (Whisper/Wav2Vec2)",
    nepali_tts: "Language service (Piper TTS)",
    server_ocr: "Python server (native Tesseract)",
  };

  const engineLanguages: Record<string, string> = {
    bonsai: "Document text and prescription vision · draft output",
    qwen_selector: "English & Nepali (Evidence verification)",
    laya_router: "English, Nepali, Tamang (Routing)",
    translation: "English, Nepali, Tamang",
    nepali_stt: "Nepali audio input",
    nepali_tts: "Nepali audio synthesis (Kala/Barsha)",
    server_ocr: "English & Nepali printed text",
  };

  async function handleModelAction(
    action: "warm" | "unload",
    expectedRevision: string,
  ) {
    if (!operatorToken.trim() || opBusy) return;
    setOpBusy(true);
    setOpMessage(null);
    setOpError(null);
    try {
      await manageOperatorModel(operatorToken, {
        action,
        expected_revision: expectedRevision,
      });
      setOpMessage(
        `Model ${action === "warm" ? "warmed" : "unloaded"} successfully.`,
      );
      onRefresh();
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          setOpError("Unauthorized: invalid administrator token.");
        } else if (err.status === 403) {
          setOpError("Forbidden: administrator role required.");
        } else if (err.status === 409) {
          setOpError(
            "Conflict: running model revision does not match the configured pin.",
          );
        } else if (err.status === 503) {
          setOpError(
            "Service unavailable: inference worker busy or unreachable.",
          );
        } else {
          setOpError(err.detail || "Operator action failed.");
        }
      } else if (err instanceof Error) {
        setOpError(err.message);
      } else {
        setOpError("Operation failed.");
      }
    } finally {
      setOpBusy(false);
    }
  }

  const qwenEngine = runtime?.engines.find((e) => e.id === "qwen_selector");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/ocr/manifest.json", { signal: controller.signal })
      .then(async (response) => {
        const data = response.ok ? await response.json() : null;
        if (!controller.signal.aborted)
          setOcrAvailable(
            data?.version === "7.0.0" &&
              Boolean(data?.languages?.eng && data?.languages?.nep),
          );
      })
      .catch(() => {
        if (!controller.signal.aborted) setOcrAvailable(false);
      });
    return () => controller.abort();
  }, []);
  const labels = {
    ready: t.ready,
    busy: t.busy,
    unavailable: t.offline,
    unconfigured: t.unconfigured,
  };
  const tasks = {
    document_vision: "Document reading & prescription vision",
    evidence_selection: t.selection,
    intent_routing: t.routing,
    translation: t.translation,
    transcription: t.transcription,
    speech_synthesis: t.speech,
    printed_text_recognition: t.serverOcrTask,
  };
  return (
    <section aria-labelledby="engines-title" className="engine-workspace">
      <div className="workspace-heading">
        <span className="eyebrow">{t.engines}</span>
        <h1 id="engines-title">{t.modelTitle}</h1>
        <p>{t.modelBody}</p>
      </div>
      <ModelChoice runtime={runtime} />
      <DeviceProcessing
        locale={locale}
        mode={mode}
        onChange={onModeChange}
        runtime={runtime}
      />
      <div className="runtime-toolbar">
        <p role="status">
          {failed
            ? t.unavailable
            : runtime?.checked_at
              ? `${t.observed}: ${new Date(runtime.checked_at).toLocaleTimeString()}`
              : t.refreshing}
        </p>
        <button
          type="button"
          className="btn-secondary"
          onClick={onRefresh}
          disabled={loading}
        >
          {loading ? t.refreshing : t.refresh}
        </button>
      </div>
      <div className="engine-grid">
        {runtime?.engines.map((engine) => (
          <article key={engine.id} className="engine-card">
            <div className="engine-card-top">
              <WorkspaceIcon name="engines" />
              <span className={`engine-state state-${engine.state}`}>
                {labels[engine.state]}
              </span>
            </div>
            <h2>{engine.name}</h2>
            <p>{tasks[engine.task]}</p>
            <div className="engine-meta-specs">
              <div className="spec-row">
                <span className="spec-label">Host:</span>
                <span className="spec-value">
                  {locations[engine.id] || "Server worker"}
                </span>
              </div>
              <div className="spec-row">
                <span className="spec-label">Scope:</span>
                <span className="spec-value">
                  {engineLanguages[engine.id] || "Multilingual"}
                </span>
              </div>
            </div>
            <strong>
              {engine.loaded === true
                ? t.loaded
                : engine.loaded === false && engine.state === "ready"
                  ? t.idle
                  : t.unknown}
            </strong>
            {engine.memory_bytes != null && (
              <p>
                {t.allocation}: {(engine.memory_bytes / 1048576).toFixed(1)} MiB
                {engine.context_tokens != null &&
                  ` · ${engine.context_tokens} ctx`}
              </p>
            )}
            <details>
              <summary>{t.revision}</summary>
              <code>{engine.revision || "—"}</code>
              <p>{engine.reason}</p>
            </details>
          </article>
        ))}
        <article className="engine-card browser-engine">
          <div className="engine-card-top">
            <WorkspaceIcon name="image" />
            <span className="engine-state">
              {ocrAvailable === null
                ? t.refreshing
                : ocrAvailable
                  ? t.ready
                  : t.offline}
            </span>
          </div>
          <h2>{t.ocrTitle}</h2>
          <p>{t.ocrDetail}</p>
          <div className="engine-meta-specs">
            <div className="spec-row">
              <span className="spec-label">Host:</span>
              <span className="spec-value">
                Browser sandbox (WebAssembly/Worker)
              </span>
            </div>
            <div className="spec-row">
              <span className="spec-label">Scope:</span>
              <span className="spec-value">
                English &amp; Nepali printed text
              </span>
            </div>
          </div>
          <strong>Tesseract.js 7.0.0</strong>
        </article>
      </div>

      {/* Operator Controls Section (FE-N4) */}
      <section
        className="operator-controls-section"
        aria-labelledby="operator-title"
      >
        <div className="operator-head">
          <h2 id="operator-title">🔐 Operator Model Controls</h2>
          <span className="operator-role-badge">Administrator Only</span>
        </div>
        <p className="operator-desc">
          Authenticated administrators can warm or unload pinned inference
          models. Operator tokens are kept in memory only and never saved to
          persistent storage.
        </p>

        <div className="operator-token-row">
          <input
            type="password"
            className="operator-token-input"
            value={operatorToken}
            onChange={(e) => setOperatorToken(e.target.value)}
            placeholder="Enter administrator token from registry"
            autoComplete="off"
            aria-label="Administrator token"
          />
        </div>

        {opMessage && (
          <div className="op-success-alert" role="status">
            {opMessage}
          </div>
        )}
        {opError && (
          <div className="op-error-alert" role="alert">
            {opError}
          </div>
        )}

        <div className="operator-actions-grid">
          {qwenEngine && (
            <div className="operator-action-card">
              <div className="op-card-head">
                <strong>{qwenEngine.name}</strong>
                <span className={`engine-state state-${qwenEngine.state}`}>
                  {labels[qwenEngine.state]}
                </span>
              </div>
              <small className="op-revision">
                Target Pin:{" "}
                <code>
                  {qwenEngine.revision
                    ? `${qwenEngine.revision.slice(0, 16)}…`
                    : "Unconfigured"}
                </code>
              </small>
              <div className="op-btn-row">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={
                    opBusy || !operatorToken.trim() || !qwenEngine.revision
                  }
                  onClick={() =>
                    qwenEngine.revision &&
                    handleModelAction("warm", qwenEngine.revision)
                  }
                >
                  {opBusy ? "Applying..." : "🔥 Warm Model"}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={
                    opBusy || !operatorToken.trim() || !qwenEngine.revision
                  }
                  onClick={() =>
                    qwenEngine.revision &&
                    handleModelAction("unload", qwenEngine.revision)
                  }
                >
                  {opBusy ? "Applying..." : "❄️ Unload Model"}
                </button>
              </div>
            </div>
          )}
        </div>
      </section>
      {runtime && (
        <div className="knowledge-meter">
          <div>
            <strong>{runtime.reviewed_sources}</strong>
            <span>{t.sources}</span>
          </div>
          <div>
            <strong>{runtime.reviewed_questions}</strong>
            <span>{t.questions}</span>
          </div>
        </div>
      )}
      <p className="local-work-note">
        <WorkspaceIcon name="privacy" size={20} />
        {t.boundary}
      </p>
    </section>
  );
}
