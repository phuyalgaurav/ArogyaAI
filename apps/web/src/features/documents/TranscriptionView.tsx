"use client";

import type {
  DocumentExplainRequest,
  DocumentExplainResult,
  HistoryMessage,
  RuntimeStatus,
} from "@arogya/contracts";
import { useEffect, useRef, useState } from "react";
import { WorkspaceIcon } from "@/components/layout/WorkspaceIcon";
import { useSession } from "@/context/SessionContext";
import { useConversation } from "@/features/conversations/ConversationContext";
import { useAnswerSpeech } from "@/features/conversations/use-answer-speech";
import { useDraft } from "@/features/conversations/use-draft";
import { DocumentMedicines } from "@/features/documents/DocumentMedicines";
import { DocumentSpeech } from "@/features/documents/DocumentSpeech";
import { useLocalOcr } from "@/features/documents/hooks/use-local-ocr";
import {
  admissibleDocument,
  documentLines,
} from "@/features/documents/lib/document-text";
import {
  clampZoom,
  prepareImage,
  validateImageFile,
} from "@/features/documents/lib/image-file";
import { medicineNames } from "@/features/documents/lib/medicine-names";
import { useHistory } from "@/features/history/HistoryContext";
import { turnUserMessageId } from "@/features/history/turn-message-id";
import type { ProcessingLocation } from "@/features/settings/device-specs";
import { ModelChoice } from "@/features/settings/ModelChoice";
import { useModel } from "@/features/settings/ModelContext";
import { useSpeechInput } from "@/features/speech/hooks/use-speech-input";
import { createRequestId } from "@/lib/api";

interface TranscriptionViewProps {
  processingLocation: ProcessingLocation;
  locale: "en" | "ne" | "tam";
  runtime: RuntimeStatus | null;
  initialText?: string | null;
  onSelectSource?: (sourceId: string) => void;
}

