"use client";

import type {
  ArogyaResponse,
  HistoryMessage,
  MedicineRecord,
} from "@arogya/contracts";
import { useEffect, useRef, useState } from "react";
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
import { createRequestId } from "@/lib/api";
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
  const [photoMethod, setPhotoMethod] = useState<"printed_ocr" | "vision">(
    "printed_ocr",
  );
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

  useEffect(() => {
    if (initialQuery) {
      setLabelText(initialQuery);
      setLabelChecked(true);
    }
  }, [initialQuery, setLabelText]);

  async function handleMedicinePhoto(photoFile?: File) {
    if (!photoFile) return;
    try {
      validateImageFile(photoFile);
      setMedicinePhoto(photoFile);
      setReadingPhoto(true);
      setError(null);
      setLabelText("");
      setCandidates(null);
      setActiveMedicine(null);
      setLabelChecked(false);
      if (processingLocation === "device") {
        await localOcr.read(await prepareImage(photoFile, 0), "eng+nep");
        return;
      }

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
            method: photoMethod,
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
        if (!label?.original_text?.trim())
          throw new Error(
            "No readable label found. Try a clearer photo, use visual reading, or type the label below.",
          );
        setLabelText(label.original_text);
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
      const matched = label?.medicine_candidates || [];
      setCandidates(matched);
      if (matched[0]) {
        await handleSelectMedicineCandidate(matched[0]);
      }
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
      const wording = labelText || med.canonical_name;
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

      // Automatically explain what this medicine does
      const questionText = ne
        ? `${med.canonical_name} केका लागि प्रयोग गरिन्छ र यसले के काम गर्छ?`
        : `What does ${med.canonical_name} do and what is it used for?`;
      await handleAskMedicineFollowUp(questionText, med);
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

  async function handleAskMedicineFollowUp(
    promptText?: string,
    targetMed?: MedicineRecord,
  ) {
    const med = targetMed || activeMedicine;
    const q = (promptText || medicineFollowUp).trim();
    if (!q || !med || asking) return;

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
        text: `[Medicine: ${med.canonical_name}] ${q}`,
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
    <section className="medicine-view" aria-labelledby="workspace-title">
      {/* Hidden file pickers */}
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

      {/* Top Status & Conversation Bar */}
      <div className="medicine-top-bar">
        <p className="storage-note" role="status">
          {conversation.error ||
            (conversation.loading
              ? "Processing on the server…"
              : ne
                ? "जाँचिएको लेबल र कुराकानी यस उपकरणमा सुरक्षित हुन्छ।"
                : "Reviewed labels and dialogue are saved on this device. Continuing sends that context to the server.")}
        </p>
        <div className="medicine-top-actions">
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
        </div>
      </div>

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

      {answerSpeech.error && <p role="alert">{answerSpeech.error}</p>}
      {answerSpeech.busy && <p role="status">Preparing Nepali speech…</p>}
      {recorder.error && <p role="alert">{recorder.error}</p>}
      {localOcr.error && <p role="alert">{localOcr.error}</p>}

      {/* Main Intake Cards Container */}
      <div className="medicine-intake-container">
        {/* Card 1: Read from Packaging Photo */}
        <div className="medicine-card medicine-card-photo">
          <div className="medicine-card-header">
            <h3>
              📷{" "}
              {ne
                ? "प्याकेजिङको तस्बिरबाट औषधि पहिचान"
                : "Identify Medicine from Packaging Photo"}
            </h3>
            <p>
              {ne
                ? "औषधिको बट्टा, स्ट्रिप वा बोतलको फोटो खिच्नुहोस् वा अपलोड गर्नुहोस्। यसले औषधि पहिचान गरी यसको काम र असर बताउनेछ।"
                : "Take a photo or upload an image of the medicine box, blister pack, or label to identify it and learn what it does."}
            </p>
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
          </div>

          {/* Photo Preview Box (shows selected photo) */}
          {photoPreview && (
            <div className="medicine-photo-preview-box">
              {/* biome-ignore lint/performance/noImgElement: Blob preview must stay in browser */}
              <img
                src={photoPreview}
                alt="Medicine packaging preview"
                className="medicine-photo-thumb"
              />
              <div className="medicine-photo-meta">
                <span className="medicine-photo-filename">
                  {medicinePhoto?.name || "medicine-packaging.jpg"}
                </span>
                {readingPhoto ? (
                  <span className="reading-label">
                    🔍 {ne ? "तस्बिरबाट पाठ पढ्दै..." : "Reading text on label..."}
                  </span>
                ) : (
                  <button
                    type="button"
                    className="text-button remove-photo-btn"
                    onClick={() => {
                      setMedicinePhoto(null);
                      setPhotoPreview(null);
                    }}
                  >
                    {ne ? "तस्बिर हटाउनुहोस्" : "Remove photo"}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Reading Actions (Triggered when medicinePhoto exists) */}
          {medicinePhoto && (
            <div className="recognition-action">
              {processingLocation !== "device" && (
                <label className="method-select-label">
                  <span>{ne ? "लेबल पढ्ने तरिका:" : "Label reading method:"}</span>
                  <select
                    value={photoMethod}
                    disabled={readingPhoto || conversation.loading}
                    onChange={(event) =>
                      setPhotoMethod(
                        event.target.value as "printed_ocr" | "vision",
                      )
                    }
                  >
                    <option value="printed_ocr">
                      {ne ? "छापिएको लेबल — छिटो" : "Printed label — fast"}
                    </option>
                    <option value="vision">
                      {ne
                        ? "दृश्य पढाइ — ढिलो हुन सक्छ"
                        : "Visual reading — may take longer"}
                    </option>
                  </select>
                </label>
              )}
              <p className="recognition-action-hint">
                {processingLocation === "device"
                  ? ne
                    ? "तस्बिर यस उपकरणमा पढिन्छ (पूर्ण गोपनीयता)।"
                    : "Read this label on your device (100% on-device)."
                  : ne
                    ? "अनुमति दिएपछि तस्बिर सुरक्षित रूपमा सर्भरमा पठाइन्छ।"
                    : "Allow reading to send this photo to the processing server."}
              </p>
              <button
                type="button"
                className="btn btn-primary btn-read-action"
                disabled={readingPhoto || conversation.loading}
                onClick={() => void handleMedicinePhoto(medicinePhoto)}
              >
                {ne ? "अनुमति दिनुहोस् र लेबल पढ्नुहोस्" : "Allow and read label"}
              </button>
            </div>
          )}

          {readingPhoto && (
            <p role="status" className="reading-status-banner">
              {processingLocation === "device"
                ? `Reading label on this device… ${localOcr.progress}%`
                : photoMethod === "printed_ocr"
                  ? "Reading printed label…"
                  : "Reading with the visual model. This may take up to 3 minutes…"}
            </p>
          )}
          {readingPhoto && processingLocation === "device" && (
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => localOcr.reset()}
            >
              {ne ? "रोक्नुहोस्" : "Cancel reading"}
            </button>
          )}

          {/* Review Box for Extracted or Typed Label Text */}
          <div className="medicine-review-card">
            <label
              htmlFor="medicine-label-review"
              className="review-card-title"
            >
              {ne
                ? "मात्रा र एकाइसहित पूरा लेबल जाँच्नुहोस्"
                : "Review the complete label, including strengths and units"}
            </label>
            <p className="review-card-desc">
              {ne
                ? "फोटोबाट आएको पाठ वा बट्टामा लेखिएको विवरण यहाँ रुजु गर्नुहोस्:"
                : "Verify the extracted text from the photo or enter wording manually:"}
            </p>
            <textarea
              id="medicine-label-review"
              value={labelText}
              placeholder={
                ne
                  ? "लेबलको पाठ यहाँ लेख्नुहोस्"
                  : "Read a photo above or type the label here"
              }
              maxLength={8000}
              disabled={conversation.loading}
              onChange={(event) => {
                setLabelText(event.target.value);
                setLabelChecked(false);
                setActiveMedicine(null);
              }}
            />
            {/* Dedicated flex footer row: checkbox on left, button on right */}
            <div className="medicine-review-footer">
              <label className="medicine-checkbox-label">
                <input
                  type="checkbox"
                  checked={labelChecked}
                  onChange={(event) => setLabelChecked(event.target.checked)}
                />
                <span>
                  {ne
                    ? "मैले यो पाठ प्याकेटसँग जाँचेँ"
                    : "I checked this label against the package"}
                </span>
              </label>
              <button
                type="button"
                className="btn btn-primary btn-find-matches"
                disabled={
                  !labelText.trim() ||
                  !labelChecked ||
                  conversation.loading ||
                  readingPhoto
                }
                onClick={() => void handleReviewLabel()}
              >
                {ne
                  ? "जाँचिएको लेबलसँग मिल्ने औषधि खोज्नुहोस्"
                  : "Find matches for reviewed label"}
              </button>
            </div>
          </div>
        </div>
      </div>

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
                No match was found in the reviewed medicine catalog for &quot;
                {labelText}&quot;. The catalog may not yet include this
                medicine. Check the name with a licensed pharmacist.
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
                        ? ne
                          ? "✓ विवरण देखाइएको छ"
                          : "✓ Showing what this medicine does"
                        : ne
                          ? `💊 ${med.canonical_name} को विवरण हेर्नुहोस्`
                          : `💊 Show what ${med.canonical_name} does`}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      )}

      {/* What this medicine does section */}
      {activeMedicine && (
        <section
          className="medicine-conversation-session"
          aria-labelledby="med-convo-heading"
        >
          <div className="active-medicine-header-bar">
            <h3 id="med-convo-heading">
              💊{" "}
              {ne
                ? `${activeMedicine.canonical_name} को काम र प्रयोग`
                : `What ${activeMedicine.canonical_name} Does`}
            </h3>
            <button
              type="button"
              className="text-button"
              onClick={() => setActiveMedicine(null)}
            >
              ✕ {ne ? "हटाउनुहोस्" : "Clear selection"}
            </button>
          </div>

          <div className="medicine-summary-card">
            <div className="medicine-quick-info">
              <span className="medicine-badge-active">
                {activeMedicine.canonical_name}
              </span>
              <span className="medicine-ingredients-tag">
                <strong>{text.activeIngredients}:</strong>{" "}
                {activeMedicine.active_ingredients.join(", ")}
              </span>
            </div>
          </div>

          {asking && (
            <div className="medicine-analyzing-banner" role="status">
              <span className="spinner-icon">⏳</span>
              <span>
                {ne
                  ? `${activeMedicine.canonical_name} को प्रयोग र असर विश्लेषण गर्दै...`
                  : `Analyzing what ${activeMedicine.canonical_name} does...`}
              </span>
            </div>
          )}

          {/* Render what it does responses */}
          {followUpResponses.length > 0 && (
            <div className="medicine-responses-list">
              {followUpResponses.map((item) => (
                <article key={item.id} className="medicine-response-card">
                  <div className="response-card-header">
                    <h4 className="medicine-qa-title">{item.question}</h4>
                    {item.response && (
                      <StatusBadge
                        status={item.response.status}
                        locale={locale}
                      />
                    )}
                  </div>
                  <div className="medicine-explanation-body">
                    <p className="assistant-a-text">{item.text}</p>
                  </div>
                  <div className="medicine-audio-actions">
                    <button
                      type="button"
                      className="btn btn-sm btn-outline btn-listen-nepali"
                      disabled={answerSpeech.busy}
                      onClick={() => void handlePlayNepaliSpeech(item.text)}
                    >
                      🔊{" "}
                      {answerSpeech.busy
                        ? ne
                          ? "तयार हुँदैछ..."
                          : "Preparing audio..."
                        : ne
                          ? "नेपालीमा सुन्नुहोस्"
                          : "Listen in Nepali"}
                    </button>
                  </div>
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

          {/* Quick prompts */}
          <div className="medicine-prompts-row">
            {[
              ne
                ? `${activeMedicine.canonical_name} को सावधानी वा साइड इफेक्ट के हुन्?`
                : `What are warnings or contraindications for ${activeMedicine.canonical_name}?`,
              ne
                ? `${activeMedicine.canonical_name} को सही मात्रा के हो?`
                : `What is the usual dosage for ${activeMedicine.canonical_name}?`,
            ].map((promptText) => (
              <button
                key={promptText}
                type="button"
                className="suggestion-pill"
                disabled={asking}
                onClick={() => void handleAskMedicineFollowUp(promptText)}
              >
                {promptText}
              </button>
            ))}
          </div>

          {/* Composer Form */}
          <form
            className="medicine-composer-form"
            onSubmit={(e) => {
              e.preventDefault();
              void handleAskMedicineFollowUp();
            }}
          >
            <div className="input-group">
              <input
                type="text"
                className="medicine-composer-input"
                value={medicineFollowUp}
                onChange={(e) => setMedicineFollowUp(e.target.value)}
                placeholder={
                  ne
                    ? `${activeMedicine.canonical_name} बारे थप प्रश्न सोध्नुहोस्...`
                    : `Ask another question about ${activeMedicine.canonical_name}...`
                }
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
