"use client";

import type {
  ArogyaResponse,
  HistoryMessage,
  MedicineRecord,
} from "@arogya/contracts";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useSession } from "@/context/SessionContext";
import { useConversation } from "@/features/conversations/ConversationContext";
import { useAnswerSpeech } from "@/features/conversations/use-answer-speech";
import { useDraft } from "@/features/conversations/use-draft";
import { useLocalOcr } from "@/features/documents/hooks/use-local-ocr";
import {
  prepareImage,
  validateImageFile,
} from "@/features/documents/lib/image-file";
import { useHistory } from "@/features/history/HistoryContext";
import { turnUserMessageId } from "@/features/history/turn-message-id";
import type { ProcessingLocation } from "@/features/settings/device-specs";
import { useModel } from "@/features/settings/ModelContext";
import { useRecorder } from "@/features/speech/hooks/use-recorder";
import { audioBase64 } from "@/features/speech/lib/audio";
import { createRequestId, resolveMedicine } from "@/lib/api";
import { copy } from "@/lib/copy";
import { stableTextEntries } from "@/lib/list-keys";

interface MedicineViewProps {
  processingLocation: ProcessingLocation;
  locale: "en" | "ne" | "tam";
  initialQuery?: string | null;
  onSelectMedicine?: (medicine: MedicineRecord) => void;
  onSelectSource?: (sourceId: string) => void;
  onBackToImage?: () => void;
}