export function TranscriptionView({
  locale,
  processingLocation,
  runtime,
  initialText,
  onSelectSource: _onSelectSource,
}: TranscriptionViewProps) {
  const ne = locale === "ne";
  const { model } = useModel();
  const session = useSession();
  const history = useHistory();
  const conversation = useConversation();
  const answerSpeech = useAnswerSpeech("document");
  const savedSnapshot = conversation.snapshots[history.currentId];
  const snapshot =
    savedSnapshot?.mode === "document" ? savedSnapshot : undefined;
  const activeAttachment = snapshot?.attachments?.find(
    (item) => item.id === snapshot.active_attachment_id,
  );
  // Mode and input states
  const [recognitionMethod, setRecognitionMethod] = useState<
    "vision" | "printed_ocr"
  >("vision");
  const [inputMode, setInputMode] = useDraft<"image" | "paste">(
    "input-mode",
    "image",
  );
  const [docKind, setDocKind] =
    useState<DocumentExplainRequest["kind"]>("prescription");
  const [explainLanguage, setExplainLanguage] = useState<"en" | "ne">(
    ne ? "ne" : "en",
  );

  // Follow-up Q&A
  const [question, setQuestion] = useDraft("document-question", "");
  const [answering, setAnswering] = useState(false);
  const [voiceInputReview, setVoiceInputReview] = useState<string | null>(null);

  const speech = useSpeechInput({
    language: explainLanguage,
    onTranscript: (spokenText) => {
      setQuestion(spokenText);
      setVoiceInputReview(spokenText);
    },
  });

  // Image states
  const [file, setFile] = useDraft<File | null>("document-file", null);
  const [preview, setPreview] = useState<string | null>(null);
  const [rotation, setRotation] = useDraft("document-rotation", 0);
  const [zoom, setZoom] = useState(1.0);
  const [fileError, setFileError] = useState<string | null>(null);
  const [pdfNotice, setPdfNotice] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Transcription & review states
  const [draftText, setDraftText, hasDraft] = useDraft(
    "document-text",
    initialText || "",
  );
  const [transcriptionChecked, setTranscriptionChecked] = useState(false);

  // Explanation states
  const [explaining, setExplaining] = useState(false);
  const [explanationResult, setExplanationResult] =
    useState<DocumentExplainResult | null>(null);
  const [explainError, setExplainError] = useState<string | null>(null);

  const pickerRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const photoRef = useRef<HTMLImageElement>(null);
  const currentSelection = useRef(0);

  const localOcr = useLocalOcr();

  useEffect(() => {
    setExplainLanguage(ne ? "ne" : "en");
  }, [ne]);

  // Image URL cleanup
  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    let live = true;
    let url: string | null = null;
    void prepareImage(file, rotation)
      .then(
        (canvas) =>
          new Promise<Blob>((resolve, reject) =>
            canvas.toBlob(
              (blob) =>
                blob ? resolve(blob) : reject(new Error("Preview unavailable")),
              "image/png",
            ),
          ),
      )
      .then((blob) => {
        if (!live) return;
        url = URL.createObjectURL(blob);
        setPreview(url);
      })
      .catch((error) => {
        if (live) setFileError(String(error));
      });
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [file, rotation]);

  // Audio player cleanup

  const busy =
    conversation.loading ||
    localOcr.state === "reading" ||
    explaining ||
    answering ||
    speech.listening ||
    speech.transcribing;

  const validText = admissibleDocument(draftText);
  const lineCount = documentLines(draftText).length;

  const isUnconfirmedDisclaimer = (text: string) =>
    text.includes("चिकित्सकीय अर्थ यस सेवाले पुष्टि गरेको छैन") ||
    text.includes("Its clinical meaning is unconfirmed") ||
    text.includes("कागजातबाट लिइएको पाठ हो");

  const labels = ne
    ? {
        medicine: "औषधिको विवरण",
        instruction: "निर्देशन",
        finding: "नतिजा",
        follow_up: "पुनः भेट",
        other: "अन्य पाठ",
      }
    : {
        medicine: "Medicine wording",
        instruction: "Written instruction",
        finding: "Reported finding",
        follow_up: "Follow-up",
        other: "Document wording",
      };

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile) {
      void handleFileSelected(droppedFile);
    }
  }

  async function handleFileSelected(selected?: File) {
    if (!selected || busy) return;
    setFileError(null);
    setPdfNotice(null);
    setTranscriptionChecked(false);
    setExplanationResult(null);

    // Explicit PDF check as mandated by Directive
    if (
      selected.type === "application/pdf" ||
      selected.name.toLowerCase().endsWith(".pdf")
    ) {
      setPdfNotice(
        ne
          ? "पीडीएफ (PDF) फाइलहरू सिधै समर्थित छैनन्। कृपया कागजातको तस्बिर खिच्नुहोस् वा पाठ पेस्ट गर्नुहोस्।"
          : "PDF files are not directly supported yet. Please take a photo of the page or paste its text directly.",
      );
      return;
    }

    const current = ++currentSelection.current;
    try {
      validateImageFile(selected);
      localOcr.reset();
      setRotation(0);
      setFile(selected);

      // Preview first. Reading starts only after the user chooses its location.
    } catch (err) {
      if (currentSelection.current === current) {
        setFileError(
          err instanceof Error
            ? err.message
            : "This image could not be opened.",
        );
      }
    }
  }

  async function startServerRecognition(imageFile: File, rot: number) {
    let currentToken = session.token;
    if (!currentToken || session.isExpired) {
      currentToken = await session.initSession();
    }
    if (!currentToken) {
      setFileError("Could not connect to session. Check server.");
      return;
    }

    const grant = await session.grantProcessing("image_transcription");
    const consent = grant?.consent;

    try {
      if (consent) {
        const bytes = new Uint8Array(await imageFile.arrayBuffer());
        let binary = "";
        for (let offset = 0; offset < bytes.length; offset += 32768)
          binary += String.fromCharCode(
            ...bytes.subarray(offset, offset + 32768),
          );
        const result = await conversation.recognize(
          "document",
          explainLanguage,
          {
            kind: docKind,
            method: recognitionMethod,
            image: {
              image_base64: btoa(binary),
              language: "eng+nep",
              rotation: rot as 0 | 90 | 180 | 270,
              consent_id: consent.id,
              model_profile: model,
            },
          },
        );
        const extracted = result.attachments?.find(
          (item) => item.id === result.active_attachment_id,
        );
        setDraftText(extracted?.original_text || "");
        setTranscriptionChecked(false);
      } else {
        throw new Error(
          "Server image permission was not granted. Choose local printed OCR or paste the text.",
        );
      }
    } catch (err) {
      setFileError(
        err instanceof Error
          ? err.message
          : "Recognition failed. Please retry.",
      );
    }
  }

  useEffect(() => {
    if (localOcr.draft) {
      setDraftText(localOcr.draft);
      setTranscriptionChecked(false);
    }
  }, [localOcr.draft, setDraftText]);
  useEffect(() => {
    if (activeAttachment && !hasDraft) {
      setDraftText(
        activeAttachment.reviewed_text || activeAttachment.original_text,
      );
      setDocKind(
        activeAttachment.kind === "medicine"
          ? "prescription"
          : activeAttachment.kind,
      );
      setTranscriptionChecked(Boolean(activeAttachment.reviewed_text));
    }
    const last = snapshot?.turns?.at(-1);
    if (
      last?.document &&
      (!hasDraft || draftText === activeAttachment?.reviewed_text)
    )
      setExplanationResult(last.document);
  }, [activeAttachment, snapshot?.turns, hasDraft, setDraftText, draftText]);

  async function handleExplainDocument() {
    if (!validText || !transcriptionChecked || busy) return;
    setExplaining(true);
    setExplainError(null);

    try {
      let currentToken = session.token;
      if (!currentToken || session.isExpired) {
        currentToken = await session.initSession();
      }
      if (!currentToken) {
        setExplainError("Could not connect to server session.");
        setExplaining(false);
        return;
      }

      const grant = await session.grantProcessing("document_explanation");
      const consent = grant?.consent;

      if (!consent) {
        setExplainError("Document explanation permission was not granted.");
        setExplaining(false);
        return;
      }

      let current = (await conversation.ensure("document", explainLanguage))
        .snapshot;
      const attachment = current.attachments?.find(
        (item) => item.id === current.active_attachment_id,
      );
      if (!attachment || attachment.kind !== docKind) {
        current = await conversation.text(
          "document",
          explainLanguage,
          draftText,
          docKind,
          consent.id,
        );
      }
      await conversation.review(
        "document",
        explainLanguage,
        draftText,
        consent.id,
      );
      const turn = await conversation.turn(
        "document",
        explainLanguage,
        explainLanguage === "ne"
          ? "यस कागजातको लेखाइ व्याख्या गर्नुहोस्।"
          : "Explain the wording of this document.",
        consent.id,
        model,
        "explain",
      );
      const res = turn.document;
      if (!res) throw new Error("Document guide was not returned.");
      setExplanationResult(res);

      // Save to chat history as a durable document session turn
      const convId = history.currentId;
      const assistantMsg: HistoryMessage = {
        id: turn.id,
        sender: "assistant",
        text: turn.answer,
        timestamp: new Date().toISOString(),
      };
      await history.append(convId, assistantMsg, explainLanguage);
    } catch (err) {
      setExplainError(
        err instanceof Error ? err.message : "Failed to explain document.",
      );
    } finally {
      setExplaining(false);
    }
  }

  async function handleSendFollowUp(followUpText?: string) {
    const q = (followUpText || question).trim();
    if (!q || busy || q.length > 400) return;
    setAnswering(true);

    try {
      let currentToken = session.token;
      if (!currentToken || session.isExpired) {
        currentToken = await session.initSession();
      }
      if (!currentToken) {
        setAnswering(false);
        return;
      }

      const grant = await session.grantProcessing("document_explanation");
      const consent = grant?.consent;

      if (!consent) {
        setAnswering(false);
        return;
      }

      const convId = history.currentId;
      const userMsg: HistoryMessage = {
        id: createRequestId(),
        sender: "user",
        text: q,
        timestamp: new Date().toISOString(),
      };

      if (!transcriptionChecked)
        throw new Error(
          "Check the corrected text before asking another question.",
        );
      const current = (await conversation.ensure("document", explainLanguage))
        .snapshot;
      const attachment = current.attachments?.find(
        (item) => item.id === current.active_attachment_id,
      );
      if (attachment?.reviewed_text !== draftText)
        await conversation.review(
          "document",
          explainLanguage,
          draftText,
          consent.id,
        );
      const turn = await conversation.turn(
        "document",
        explainLanguage,
        q,
        consent.id,
        model,
      );
      setQuestion("");
      setVoiceInputReview(null);
      await history.append(
        convId,
        { ...userMsg, id: await turnUserMessageId(turn.id) },
        explainLanguage,
      );

      const assistantMsg: HistoryMessage = {
        id: turn.id,
        sender: "assistant",
        text: turn.answer,
        timestamp: new Date().toISOString(),
      };
      await history.append(convId, assistantMsg, explainLanguage);
    } catch (err) {
      setExplainError(
        err instanceof Error ? err.message : "Error answering question.",
      );
    } finally {
      setAnswering(false);
    }
  }

  async function handleTranscribeSpokenAudio() {
    if (!speech.clip) return;
    const text = await speech.transcribeClip();
    if (text) {
      setVoiceInputReview(text);
      setQuestion(text);
    }
  }

  return (
    <section
      className="transcription-workspace"
      aria-labelledby="workspace-title"
    >
      {localOcr.error && <p role="alert">{localOcr.error}</p>}
      {speech.error && <p role="alert">{speech.error}</p>}
      {answerSpeech.error && <p role="alert">{answerSpeech.error}</p>}
      {answerSpeech.busy && <p role="status">Preparing Nepali speech…</p>}

      <p className="storage-note" role="status">
        {conversation.error ||
          (conversation.loading
            ? ne
              ? "प्रक्रिया चल्दै छ…"
              : "Processing on the server…"
            : ne
              ? "सच्याइएको पाठ र कुराकानी यस उपकरणमा सुरक्षित हुन्छ। जारी राख्दा सर्भरमा पठाइन्छ।"
              : "Reviewed conversations are saved on this device. Unsubmitted drafts stay in this tab.")}
      </p>
      {conversation.loading && (
        <button
          type="button"
          className="btn btn-outline"
          onClick={() =>
            void conversation
              .cancel()
              .catch((failure) => setExplainError(String(failure)))
          }
        >
          {ne ? "रोक्नुहोस्" : "Cancel processing"}
        </button>
      )}
      {(snapshot || draftText.trim() || file) && (
        <button
          type="button"
          className="btn btn-outline"
          disabled={busy}
          onClick={() => {
            history.newChat();
            setDraftText("");
            setExplanationResult(null);
            setTranscriptionChecked(false);
          }}
        >
          {ne ? "नयाँ कागजात कुराकानी" : "New document conversation"}
        </button>
      )}
      {activeAttachment?.recognition && !file && (
        <p role="note">
          {ne
            ? "मूल तस्बिर सुरक्षित हुँदैन। तुलना गर्न पुनः छान्नुहोस्।"
            : "The original image is not saved. Choose it again to compare the wording."}
        </p>
      )}
      {/* Input Mode Selector */}
      <fieldset
        className="transcription-mode-tabs"
        aria-label={ne ? "कागजात राख्ने तरिका" : "Input options"}
      >
        <button
          type="button"
          aria-pressed={inputMode === "image"}
          className={`btn-mode-tab ${inputMode === "image" ? "active" : ""}`}
          onClick={() => setInputMode("image")}
        >
          {ne ? "फोटोबाट उतार्नुहोस्" : "Photo or image"}
        </button>
        <button
          type="button"
          aria-pressed={inputMode === "paste"}
          className={`btn-mode-tab ${inputMode === "paste" ? "active" : ""}`}
          onClick={() => setInputMode("paste")}
        >
          {ne ? "पाठ पेस्ट गर्नुहोस्" : "Paste document text"}
        </button>
      </fieldset>

      <details className="transcription-options-drawer">
        <summary>
          {ne
            ? "प्रक्रियाका विकल्पहरू र मोडल चयन"
            : "Processing options & reader selection"}
        </summary>
        <div className="transcription-options-content">
          <ModelChoice
            runtime={runtime}
            locale={locale}
            disabled={busy}
            onChange={() => setExplanationResult(null)}
          />

          <div className="transcription-field-group">
            <label htmlFor="recognition-method">
              {ne ? "पाठ पढ्ने तरिका (Image reader):" : "Image reader method:"}
            </label>
            <select
              id="recognition-method"
              value={recognitionMethod}
              disabled={busy}
              onChange={(event) =>
                setRecognitionMethod(
                  event.target.value as "vision" | "printed_ocr",
                )
              }
            >
              <option value="vision">
                {ne
                  ? "हस्तलेखन र मिश्रित पाठ (Vision model)"
                  : "Handwriting & mixed text (Vision model)"}
              </option>
              <option value="printed_ocr">
                {ne ? "छापिएको पाठ (Printed OCR)" : "Printed text (Local OCR)"}
              </option>
            </select>
          </div>
        </div>
      </details>
      {pdfNotice && (
        <div className="notice notice-warning" role="alert">
          <p>{pdfNotice}</p>
        </div>
      )}

      {/* Main Two-Column Stage */}
      <div
        className={`transcription-grid ${draftText.trim() || busy ? "has-review" : "capture-only"}`}
      >
        {/* Left Column: Image Capture / Original Text */}
        <section
          className="transcription-source-panel"
          aria-labelledby="source-heading"
        >
          <h2 id="source-heading" className="panel-subheading">
            {ne ? "१ · मूल कागजात" : "01 · Original Document"}
          </h2>

          {inputMode === "image" ? (
            <div className="image-capture-stage">
              {preview ? (
                <div className="preview-container">
                  <div className="preview-wrapper">
                    {/* biome-ignore lint/performance/noImgElement: Blob preview must stay in browser */}
                    <img
                      ref={photoRef}
                      src={preview}
                      alt="Uploaded prescription or report"
                      style={{
                        transform: `scale(${zoom})`,
                        transformOrigin: "center center",
                      }}
                    />
                  </div>
                  <div className="preview-toolbar">
                    <button
                      type="button"
                      className="btn btn-sm btn-secondary"
                      onClick={() => {
                        const nextRot = (rotation + 90) % 360;
                        setRotation(nextRot);
                        setTranscriptionChecked(false);
                      }}
                      title="Rotate 90 degrees"
                    >
                      {ne ? "घुमाउनुहोस्" : "Rotate"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-secondary"
                      onClick={() => setZoom((z) => clampZoom(z + 0.25))}
                    >
                      {ne ? "ठूलो" : "Zoom in"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-secondary"
                      onClick={() => setZoom((z) => clampZoom(z - 0.25))}
                    >
                      {ne ? "सानो" : "Zoom out"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-outline"
                      onClick={() => {
                        setFile(null);
                        setDraftText("");
                        setExplanationResult(null);
                      }}
                    >
                      {ne ? "हटाउनुहोस्" : "Remove"}
                    </button>
                  </div>
                </div>
              ) : (
                <section
                  aria-label={ne ? "कागजात अपलोड क्षेत्र" : "Document upload zone"}
                  className={`dropzone-box ${isDragging ? "dropzone-active" : ""}`}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                >
                  <WorkspaceIcon name="image" size={48} />
                  <p>
                    {ne
                      ? "कागजातको स्पष्ट तस्बिर यहाँ तान्नुहोस् वा छान्नुहोस् (JPEG, PNG, WebP, ८ एमबी सम्म)"
                      : "Drag & drop, choose file, or take photo of your document (JPEG, PNG, WebP up to 8 MB)"}
                  </p>
                  <div className="dropzone-actions">
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => pickerRef.current?.click()}
                    >
                      {ne ? "फाइल छान्नुहोस्" : "Choose file"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => cameraRef.current?.click()}
                    >
                      {ne ? "फोटो खिच्नुहोस्" : "Take photo"}
                    </button>
                  </div>
                  <input
                    ref={pickerRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    hidden
                    onChange={(e) =>
                      void handleFileSelected(e.target.files?.[0])
                    }
                  />
                  <input
                    ref={cameraRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    capture="environment"
                    hidden
                    onChange={(e) =>
                      void handleFileSelected(e.target.files?.[0])
                    }
                  />
                </section>
              )}

              {fileError && (
                <p className="input-error-alert" role="alert">
                  {fileError}
                </p>
              )}
            </div>
          ) : (
            <div className="text-paste-stage">
              <textarea
                aria-label={ne ? "कागजातको पाठ" : "Document text"}
                className="document-textarea"
                rows={12}
                maxLength={8000}
                value={draftText}
                onChange={(e) => {
                  setDraftText(e.target.value);
                  setTranscriptionChecked(false);
                  setExplanationResult(null);
                  answerSpeech.stop();
                }}
                placeholder={
                  ne
                    ? "कागजातको पाठ यहाँ पेस्ट गर्नुहोस्। प्रत्येक निर्देशन छुट्टै लाइनमा राख्नुहोस्..."
                    : "Paste prescription, doctor note, or report text. Keep each medicine or instruction on its own line..."
                }
              />
              <small className="char-count">
                {draftText.length}/8000 · {lineCount}/40 lines (max 500
                chars/line)
              </small>
            </div>
          )}

          {file && (
            <div className="recognition-action">
              <p>
                {processingLocation === "device"
                  ? ne
                    ? "तस्बिर यस उपकरणमा मात्र पढिन्छ। छापिएको पाठका लागि उपयुक्त।"
                    : "Read on this device only. Suitable for printed text."
                  : ne
                    ? "पढ्न अनुमति दिएपछि यो तस्बिर सर्भरमा पठाइन्छ।"
                    : "Allow reading to send this image to the processing server."}
              </p>
              <button
                className="btn btn-primary"
                type="button"
                disabled={busy}
                onClick={() => {
                  if (processingLocation === "device")
                    void prepareImage(file, rotation)
                      .then((image) => localOcr.read(image, "eng+nep"))
                      .catch((error) => setFileError(String(error)));
                  else void startServerRecognition(file, rotation);
                }}
              >
                {ne ? "अनुमति दिनुहोस् र तस्बिर पढ्नुहोस्" : "Allow and read image"}
              </button>
            </div>
          )}

          {/* Document metadata controls */}
          <div className="document-type-controls">
            <label htmlFor="document-kind">
              <span>{ne ? "कागजातको प्रकार:" : "Document kind:"}</span>
              <select
                id="document-kind"
                value={docKind}
                onChange={(e) => {
                  setDocKind(e.target.value as typeof docKind);
                  setExplanationResult(null);
                  answerSpeech.stop();
                }}
                disabled={busy}
              >
                <option value="prescription">
                  {ne ? "प्रेस्क्रिप्सन" : "Prescription"}
                </option>
                <option value="doctor_note">
                  {ne ? "चिकित्सकको नोट" : "Doctor’s note"}
                </option>
                <option value="report">
                  {ne ? "स्वास्थ्य रिपोर्ट" : "Medical report"}
                </option>
              </select>
            </label>
            <label htmlFor="document-explanation-language">
              <span>{ne ? "व्याख्या भाषा:" : "Language:"}</span>
              <select
                id="document-explanation-language"
                value={explainLanguage}
                onChange={(e) =>
                  setExplainLanguage(e.target.value as typeof explainLanguage)
                }
                disabled={busy}
              >
                <option value="en">English</option>
                <option value="ne">नेपाली</option>
              </select>
            </label>
          </div>
        </section>

        {/* Right Column: Transcription Review & Plain Explanation */}
        {(draftText.trim() || busy) && (
          <section
            className="transcription-review-panel"
            aria-labelledby="review-heading"
          >
            <h2 id="review-heading" className="panel-subheading">
              {ne ? "२ · उतार जाँच र समीक्षा" : "02 · Review Transcription"}
            </h2>

            <div className="review-card">
              {draftText.includes("[illegible]") && (
                <div className="notice notice-warning" role="alert">
                  <p>
                    {ne
                      ? "केही शब्दहरू अस्पष्ट ([illegible]) चिन्हित छन्। अनुमान नगर्नुहोस्, डाक्टर वा फर्मासिस्टसँग जाँच्नुहोस्।"
                      : "Some words are marked [illegible]. Do not guess doses or names; verify with your clinician."}
                  </p>
                </div>
              )}

              <label htmlFor="editable-draft" className="sr-only">
                {ne ? "जाँच्नुपर्ने उतारिएको पाठ" : "Transcribed text for review"}
              </label>
              <textarea
                disabled={busy}
                id="editable-draft"
                className="review-textarea"
                rows={8}
                value={draftText}
                onChange={(e) => {
                  setDraftText(e.target.value);
                  setTranscriptionChecked(false);
                  setExplanationResult(null);
                  answerSpeech.stop();
                }}
                placeholder={
                  busy
                    ? ne
                      ? "सर्भरबाट पाठ उतार्दै..."
                      : "Transcribing from image..."
                    : ne
                      ? "उतारिएको पाठ यहाँ देखिनेछ..."
                      : "Transcribed draft will appear here..."
                }
              />

              {/* Crucial Verification Gate Checkbox */}
              <label className="document-check-label">
                <input
                  type="checkbox"
                  checked={transcriptionChecked}
                  onChange={(e) => setTranscriptionChecked(e.target.checked)}
                  disabled={!draftText.trim() || busy}
                />
                <span>
                  {ne
                    ? "मैले नाम, औषधिको मात्रा, अंक, एकाइ र निर्देशन मूल कागजातसँग जाँचेँ।"
                    : "I checked names, medicine strengths, numbers, units, and instructions against the original."}
                </span>
              </label>

              <button
                type="button"
                className="btn btn-primary btn-explain-doc"
                disabled={!transcriptionChecked || !validText || busy}
                onClick={handleExplainDocument}
              >
                {explaining
                  ? ne
                    ? "कागजात बुझाउँदै..."
                    : "Generating plain explanation..."
                  : ne
                    ? "कागजात सरल भाषामा बुझ्नुहोस्"
                    : "Explain this document in plain language"}
              </button>
              {explainError && (
                <p className="input-error-alert" role="alert">
                  {explainError}
                </p>
              )}
            </div>

            {/* Plain-Language Reading Guide Section */}
            {explanationResult && (
              <div className="reading-guide-section" aria-live="polite">
                <h3 className="guide-heading">
                  {ne
                    ? "३ · सरल भाषामा व्याख्या"
                    : "03 · Plain Language Reading Guide"}
                </h3>

                {explanationResult.notice && (
                  <div
                    className={`notice ${explanationResult.status === "urgent" ? "notice-urgent" : "notice-info"}`}
                  >
                    <p>{explanationResult.notice}</p>
                  </div>
                )}

                <DocumentSpeech result={explanationResult} ne={ne} />

                {explanationResult.items.some((item) =>
                  isUnconfirmedDisclaimer(item.meaning),
                ) && (
                  <div className="guide-disclaimer-notice" role="note">
                    <p>
                      ℹ️{" "}
                      {ne
                        ? "केही रेखाहरू कागजातबाट सिधै उतारिएका हुन् जसको चिकित्सकीय अर्थ पुष्टि गरिएको छैन। कृपया डाक्टर वा फर्मासिस्टसँग जाँच्नुहोस्।"
                        : "Some lines are direct transcriptions whose clinical meaning is unconfirmed. Please verify with your doctor or pharmacist."}
                    </p>
                  </div>
                )}

                <div className="guide-items-list">
                  {explanationResult.items.map((item) => {
                    const isBoilerplate = isUnconfirmedDisclaimer(item.meaning);
                    return (
                      <article key={item.line_id} className="guide-card">
                        <div className="guide-card-header">
                          <span className="badge badge-kind">
                            {labels[item.kind] || item.kind}
                          </span>
                          <span className="line-tag">{item.line_id}</span>
                        </div>
                        <blockquote className="guide-quote">
                          “{item.quote}”
                        </blockquote>
                        {!isBoilerplate && (
                          <p className="guide-meaning">{item.meaning}</p>
                        )}

                        {item.definitions.length > 0 && (
                          <div className="definitions-box">
                            {item.definitions.map((def) => (
                              <div key={def.term} className="definition-item">
                                <strong>{def.term}: </strong>
                                <span>{def.meaning}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>

                {answerSpeech.url && (
                  <div className="audio-playback-bar">
                    {/* biome-ignore lint/a11y/useMediaCaption: Speech transcript is rendered below or alongside the player. */}
                    <audio
                      controls
                      autoPlay
                      src={answerSpeech.url || undefined}
                      onEnded={answerSpeech.next}
                    />
                    {answerSpeech.text && (
                      <small className="audio-transcript">
                        “{answerSpeech.text}”
                      </small>
                    )}
                  </div>
                )}

                {/* In-Thread Contextual Follow-Up Q&A */}
                <div className="document-followup-stage">
                  <h4>
                    {ne
                      ? "थप प्रश्न सोध्नुहोस्"
                      : "Ask follow-ups about this document"}
                  </h4>

                  {/* Interactive Q&A conversation thread */}
                  {snapshot?.turns?.some(
                    (t) =>
                      t.message !== "यस कागजातको लेखाइ व्याख्या गर्नुहोस्।" &&
                      t.message !== "Explain the wording of this document.",
                  ) && (
                    <section
                      className="document-chat-thread"
                      aria-label={ne ? "सोधिएका प्रश्नोत्तर" : "Document Q&A"}
                    >
                      {snapshot.turns
                        .filter(
                          (t) =>
                            t.message !== "यस कागजातको लेखाइ व्याख्या गर्नुहोस्।" &&
                            t.message !==
                              "Explain the wording of this document.",
                        )
                        .map((turn) => (
                          <div
                            key={turn.id}
                            className="document-chat-bubble document-chat-assistant"
                          >
                            <div className="document-chat-header">
                              <strong>{ne ? "प्रश्नोत्तर" : "Q&A"}</strong>
                              <small>
                                {turn.context_revision !==
                                snapshot.context_revision
                                  ? ne
                                    ? "अघिल्लो पाठको जवाफ"
                                    : "Earlier wording"
                                  : ""}
                              </small>
                            </div>
                            <p className="document-chat-question">
                              <strong>Q: </strong>
                              {turn.message}
                            </p>
                            <p
                              className="document-chat-answer"
                              style={{ whiteSpace: "pre-wrap" }}
                            >
                              {turn.answer}
                            </p>
                            {turn.language === "ne" &&
                              !turn.restored_from_client &&
                              transcriptionChecked &&
                              turn.context_revision ===
                                snapshot?.context_revision && (
                                <button
                                  type="button"
                                  className="btn btn-sm btn-outline btn-audio-play"
                                  disabled={busy || answerSpeech.busy}
                                  onClick={() =>
                                    void answerSpeech.play(turn.id)
                                  }
                                >
                                  {ne ? "नेपालीमा सुन्नुहोस्" : "Listen in Nepali"}
                                </button>
                              )}
                            {turn.references && turn.references.length > 0 && (
                              <div className="document-chat-refs">
                                {turn.references.map((ref) => (
                                  <small
                                    key={`${ref.attachment_id}:${ref.line_id}`}
                                    className="ref-tag"
                                  >
                                    {ref.line_id}: {ref.quote}
                                  </small>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                    </section>
                  )}

                  <div className="quick-prompts-row">
                    {[
                      ne
                        ? "यो औषधिको प्रयोग के हो?"
                        : "What is this medicine used for?",
                      ne ? "पुनः भेट कहिले छ?" : "Which line mentions follow-up?",
                      ne
                        ? "कुनै सावधानी अपनाउनु पर्छ?"
                        : "What precautions are noted?",
                    ].map((promptText) => (
                      <button
                        key={promptText}
                        type="button"
                        className="suggestion-pill"
                        disabled={busy}
                        onClick={() => handleSendFollowUp(promptText)}
                      >
                        {promptText}
                      </button>
                    ))}
                  </div>

                  <form
                    className="followup-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleSendFollowUp();
                    }}
                  >
                    <div className="input-group">
                      <input
                        type="text"
                        className="followup-input"
                        value={question}
                        onChange={(e) => setQuestion(e.target.value)}
                        placeholder={
                          ne
                            ? "कागजातबारे प्रश्न सोध्नुहोस्..."
                            : "Ask about this prescription or report..."
                        }
                        maxLength={400}
                        disabled={busy}
                      />

                      {/* Microphone Voice Action */}
                      <button
                        type="button"
                        className={`btn btn-secondary btn-mic ${speech.listening ? "recording-active" : ""}`}
                        onClick={() => {
                          if (speech.listening) {
                            speech.stop();
                          } else if (speech.clip) {
                            void handleTranscribeSpokenAudio();
                          } else {
                            void speech.start();
                          }
                        }}
                        title={
                          ne
                            ? "प्रश्न बोल्नुहोस् (नेपाली / English)"
                            : "Speak question in Nepali or English"
                        }
                      >
                        {speech.listening
                          ? `${ne ? "रोक्नुहोस्" : "Stop"} (${speech.elapsed}s)`
                          : speech.clip
                            ? ne
                              ? "आवाज उतार्नुहोस्"
                              : "Transcribe clip"
                            : ne
                              ? "बोल्नुहोस्"
                              : "Speak"}
                      </button>

                      <button
                        type="submit"
                        className="btn btn-primary"
                        disabled={
                          !question.trim() || busy || !transcriptionChecked
                        }
                      >
                        {answering ? "..." : ne ? "सोध्नुहोस्" : "Ask"}
                      </button>
                    </div>
                  </form>

                  {speech.listening && (
                    <p className="voice-status-note" role="status">
                      🔴{" "}
                      {speech.interimText
                        ? `“${speech.interimText}”`
                        : ne
                          ? "सुन्दैछ... बोल्नुहोस् र समाप्त भएपछि रोक्नुहोस्।"
                          : "Listening... speak clearly into microphone."}
                    </p>
                  )}
                  {speech.transcribing && (
                    <p className="voice-status-note" role="status">
                      ⏳{" "}
                      {ne
                        ? "आवाज उतारिँदै..."
                        : "Transcribing your audio clip..."}
                    </p>
                  )}
                  {speech.error && (
                    <p className="input-error-alert" role="alert">
                      {speech.error}
                    </p>
                  )}
                  {voiceInputReview && !speech.listening && (
                    <p className="voice-status-note" role="status">
                      {ne
                        ? "आवाज उतारियो। पठाउनुअघि माथिको पाठ जाँच्नुहोस् वा सच्याउनुहोस्।"
                        : "Spoken question transcribed. Review or edit it above before sending."}
                    </p>
                  )}
                </div>
              </div>
            )}
          </section>
        )}
      </div>
      {transcriptionChecked && validText && (
        <DocumentMedicines
          ne={ne}
          names={medicineNames(
            draftText,
            explanationResult?.items
              .filter((item) => item.kind === "medicine")
              .map((item) => item.quote),
          )}
        />
      )}
    </section>
  );
}