export function MedicineView({
  locale,
  processingLocation,
  initialQuery,
  onSelectMedicine,
  onSelectSource,
  onBackToImage,
}: MedicineViewProps) {
  const ne = locale === "ne";
  const text = copy[ne ? "ne" : "en"];
  const session = useSession();
  const history = useHistory();
  const conversation = useConversation();
  const answerSpeech = useAnswerSpeech("medicine");
  const savedSnapshot = conversation.snapshots[history.currentId];
  const snapshot =
    savedSnapshot?.mode === "medicine" ? savedSnapshot : undefined;
  const attachment = snapshot?.attachments?.find(
    (item) => item.id === snapshot.active_attachment_id,
  );
  const [labelText, setLabelText, hasDraft] = useDraft("medicine-label", "");
  const [labelChecked, setLabelChecked] = useState(false);
  const { model } = useModel();
  const recorder = useRecorder();
  const localOcr = useLocalOcr();

  const [query, setQuery] = useDraft<string>(
    "medicine-query",
    initialQuery || "",
  );
  const [searching, setSearching] = useState<boolean>(false);
  const [candidates, setCandidates] = useState<MedicineRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Active medicine in-session context
  const [activeMedicine, setActiveMedicine] = useState<MedicineRecord | null>(
    null,
  );
  const [medicineFollowUp, setMedicineFollowUp] = useDraft(
    "medicine-question",
    "",
  );
  const [asking, setAsking] = useState(false);
  const [followUpResponses, setFollowUpResponses] = useState<
    { id: string; question: string; response?: ArogyaResponse; text: string }[]
  >([]);

  // Photo of medicine packaging/blister
  const [medicinePhoto, setMedicinePhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [readingPhoto, setReadingPhoto] = useState(false);
  const photoPicker = useRef<HTMLInputElement>(null);
  const cameraPicker = useRef<HTMLInputElement>(null);

  // Audio / Speech states
  const [transcribingVoice, setTranscribingVoice] = useState(false);

  useEffect(() => {
    if (!medicinePhoto) {
      setPhotoPreview(null);
      return;
    }
    const url = URL.createObjectURL(medicinePhoto);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [medicinePhoto]);

  useEffect(() => {
    if (localOcr.draft) setLabelText(localOcr.draft);
  }, [localOcr.draft, setLabelText]);

  const searchBusy = useRef(false);
  const executeSearch = useCallback(async (targetQuery: string) => {
    const q = targetQuery.trim();
    if (!q || searchBusy.current) return;
    searchBusy.current = true;

    setSearching(true);
    setError(null);
    try {
      const result = await resolveMedicine(q);
      setCandidates(result.candidates || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
      setCandidates(null);
    } finally {
      searchBusy.current = false;
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    if (initialQuery) {
      setQuery(initialQuery);
      void executeSearch(initialQuery);
    }
  }, [initialQuery, executeSearch, setQuery]);

  async function handleSearch(e?: React.FormEvent) {
    if (e) e.preventDefault();
    await executeSearch(query);
  }

  async function handleMedicinePhoto(photoFile?: File) {
    if (!photoFile) return;
    try {
      validateImageFile(photoFile);
      setMedicinePhoto(photoFile);
      setReadingPhoto(true);
      if (processingLocation === "device") {
        await localOcr.read(await prepareImage(photoFile, 0), "eng+nep");
        return;
      }
      setError(null);

      let currentToken = session.token;
      if (!currentToken || session.isExpired) {
        currentToken = await session.initSession();
      }
      if (!currentToken) {
        setError("Could not connect to session.");
        setReadingPhoto(false);
        return;
      }

      const grant = await session.grantProcessing("image_transcription");
      const consent = grant?.consent;

      if (consent) {
        const bytes = new Uint8Array(await photoFile.arrayBuffer());
        let binary = "";
        for (let offset = 0; offset < bytes.length; offset += 32768)
          binary += String.fromCharCode(
            ...bytes.subarray(offset, offset + 32768),
          );
        const result = await conversation.recognize(
          "medicine",
          ne ? "ne" : "en",
          {
            kind: "medicine",
            method: "vision",
            image: {
              image_base64: btoa(binary),
              language: "eng+nep",
              rotation: 0,
              consent_id: consent.id,
              model_profile: model,
            },
          },
        );
        const label = result.attachments?.find(
          (item) => item.id === result.active_attachment_id,
        );
        setLabelText(label?.original_text || "");
        setQuery("");
        setCandidates(null);
        setActiveMedicine(null);
        setLabelChecked(false);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to read medicine photo.",
      );
    } finally {
      setReadingPhoto(false);
    }
  }

  async function handleReviewLabel() {
    try {
      const grant = await session.grantProcessing("document_explanation");
      if (!grant) throw new Error("Label review permission was not granted.");
      const current = await conversation.ensure("medicine", ne ? "ne" : "en");
      if (!current.snapshot.active_attachment_id)
        await conversation.text(
          "medicine",
          ne ? "ne" : "en",
          labelText,
          "medicine",
          grant.consent.id,
        );
      const reviewed = await conversation.review(
        "medicine",
        ne ? "ne" : "en",
        labelText,
        grant.consent.id,
      );
      const label = reviewed.attachments?.find(
        (item) => item.id === reviewed.active_attachment_id,
      );
      setCandidates(label?.medicine_candidates || []);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Label review failed.",
      );
    }
  }
  async function handleSelectMedicineCandidate(med: MedicineRecord) {
    setError(null);
    try {
      const grant = await session.grantProcessing("document_explanation");
      if (!grant) throw new Error("Label review permission was not granted.");
      const current = (await conversation.ensure("medicine", ne ? "ne" : "en"))
        .snapshot;
      const currentLabel = current.attachments?.find(
        (item) => item.id === current.active_attachment_id,
      );
      const wording = labelText || query;
      if (!currentLabel)
        await conversation.text(
          "medicine",
          ne ? "ne" : "en",
          wording,
          "medicine",
          grant.consent.id,
        );
      await conversation.review(
        "medicine",
        ne ? "ne" : "en",
        wording,
        grant.consent.id,
        med.id,
      );
      setActiveMedicine(med);
      if (onSelectMedicine) onSelectMedicine(med);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not confirm this medicine.",
      );
    }
  }
  useEffect(() => {
    if (attachment && !hasDraft) {
      setLabelText(attachment.reviewed_text || attachment.original_text);
      setLabelChecked(Boolean(attachment.reviewed_text));
      setCandidates(attachment.medicine_candidates || []);
      setActiveMedicine(attachment.selected_medicine || null);
    }
    if (snapshot)
      setFollowUpResponses(
        (snapshot.turns || []).map((turn) => ({
          id: turn.id,
          question: turn.message,
          response: turn.health || undefined,
          text: turn.answer,
        })),
      );
  }, [attachment, snapshot, hasDraft, setLabelText]);

  async function handleAskMedicineFollowUp(promptText?: string) {
    const q = (promptText || medicineFollowUp).trim();
    if (!q || !activeMedicine || asking) return;

    setAsking(true);

    try {
      let currentToken = session.token;
      if (!currentToken || session.isExpired) {
        currentToken = await session.initSession();
      }
      if (!currentToken) {
        setAsking(false);
        return;
      }

      const consent = await session.grantConsent();
      if (!consent) {
        setAsking(false);
        return;
      }

      const convId = history.currentId;
      const userMsgId = createRequestId();
      const userMsg: HistoryMessage = {
        id: userMsgId,
        sender: "user",
        text: `[Medicine: ${activeMedicine.canonical_name}] ${q}`,
        timestamp: new Date().toISOString(),
      };

      const turn = await conversation.turn(
        "medicine",
        ne ? "ne" : "en",
        q,
        consent.id,
        model,
      );
      setMedicineFollowUp("");
      await history.append(
        convId,
        { ...userMsg, id: await turnUserMessageId(turn.id) },
        ne ? "ne" : "en",
      );
      const res = turn.health;
      if (!res) throw new Error("Medicine answer was not returned.");

      const assistantMsg: HistoryMessage = {
        id: turn.id,
        sender: "assistant",
        text: res.answer,
        response: res,
        timestamp: new Date().toISOString(),
      };
      await history.append(convId, assistantMsg, locale === "ne" ? "ne" : "en");
    } catch (err) {
      const errText =
        err instanceof Error ? err.message : "Failed to get medicine response.";
      setFollowUpResponses((prev) => [
        ...prev,
        { id: createRequestId(), question: q, text: errText },
      ]);
    } finally {
      setAsking(false);
    }
  }

  async function handleTranscribeVoice() {
    if (!recorder.clip) return;
    setTranscribingVoice(true);

    let currentToken = session.token;
    if (!currentToken) currentToken = await session.initSession();
    if (!currentToken) {
      setTranscribingVoice(false);
      return;
    }

    const grant = await session.grantProcessing("speech_transcription");
    const consent = grant?.consent;

    if (!consent) {
      setTranscribingVoice(false);
      return;
    }

    try {
      const b64 = await audioBase64(recorder.clip);
      const result = await conversation.transcribe(
        "medicine",
        ne ? "ne" : "en",
        { audio_base64: b64, language: "ne", consent_id: consent.id },
      );
      setMedicineFollowUp(result.transcription.text);
      recorder.clear();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Voice transcription failed.",
      );
    } finally {
      setTranscribingVoice(false);
    }
  }

  async function handlePlayNepaliSpeech(textToRead: string) {
    const current = (await conversation.ensure("medicine", "ne")).snapshot;
    const turn = current.turns?.findLast(
      (item) => item.language === "ne" && item.answer === textToRead,
    );
    if (turn) await answerSpeech.play(turn.id);
    else setError("Request a fresh Nepali answer before listening.");
  }

  return (
    <section className="medicine-view" aria-labelledby="medicine-title">
      <header className="medicine-header">
        <h1 id="medicine-title">{text.medicineTitle}</h1>
        <p className="medicine-subtitle">{text.medicineSubtitle}</p>
      </header>
      <p className="storage-note" role="status">
        {conversation.error ||
          (conversation.loading
            ? "Processing on the server…"
            : ne
              ? "जाँचिएको लेबल र कुराकानी यस उपकरणमा सुरक्षित हुन्छ।"
              : "Reviewed labels and dialogue are saved on this device. Continuing sends that context to the server.")}
      </p>
      {conversation.loading && (
        <button
          type="button"
          className="btn btn-outline"
          onClick={() =>
            void conversation
              .cancel()
              .catch((failure) => setError(String(failure)))
          }
        >
          {ne ? "रोक्नुहोस्" : "Cancel processing"}
        </button>
      )}
      <button
        type="button"
        className="btn btn-outline"
        disabled={conversation.loading || asking}
        onClick={() => {
          history.newChat();
          setLabelText("");
          setActiveMedicine(null);
          setCandidates(null);
          setFollowUpResponses([]);
        }}
      >
        {ne ? "नयाँ औषधि कुराकानी" : "New medicine conversation"}
      </button>
      {medicinePhoto && (
        <div className="recognition-action">
          <p>
            {processingLocation === "device"
              ? ne
                ? "तस्बिर यस उपकरणमा पढिन्छ।"
                : "Read this label on your device."
              : ne
                ? "अनुमति दिएपछि तस्बिर सर्भरमा पठाइन्छ।"
                : "Allow reading to send this photo to the processing server."}
          </p>
          <button
            type="button"
            disabled={readingPhoto || conversation.loading}
            onClick={() => void handleMedicinePhoto(medicinePhoto)}
          >
            {ne ? "अनुमति दिनुहोस् र लेबल पढ्नुहोस्" : "Allow and read label"}
          </button>
        </div>
      )}
      {recorder.error && <p role="alert">{recorder.error}</p>}
      {localOcr.error && <p role="alert">{localOcr.error}</p>}
      {labelText && (
        <div className="notice notice-info">
          <label htmlFor="medicine-label-review">
            {ne
              ? "मात्रा र एकाइसहित पूरा लेबल जाँच्नुहोस्"
              : "Review the complete label, including strengths and units"}
          </label>
          <textarea
            id="medicine-label-review"
            value={labelText}
            maxLength={8000}
            disabled={conversation.loading}
            onChange={(event) => {
              setLabelText(event.target.value);
              setLabelChecked(false);
              setActiveMedicine(null);
            }}
          />
          <label>
            <input
              type="checkbox"
              checked={labelChecked}
              onChange={(event) => setLabelChecked(event.target.checked)}
            />{" "}
            {ne
              ? "मैले यो पाठ प्याकेटसँग जाँचेँ"
              : "I checked this label against the package"}
          </label>
          <button
            type="button"
            className="btn"
            disabled={!labelChecked || conversation.loading}
            onClick={() => void handleReviewLabel()}
          >
            {ne
              ? "जाँचिएको लेबलसँग मिल्ने औषधि खोज्नुहोस्"
              : "Find matches for reviewed label"}
          </button>
        </div>
      )}
      {answerSpeech.error && <p role="alert">{answerSpeech.error}</p>}
      {answerSpeech.busy && <p role="status">Preparing Nepali speech…</p>}

      {/* Transfer Context from Document OCR */}
      {initialQuery && onBackToImage && (
        <div className="medicine-ocr-context-banner" role="status">
          <span>
            📄 Query transferred from document comparison:{" "}
            <strong>&quot;{initialQuery}&quot;</strong>
          </span>
          <button
            type="button"
            className="btn-back-to-image text-button"
            onClick={onBackToImage}
          >
            ← Return to image inspection
          </button>
        </div>
      )}

      {/* Mandatory Clinical Safety Warning Banner */}
      <div className="medicine-warning-banner" role="alert">
        <span className="warning-icon" aria-hidden="true">
          ⚠️
        </span>
        <div>
          <strong>
            {ne
              ? "सम्भावित मिलान — पहिचान पुष्टि भएको छैन"
              : "Possible matches — identity needs checking"}
          </strong>
          <p>{text.medicineWarning}</p>
        </div>
      </div>

      {/* Photo Capture & Upload Row */}
      <div className="medicine-photo-actions-row">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => cameraPicker.current?.click()}
          disabled={readingPhoto}
        >
          📷 {ne ? "प्याकेजिङको फोटो खिच्नुहोस्" : "Take medicine photo"}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => photoPicker.current?.click()}
          disabled={readingPhoto}
        >
          📁 {ne ? "लेबल तस्बिर छान्नुहोस्" : "Upload label/packaging image"}
        </button>
        <input
          ref={cameraPicker}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          hidden
          onChange={(e) => setMedicinePhoto(e.target.files?.[0] || null)}
        />
        <input
          ref={photoPicker}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          onChange={(e) => setMedicinePhoto(e.target.files?.[0] || null)}
        />
      </div>

      {photoPreview && (
        <div className="medicine-photo-preview-box">
          {/* biome-ignore lint/performance/noImgElement: Blob preview must stay in browser */}
          <img
            src={photoPreview}
            alt="Medicine packaging preview"
            className="medicine-photo-thumb"
          />
          {readingPhoto ? (
            <p className="reading-label">
              🔍 {ne ? "तस्बिरबाट पाठ पढ्दै..." : "Reading text on label..."}
            </p>
          ) : (
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setMedicinePhoto(null);
                setPhotoPreview(null);
              }}
            >
              {ne ? "तस्बिर हटाउनुहोस्" : "Remove photo"}
            </button>
          )}
        </div>
      )}

      {/* Search Input */}
      <form className="medicine-search-form" onSubmit={handleSearch}>
        <div className="input-group">
          <label htmlFor="medicine-search">
            {ne ? "औषधिको नाम वा लेबल" : "Medicine name or label"}
          </label>
          <input
            id="medicine-search"
            type="text"
            className="medicine-input"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLabelText("");
              setActiveMedicine(null);
            }}
            placeholder={text.medicineSearchPlaceholder}
            disabled={searching || readingPhoto}
            aria-label={text.medicineSearchPlaceholder}
          />
          {query.length > 0 && (
            <button
              type="button"
              className="btn-clear-query"
              onClick={() => {
                setQuery("");
                setCandidates(null);
              }}
              aria-label="Clear medicine search"
            >
              ✕
            </button>
          )}
          <button
            type="submit"
            className="btn btn-primary"
            disabled={searching || !query.trim()}
          >
            {searching ? text.medicineSearching : text.medicineLookupBtn}
          </button>
        </div>
      </form>

      <p className="medicine-sharing-note">
        Search query checks verified medicine candidates in Nepal. Candidate
        matches are unverified and require pharmacist confirmation.
      </p>

      {error && (
        <div className="error-alert" role="alert">
          {error}
        </div>
      )}

      {/* Results List */}
      {candidates !== null && (
        <div className="candidates-container" aria-live="polite">
          {candidates.length === 0 ? (
            <div className="no-candidates-card">
              <h3>{text.noMedicineFound}</h3>
              <p>
                No approved medicine matched &quot;{query}&quot;. Try searching
                by its generic active ingredient, or verify with a licensed
                pharmacist.
              </p>
              <div className="no-candidates-actions">
                {onBackToImage && initialQuery && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={onBackToImage}
                  >
                    📄 Return to document comparison
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="candidates-grid">
              {candidates.map((med) => (
                <article
                  key={med.id}
                  className={`candidate-card ${activeMedicine?.id === med.id ? "candidate-card-selected" : ""}`}
                >
                  <div className="candidate-top">
                    <h3 className="candidate-name">{med.canonical_name}</h3>
                    <span className="jurisdiction-badge">
                      {text.jurisdiction}: {med.jurisdiction}
                    </span>
                  </div>

                  <div className="candidate-body">
                    <div className="candidate-field">
                      <strong>{text.activeIngredients}:</strong>
                      <ul className="ingredient-list">
                        {stableTextEntries(med.active_ingredients).map(
                          ({ text: ing, key }) => (
                            <li key={key}>{ing}</li>
                          ),
                        )}
                      </ul>
                    </div>

                    {med.aliases.length > 0 && (
                      <div className="candidate-field">
                        <strong>{text.aliases}:</strong>
                        <div className="alias-tags">
                          {med.aliases.map((alias) => (
                            <span key={alias} className="alias-tag">
                              {alias}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="candidate-sources">
                      <span className="source-label-text">
                        Reviewed clinical sources:
                      </span>
                      <div className="source-pills-list">
                        {med.source_ids.map((srcId) =>
                          onSelectSource ? (
                            <button
                              key={srcId}
                              type="button"
                              className="source-link-pill"
                              onClick={() => onSelectSource(srcId)}
                              title={`Open reviewed source ${srcId} in Library`}
                            >
                              📖 {srcId}
                            </button>
                          ) : (
                            <span key={srcId} className="source-link-pill">
                              📖 {srcId}
                            </span>
                          ),
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="candidate-actions">
                    <button
                      type="button"
                      className={`btn ${activeMedicine?.id === med.id ? "btn-primary" : "btn-outline"} btn-consult-medicine`}
                      disabled={
                        conversation.loading ||
                        Boolean(labelText && !labelChecked)
                      }
                      onClick={() => void handleSelectMedicineCandidate(med)}
                    >
                      {activeMedicine?.id === med.id
                        ? "✓ Selected for this session"
                        : `💊 Select ${med.canonical_name} & Ask Questions`}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      )}

      {/* In-Session Continuous Medicine Conversation */}
      {activeMedicine && (
        <section
          className="medicine-conversation-session"
          aria-labelledby="med-convo-heading"
        >
          <div className="active-medicine-header-bar">
            <h3 id="med-convo-heading">
              💬 Discussing: <strong>{activeMedicine.canonical_name}</strong>
            </h3>
            <button
              type="button"
              className="text-button"
              onClick={() => setActiveMedicine(null)}
            >
              ✕ Clear selection
            </button>
          </div>

          <div className="medicine-prompts-row">
            {[
              `What is ${activeMedicine.canonical_name} used for?`,
              `What are the warnings or contraindications for ${activeMedicine.canonical_name}?`,
              `What active ingredients are in this medicine?`,
            ].map((promptText) => (
              <button
                key={promptText}
                type="button"
                className="suggestion-pill"
                disabled={asking}
                onClick={() => handleAskMedicineFollowUp(promptText)}
              >
                {promptText}
              </button>
            ))}
          </div>

          {/* Render in-session responses */}
          {followUpResponses.length > 0 && (
            <div className="medicine-responses-list">
              {followUpResponses.map((item) => (
                <article key={item.id} className="medicine-response-card">
                  <p className="user-q-text">
                    <strong>Q:</strong> {item.question}
                  </p>
                  {item.response && (
                    <div className="response-badge-row">
                      <StatusBadge
                        status={item.response.status}
                        locale={locale}
                      />
                    </div>
                  )}
                  <p className="assistant-a-text">{item.text}</p>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline"
                    onClick={() => handlePlayNepaliSpeech(item.text)}
                  >
                    🔊 {ne ? "नेपालीमा सुन्नुहोस्" : "Listen in Nepali"}
                  </button>
                </article>
              ))}
            </div>
          )}

          {answerSpeech.url && (
            <div className="audio-playback-bar">
              {/* biome-ignore lint/a11y/useMediaCaption: Speech transcript is rendered in the message card. */}
              <audio
                controls
                autoPlay
                src={answerSpeech.url || undefined}
                onEnded={answerSpeech.next}
              />
            </div>
          )}

          {/* Composer Form */}
          <form
            className="medicine-composer-form"
            onSubmit={(e) => {
              e.preventDefault();
              handleAskMedicineFollowUp();
            }}
          >
            <div className="input-group">
              <input
                type="text"
                className="medicine-composer-input"
                value={medicineFollowUp}
                onChange={(e) => setMedicineFollowUp(e.target.value)}
                placeholder={`Ask about ${activeMedicine.canonical_name}...`}
                disabled={asking}
              />
              <button
                type="button"
                className={`btn btn-secondary btn-mic ${recorder.recording ? "recording-active" : ""}`}
                onClick={() => {
                  if (recorder.recording) {
                    recorder.stop();
                  } else if (recorder.clip) {
                    void handleTranscribeVoice();
                  } else {
                    void recorder.start();
                  }
                }}
              >
                {recorder.recording
                  ? `⏹ Stop (${recorder.elapsed}s)`
                  : recorder.clip
                    ? "📝 Transcribe clip"
                    : "🎙️ Speak"}
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={!medicineFollowUp.trim() || asking}
              >
                {asking ? "..." : ne ? "सोध्नुहोस्" : "Ask"}
              </button>
            </div>
          </form>

          {recorder.recording && (
            <p className="voice-status-note" role="status">
              🔴 {ne ? "नेपालीमा बोल्दै..." : "Listening in Nepali..."}
            </p>
          )}
          {transcribingVoice && (
            <p className="voice-status-note" role="status">
              ⏳ {ne ? "आवाज उतारिँदै..." : "Transcribing voice clip..."}
            </p>
          )}
        </section>
      )}
    </section>
  );
}
