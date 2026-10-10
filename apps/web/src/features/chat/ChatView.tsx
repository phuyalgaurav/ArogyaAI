"use client";

import type {
  ArogyaResponse,
  HistoryMessage,
  MedicineRecord,
  ReviewedQuestion,
} from "@arogya/contracts";
import { useEffect, useRef, useState } from "react";
import { ConsentBanner } from "@/components/ui/ConsentBanner";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { ProcessingPurpose } from "@/context/SessionContext";
import { useSession } from "@/context/SessionContext";
import { useConversation } from "@/features/conversations/ConversationContext";
import { useAnswerSpeech } from "@/features/conversations/use-answer-speech";
import { useDraft } from "@/features/conversations/use-draft";
import { useHistory } from "@/features/history/HistoryContext";
import { turnUserMessageId } from "@/features/history/turn-message-id";
import { useModel } from "@/features/settings/ModelContext";
import { useRecorder } from "@/features/speech/hooks/use-recorder";
import { audioBase64, audioBlob } from "@/features/speech/lib/audio";

import { ApiError, createRequestId, fetchQuestions } from "@/lib/api";
import { copy } from "@/lib/copy";

interface ChatViewProps {
  locale: "en" | "ne" | "tam";
  onSelectSource?: (sourceId: string) => void;
  initialQuery?: string | null;
  activeMedicine?: MedicineRecord | null;
  onClearMedicine?: () => void;
  onLanguage?: () => void;
  onBrowseQuestions?: () => void;
  onReadImage?: () => void;
  onOpenHistory?: () => void;
  onNepaliVoice?: () => void;
}

export function ChatView({
  locale,
  onSelectSource,
  initialQuery,
  activeMedicine,
  onClearMedicine,
  onOpenHistory,
  onNepaliVoice,
  onLanguage,
}: ChatViewProps) {
  const ne = locale === "ne";
  const text = copy[ne ? "ne" : "en"];
  const { token, hasActiveConsent, initSession, grantConsent } = useSession();
  const session = useSession();
  const { grantProcessing } = session;

  const history = useHistory();
  const conversation = useConversation();
  const answerSpeech = useAnswerSpeech("health");
  const savedSnapshot = conversation.snapshots[history.currentId];
  const snapshot = savedSnapshot?.mode === "health" ? savedSnapshot : undefined;
  const { model } = useModel();

  const messages = history.selected?.messages || [];
  const isSubmitting = history.sending;
  const [questionsState, setQuestionsState] = useState<
    "loading" | "ready" | "failed"
  >("loading");
  const [input, setInput] = useDraft<string>("health-question", "");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [suggestedQuestions, setSuggestedQuestions] = useState<
    ReviewedQuestion[]
  >([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [voiceMode, setVoiceMode] = useState(false);
  const [voiceSetupOpen, setVoiceSetupOpen] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceMessage, setVoiceMessage] = useState<string | null>(null);
  const [spokenAudio, setSpokenAudio] = useState<Record<string, string[]>>({});
  const recorder = useRecorder({
    autoStopOnSilence: true,
    getAudioContext: () => playback.current,
  });
  const [voicePhase, setVoicePhase] = useState<
    "ready" | "transcribing" | "thinking" | "speaking" | "review"
  >("ready");
  const [lastTranscript, setLastTranscript] = useState("");
  const voiceEnabled = useRef(false);
  const voiceEpoch = useRef(0);
  const playback = useRef<AudioContext | null>(null);
  const playingSource = useRef<AudioBufferSourceNode | null>(null);
  const speechRequest = useRef<AbortController | null>(null);
  const voiceDialog = useRef<HTMLDialogElement | null>(null);
  const latest = useRef({
    handleSend,
    recorder,
    transcribeVoiceClip,
    pauseVoice,
  });
  useEffect(() => {
    latest.current = { handleSend, recorder, transcribeVoiceClip, pauseVoice };
  });
  useEffect(() => {
    if (voiceSetupOpen) voiceDialog.current?.showModal();
    else voiceDialog.current?.close();
  }, [voiceSetupOpen]);
  const voiceRequest = useRef<AbortController | null>(null);
  const speechGeneration = useRef(0);

  const speechUrls = useRef(new Map<string, string[]>());

  useEffect(
    () => () => {
      voiceEnabled.current = false;
      voiceEpoch.current += 1;
      voiceRequest.current?.abort();
      if (playback.current) void playback.current.close().catch(() => {});
      playingSource.current?.stop();
      speechRequest.current?.abort();
      speechGeneration.current += 1;
      speechUrls.current.forEach((urls) => {
        urls.forEach(URL.revokeObjectURL);
      });
    },
    [],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: These keys intentionally stop capture when the displayed conversation or language changes.
  useEffect(() => {
    return () => {
      if (voiceEnabled.current) latest.current.pauseVoice();
    };
  }, [history.currentId, locale]);
  useEffect(() => {
    const hide = () => {
      if (document.hidden && voiceEnabled.current) latest.current.pauseVoice();
    };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, []);
  useEffect(() => {
    if (
      voiceEnabled.current &&
      (!hasActiveConsent ||
        session.scopedConsents.speech_transcription?.revoked ||
        session.scopedConsents.speech_synthesis?.revoked)
    )
      latest.current.pauseVoice();
  }, [hasActiveConsent, session.scopedConsents]);

  function permissionActive(purpose: ProcessingPurpose) {
    const grant = session.scopedConsents[purpose];
    return Boolean(
      session.token &&
        session.expiresAt &&
        Date.parse(session.expiresAt) > Date.now() &&
        grant &&
        !grant.revoked &&
        Date.parse(grant.expires_at) > Date.now(),
    );
  }

  function interruptSpeech() {
    speechGeneration.current += 1;
    speechRequest.current?.abort();
    playingSource.current?.stop();
    playingSource.current = null;
  }

  function pauseVoice() {
    voiceEnabled.current = false;
    voiceEpoch.current += 1;
    recorder.clear();
    voiceRequest.current?.abort();
    void conversation.cancel().catch(() => {});
    interruptSpeech();
    setVoiceBusy(false);
    setVoiceMode(false);
    setVoicePhase("ready");
    setVoiceMessage("आवाज कुराकानी रोकियो।");
  }

  async function enableVoiceMode() {
    const epoch = ++voiceEpoch.current;
    setVoiceBusy(true);
    setVoiceMessage(null);
    try {
      // Unlock playback during the user's gesture, before network requests.
      playback.current ||= new AudioContext();
      await playback.current.resume();
      if (!hasActiveConsent && !(await session.grantConsent()))
        throw new Error("अनुमति दिन सकिएन। फेरि प्रयास गर्नुहोस्।");
      for (const purpose of [
        "speech_transcription",
        "speech_synthesis",
      ] as const) {
        if (epoch !== voiceEpoch.current) return;
        if (permissionActive(purpose)) continue;
        if (!(await session.grantProcessing(purpose)))
          throw new Error("आवाजको अनुमति दिन सकिएन। जडान जाँच्नुहोस्।");
      }
      if (epoch !== voiceEpoch.current) return;
      voiceEnabled.current = true;
      setVoiceSetupOpen(false);
      setVoiceMode(true);
      setVoicePhase("ready");
      await recorder.start();
    } catch (failure) {
      if (epoch === voiceEpoch.current)
        setVoiceMessage(
          failure instanceof Error ? failure.message : "फेरि प्रयास गर्नुहोस्।",
        );
    } finally {
      if (epoch === voiceEpoch.current) setVoiceBusy(false);
    }
  }

  async function transcribeVoiceClip(clip: Blob) {
    if (!permissionActive("speech_transcription") || !session.token) {
      pauseVoice();
      setVoiceMessage("अनुमतिको समय सकियो। फेरि आवाज कुराकानी सुरु गर्नुहोस्।");
      return;
    }
    const controller = new AbortController();
    voiceRequest.current?.abort();
    voiceRequest.current = controller;
    setVoiceBusy(true);
    setVoicePhase("transcribing");
    setVoiceMessage(null);
    const timeout = setTimeout(() => controller.abort(), 85000);
    try {
      const output = await conversation.transcribe("health", "ne", {
        audio_base64: await audioBase64(clip),
        consent_id:
          (await grantProcessing("speech_transcription"))?.consent.id || "",
        language: "ne",
      });
      const result = output.transcription;
      if (controller.signal.aborted || !voiceEnabled.current) return;
      const transcript = result.text.trim();
      setLastTranscript(transcript);
      setInput(transcript);
      if (!transcript) {
        setVoicePhase("ready");
        setVoiceMessage("आवाज बुझिएन। फेरि बोल्नुहोस्।");
      } else if (result.status === "needs_review") {
        setVoicePhase("review");
        setVoiceMessage("केही शब्द स्पष्ट भएनन्। तलको पाठ सच्याएर पठाउनुहोस्।");
      } else {
        setInput(transcript);
        setVoicePhase("review");
        setVoiceMessage("शब्द जाँचेर पठाउनुहोस्।");
      }
    } catch (failure) {
      if (!voiceEnabled.current || voiceRequest.current !== controller) return;
      setVoicePhase("ready");
      setVoiceMessage(
        failure instanceof Error
          ? failure.message
          : "आवाज बुझिएन। फेरि प्रयास गर्नुहोस्।",
      );
    } finally {
      clearTimeout(timeout);
      if (voiceRequest.current === controller) setVoiceBusy(false);
    }
  }

  useEffect(() => {
    if (recorder.clip && voiceMode)
      void latest.current.transcribeVoiceClip(recorder.clip);
  }, [recorder.clip, voiceMode]);

  async function speakAnswer(messageId: string, answer: string) {
    if (!voiceEnabled.current || locale !== "ne") return;
    if (!permissionActive("speech_synthesis") || !session.token) {
      pauseVoice();
      setVoiceMessage("अनुमतिको समय सकियो। फेरि आवाज कुराकानी सुरु गर्नुहोस्।");
      return;
    }
    if (!answer.trim()) {
      setVoicePhase("ready");
      return;
    }
    const generation = ++speechGeneration.current;
    const controller = new AbortController();
    speechRequest.current?.abort();
    speechRequest.current = controller;
    const urls: string[] = [];
    const previous = speechUrls.current.get(messageId) || [];
    previous.forEach(URL.revokeObjectURL);
    speechUrls.current.set(messageId, urls);
    const live = () =>
      generation === speechGeneration.current && voiceEnabled.current;
    let chunkCount = 1;
    const generate = async (chunk: number) => {
      const result = await conversation.speech(
        "health",
        "ne",
        messageId,
        session.scopedConsents.speech_synthesis?.id || "",
        chunk,
      );
      chunkCount = result.chunk_count;
      return result.speech;
    };
    try {
      let pending = generate(0);
      for (let index = 0; index < chunkCount; index++) {
        const result = await pending;
        if (!live()) return;
        const blob = audioBlob(result.audio_base64);
        const url = URL.createObjectURL(blob);
        urls.push(url);
        setSpokenAudio((current) => ({ ...current, [messageId]: [...urls] }));
        // One sentence ahead: playback and the next synthesis overlap.
        if (index + 1 < chunkCount) {
          pending = generate(index + 1);
          void pending.catch(() => {});
        }
        const context = playback.current;
        if (context?.state !== "running")
          throw new Error("आवाज बजाउन तलको प्ले बटन थिच्नुहोस्।");
        const buffer = await context.decodeAudioData(await blob.arrayBuffer());
        if (!live()) return;
        setVoicePhase("speaking");
        setVoiceMessage(null);
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(context.destination);
        playingSource.current = source;
        await new Promise<void>((resolve) => {
          source.onended = () => {
            source.disconnect();
            resolve();
          };
          source.start();
        });
        if (playingSource.current === source) playingSource.current = null;
        if (!live()) return;
      }
      if (live()) {
        setVoicePhase("ready");
        setVoiceMessage(null);
        void latest.current.recorder.start();
      }
    } catch (failure) {
      if (!live()) return;
      controller.abort();
      setVoicePhase("ready");
      setVoiceMessage(
        failure instanceof Error
          ? failure.message
          : "आवाज बजाउन सकिएन। फेरि प्रयास गर्नुहोस्।",
      );
    }
  }

  // Audio / Speech states
  const [transcribingVoice, setTranscribingVoice] = useState(false);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);

  // Prefill initial query if supplied from Knowledge catalog
  useEffect(() => {
    if (initialQuery) {
      setInput(initialQuery);
    }
  }, [initialQuery, setInput]);

  // Fetch reviewed questions for prompt suggestions
  useEffect(() => {
    let active = true;
    const lang = ne ? "ne" : "en";
    setQuestionsState("loading");
    fetchQuestions(lang, 5)
      .then((items) => {
        if (active) {
          setSuggestedQuestions(items);
          setQuestionsState("ready");
        }
      })
      .catch(() => {
        if (active) {
          setSuggestedQuestions([]);
          setQuestionsState("failed");
        }
      });
    return () => {
      active = false;
    };
  }, [ne]);

  function handleCopy(id: string, textToCopy: string) {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(textToCopy);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  }

  async function handleSend(questionText?: string) {
    const query = (questionText || input).trim();
    if (!query || isSubmitting || query.length > 2000) return;
    if (messages.length > 98) {
      setVoicePhase("ready");
      setSubmitError(
        "This chat has reached its message limit. Start a new chat.",
      );
      return;
    }

    if (!hasActiveConsent) {
      setVoicePhase("ready");
      setSubmitError(text.consentRequiredNotice);
      return;
    }

    if (!history.beginSending()) return;
    if (questionText === undefined) {
      voiceRequest.current?.abort();
      voiceRequest.current = null;
      setVoiceBusy(false);
    }
    const conversationId = history.currentId;
    const turnEpoch = voiceEpoch.current;
    recorder.clear();
    interruptSpeech();
    if (voiceEnabled.current) setVoicePhase("thinking");
    setSubmitError(null);
    setInput("");
    setVoiceNotice(null);
    const messageId = createRequestId();

    const userMsg: HistoryMessage = {
      id: messageId,
      sender: "user",
      text: query,
      timestamp: new Date().toISOString(),
    };

    try {
      const currentToken = await initSession();
      if (!currentToken) {
        throw new Error(text.consentRequiredNotice);
      }

      const turn = await conversation.turn(
        "health",
        ne ? "ne" : "en",
        query,
        (await session.grantConsent())?.id || "",
        model,
      );
      await history.append(
        conversationId,
        { ...userMsg, id: await turnUserMessageId(turn.id) },
        locale,
      );
      const res = turn.health;
      if (!res) throw new Error("Health response was not returned.");

      const assistantMsg: HistoryMessage = {
        id: turn.id,
        sender: "assistant",
        text: res.answer,
        response: res,
        timestamp: new Date().toISOString(),
      };
      await history.append(conversationId, assistantMsg, locale);
      if (
        voiceEnabled.current &&
        turnEpoch === voiceEpoch.current &&
        locale === "ne"
      )
        void speakAnswer(assistantMsg.id, res.answer);
    } catch (err: unknown) {
      setInput(query);
      let errorDetail = text.unavailable;
      if (err instanceof ApiError) {
        if (err.status === 401) {
          errorDetail = text.sessionExpired;
        } else if (err.status === 403) {
          errorDetail = text.consentRevokedBadge;
        } else if (err.status === 429) {
          errorDetail =
            "Rate limit reached. Please wait a moment before sending another request.";
        } else {
          errorDetail = err.detail || text.unavailable;
        }
      } else if (err instanceof Error) {
        errorDetail = err.message;
      }

      if (voiceEnabled.current && turnEpoch === voiceEpoch.current) {
        setVoicePhase("ready");
        setVoiceMessage("जवाफ लिन सकिएन। फेरि प्रयास गर्नुहोस्।");
      }
      const errorMsg: HistoryMessage = {
        id: createRequestId(),
        sender: "assistant",
        text: errorDetail,
        error: errorDetail,
        timestamp: new Date().toISOString(),
      };
      await history.append(conversationId, errorMsg, locale);
    } finally {
      history.endSending();
    }
  }

  async function handleTranscribeVoiceInput() {
    if (!recorder.clip) return;
    setTranscribingVoice(true);
    setVoiceNotice(null);

    let currentToken = token;
    if (!currentToken) currentToken = await initSession();
    if (!currentToken) {
      setTranscribingVoice(false);
      return;
    }

    const sttConsent = (await grantProcessing("speech_transcription"))?.consent;

    if (!sttConsent) {
      setVoiceNotice("Nepali STT permission is needed to transcribe speech.");
      setTranscribingVoice(false);
      return;
    }

    try {
      const b64 = await audioBase64(recorder.clip);
      const output = await conversation.transcribe("health", ne ? "ne" : "en", {
        audio_base64: b64,
        language: "ne",
        consent_id: sttConsent.id,
      });
      const res = output.transcription;
      setInput(res.text);
      setVoiceNotice(
        ne
          ? "उतारिएको पाठ तयार छ। आवश्यक भए सच्याएर पठाउनुहोस्।"
          : "Recognized question ready. You can edit before sending.",
      );
      recorder.clear();
    } catch (err) {
      setVoiceNotice(
        err instanceof Error ? err.message : "Voice transcription failed.",
      );
    } finally {
      setTranscribingVoice(false);
    }
  }

  async function handlePlayNepaliSpeech(msgId: string) {
    setPlayingMessageId(msgId);
    await answerSpeech.play(msgId);
  }

  function renderStatusNote(response: ArogyaResponse) {
    if (response.safety.rule_ids.includes("public_source_education")) {
      return (
        <p className="history-snapshot-note">
          {ne
            ? "WHO/NHS स्रोतमा आधारित सामान्य जानकारी। नेपाली पाठ ArogyaAI को अनुवाद हो; व्यक्तिगत चिकित्सा सल्लाह होइन।"
            : "General information based on WHO/NHS sources. This is not a clinician-reviewed answer or personal medical advice."}
        </p>
      );
    }
    switch (response.status) {
      case "urgent":
        return (
          <div className="notice notice-urgent" role="alert">
            <div className="urgent-badge-head">
              <strong>🚨 {text.statusUrgent}</strong>
              <a href="tel:102" className="btn btn-sm btn-call-emergency">
                📞 Call 102 Ambulance
              </a>
            </div>
            <p>{text.statusUrgentNote}</p>
          </div>
        );
      case "needs_professional_review":
        return (
          <div className="notice notice-review" role="note">
            <strong>⚕️ {text.statusProfessionalReview}</strong>
            <p>{text.statusProfessionalReviewNote}</p>
          </div>
        );
      default:
        return null;
    }
  }

  return (
    <section className="chat-section" aria-labelledby="chat-heading">
      <header className="chat-header">
        {onNepaliVoice && (
          <div className="chat-voice-entry">
            <button
              type="button"
              className={`btn ${voiceMode ? "btn-outline" : "btn-secondary"}`}
              onClick={() => {
                if (locale !== "ne") onNepaliVoice();
                if (voiceMode) return;
                if (
                  hasActiveConsent &&
                  permissionActive("speech_transcription") &&
                  permissionActive("speech_synthesis")
                )
                  void enableVoiceMode();
                else setVoiceSetupOpen(true);
              }}
            >
              {voiceMode
                ? "नेपाली आवाज कुराकानी सक्रिय"
                : "नेपालीमा बोल्नुहोस् · Nepali voice conversation"}
            </button>
            <span>बोल्नुहोस्, जवाफ सुन्नुहोस्।</span>
          </div>
        )}
        {onLanguage && (
          <button type="button" className="btn-secondary" onClick={onLanguage}>
            {locale === "ne"
              ? "नेपाली आवाज वा अनुवाद प्रयोग गर्नुहोस्"
              : "Use Nepali voice or translation"}
          </button>
        )}
        <div className="chat-header-top">
          <div>
            <h1 id="chat-heading">
              {ne ? "स्वास्थ्य जिज्ञासा" : "Quick health question"}
            </h1>
            <p className="chat-subtitle">{text.chatSubtitle}</p>
          </div>
          {messages.length > 0 && (
            <button
              type="button"
              className="btn btn-sm btn-outline"
              onClick={history.newChat}
              disabled={isSubmitting || history.syncing}
            >
              {ne ? "नयाँ कुराकानी" : "New chat"}
            </button>
          )}
        </div>
      </header>

      <div className="chat-history-status" role="status">
        <span>
          {history.localState === "loading"
            ? "Opening saved chats…"
            : history.saving
              ? "Saving locally…"
              : history.localState === "ready"
                ? "Saved on this device"
                : "Local history is unavailable"}
        </span>
        {onOpenHistory && (
          <button type="button" className="text-button" onClick={onOpenHistory}>
            Past chat records
          </button>
        )}
      </div>

      {history.error && (
        <p className="notice" role="alert">
          {history.error}
        </p>
      )}

      {messages.length > 0 && (
        <p className="history-snapshot-note">
          Saved answers show the sources and status recorded at the time.
          Reopening a chat does not check them again.
        </p>
      )}

      {/* Suggested Questions */}
      {suggestedQuestions.length > 0 && (
        <section
          className="suggested-questions-box"
          aria-label={text.suggestedQuestions}
        >
          <span className="eyebrow">{text.suggestedQuestions}</span>
          <div className="suggestions-list">
            {suggestedQuestions.map((q) => (
              <button
                key={q.question}
                type="button"
                className="suggestion-pill"
                onClick={() => handleSend(q.question)}
                disabled={isSubmitting}
              >
                {q.question}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Message History */}
      <div className="message-history" role="log" aria-live="polite">
        {messages.length === 0 ? (
          <div className="empty-chat-placeholder">
            <h3>{ne ? "प्रश्न सुरु गर्नुहोस्" : "Start a question"}</h3>
            <p>
              {suggestedQuestions.length
                ? text.chatSubtitle
                : questionsState === "loading"
                  ? ne
                    ? "समीक्षित सामग्री जाँच्दै…"
                    : "Loading health topics…"
                  : questionsState === "failed"
                    ? ne
                      ? "सामग्री जाँच्न सकिएन। जडान जाँचेर पुनः खोल्नुहोस्।"
                      : "Could not load health topics. Check your connection and reopen this page."
                    : text.noQuestionsAvailable}
            </p>
          </div>
        ) : (
          messages.map((m) => (
            <article
              key={m.id}
              className={`chat-message chat-message-${m.sender}`}
            >
              <div className="message-meta">
                <span className="message-sender">
                  {m.sender === "user" ? "You" : text.brand}
                </span>
                <time className="message-time" dateTime={m.timestamp}>
                  {new Date(m.timestamp).toLocaleString()}
                </time>
              </div>

              <div className="message-body">
                {m.response && (
                  <div className="message-status-row">
                    <StatusBadge status={m.response.status} locale={locale} />
                  </div>
                )}

                <p className="message-text">{m.text}</p>
                {spokenAudio[m.id]?.map((url, index) => (
                  // biome-ignore lint/a11y/useMediaCaption: The exact spoken answer is displayed immediately above these audio controls.
                  <audio
                    key={url}
                    className="chat-spoken-audio"
                    controls
                    preload="none"
                    src={url}
                    aria-label={`Nepali spoken answer, part ${index + 1}`}
                  />
                ))}

                {m.response && renderStatusNote(m.response)}

                {/* Evidence & Provenance */}
                {m.response && m.response.evidence.length > 0 && (
                  <div className="evidence-box">
                    <span className="evidence-title">{text.evidenceLabel}</span>
                    <ul className="evidence-list">
                      {m.response.evidence.map((ev) => (
                        <li
                          key={`${ev.source_id}-${ev.section_id ?? ""}-${ev.version}`}
                        >
                          {onSelectSource ? (
                            <button
                              type="button"
                              className="source-link-btn"
                              onClick={() => onSelectSource(ev.source_id)}
                            >
                              {text.sourceLabel}: {ev.source_id} (v{ev.version})
                            </button>
                          ) : (
                            <span>
                              {text.sourceLabel}: {ev.source_id} (v{ev.version})
                            </span>
                          )}
                          {ev.section_id && (
                            <span className="section-tag">
                              · {text.sectionLabel}: {ev.section_id}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Actions row: Read-Aloud & Copy */}
                {m.sender === "assistant" && (
                  <div className="assistant-actions-row">
                    {snapshot?.turns?.some(
                      (turn) =>
                        turn.id === m.id &&
                        turn.language === "ne" &&
                        !turn.restored_from_client &&
                        turn.context_revision === snapshot.context_revision,
                    ) && (
                      <button
                        type="button"
                        className="btn-read-aloud text-button"
                        disabled={answerSpeech.busy || conversation.loading}
                        onClick={() => void handlePlayNepaliSpeech(m.id)}
                      >
                        🔊 {ne ? "नेपालीमा सुन्नुहोस्" : "Listen in Nepali"}
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn-copy"
                      onClick={() => handleCopy(m.id, m.text)}
                    >
                      {copiedId === m.id ? "✓ Copied" : "Copy"}
                    </button>
                  </div>
                )}

                {playingMessageId === m.id && answerSpeech.url && (
                  <div className="audio-playback-bar">
                    {/* biome-ignore lint/a11y/useMediaCaption: Spoken audio matches the displayed message text. */}
                    <audio
                      controls
                      autoPlay
                      src={answerSpeech.url || undefined}
                      onEnded={answerSpeech.next}
                    />
                  </div>
                )}
              </div>
            </article>
          ))
        )}

        {isSubmitting && (
          <div className="chat-message chat-message-assistant typing-indicator">
            <span className="typing-dot" />
            <span className="typing-dot" />
            <span className="typing-dot" />
            <span className="typing-label">{text.consulting}</span>
          </div>
        )}
      </div>

      {/* Active Medicine Filter Bar */}
      {activeMedicine && (
        <div className="active-medicine-bar" role="status">
          <span>
            💊 Context: <strong>{activeMedicine.canonical_name}</strong>
          </span>
          {onClearMedicine && (
            <button
              type="button"
              className="btn-clear-medicine"
              onClick={onClearMedicine}
              aria-label="Clear active medicine filter"
            >
              ✕ Remove
            </button>
          )}
        </div>
      )}

      <ConsentBanner locale={locale} />
      {answerSpeech.error && <p role="alert">{answerSpeech.error}</p>}
      {conversation.error && <p role="alert">{conversation.error}</p>}

      {voiceMode && (
        <div className="chat-voice-panel">
          <div className="chat-voice-meter" aria-hidden="true">
            {[
              { id: "a", height: 0.45 },
              { id: "b", height: 0.75 },
              { id: "c", height: 1 },
              { id: "d", height: 0.75 },
              { id: "e", height: 0.45 },
            ].map(({ id, height }) => (
              <span
                key={id}
                style={{ height: `${8 + recorder.level * 48 * height}px` }}
              />
            ))}
          </div>
          <p role="status" aria-live="polite">
            {recorder.error ||
              voiceMessage ||
              (recorder.recording
                ? "सुन्दै छु… बोल्नुहोस्।"
                : recorder.preparing
                  ? "माइक तयार गर्दै छु…"
                  : voicePhase === "transcribing"
                    ? "तपाईंको कुरा बुझ्दै छु…"
                    : voicePhase === "thinking"
                      ? "जवाफ तयार गर्दै छु…"
                      : voicePhase === "speaking"
                        ? "जवाफ सुन्नुहोस्…"
                        : "बोल्न तलको बटन थिच्नुहोस्।")}
          </p>
          {lastTranscript && (
            <div>
              <p className="chat-voice-transcript">
                तपाईंले भन्नुभयो: {lastTranscript}
              </p>
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  voiceEpoch.current += 1;
                  recorder.clear();
                  voiceRequest.current?.abort();
                  interruptSpeech();
                  setVoiceBusy(false);
                  setInput(lastTranscript);
                  setVoicePhase("review");
                  setVoiceMessage("शब्द सच्याएर तलको बटनबाट पठाउनुहोस्।");
                }}
              >
                शब्द सच्याउनुहोस्
              </button>
            </div>
          )}
          <p className="chat-voice-hint">
            बोलेपछि एकछिन रोक्नुहोस्। उतारिएको पाठ जाँचेर पठाउनुहोस्।
          </p>
          <button
            type="button"
            className="btn btn-outline"
            onClick={pauseVoice}
          >
            कुराकानी रोक्नुहोस्
          </button>
        </div>
      )}
      {(recorder.error || voiceMessage) && !voiceMode && (
        <p className="chat-voice-note" role="status">
          {recorder.error || voiceMessage}
        </p>
      )}

      {/* Input Form */}
      <form
        className="chat-input-form"
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
      >
        {submitError && (
          <div className="input-error-alert" role="alert">
            <span>{submitError}</span>
            {!hasActiveConsent && (
              <button type="button" className="btn-link" onClick={grantConsent}>
                {text.grantConsentBtn}
              </button>
            )}
          </div>
        )}

        {voiceNotice && (
          <div className="notice notice-info" role="status">
            <span>{voiceNotice}</span>
          </div>
        )}

        <div className="input-group">
          {voiceMode && (
            <button
              type="button"
              className={
                recorder.recording ? "btn btn-danger" : "btn btn-outline"
              }
              disabled={isSubmitting || recorder.preparing || voiceBusy}
              onClick={() => {
                setVoiceMessage(null);
                if (recorder.recording) recorder.stop();
                else {
                  interruptSpeech();
                  setVoicePhase("ready");
                  void recorder.start();
                }
              }}
            >
              {recorder.recording
                ? "कुरा पठाउनुहोस्"
                : recorder.preparing
                  ? "तयार हुँदै छ…"
                  : voiceBusy
                    ? "पर्खनुहोस्…"
                    : voicePhase === "speaking"
                      ? "रोक्नुहोस् र बोल्नुहोस्"
                      : "बोल्नुहोस्"}
            </button>
          )}
          <input
            type="text"
            className="chat-text-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              activeMedicine
                ? `Ask about ${activeMedicine.canonical_name}...`
                : text.chatPlaceholder
            }
            maxLength={2000}
            disabled={
              isSubmitting ||
              history.syncing ||
              history.localState === "loading" ||
              recorder.recording ||
              transcribingVoice
            }
            aria-label={text.chatPlaceholder}
          />

          {/* Integrated Microphone Button */}
          <button
            type="button"
            className={`btn btn-secondary btn-mic ${recorder.recording ? "recording-active" : ""}`}
            onClick={() => {
              if (recorder.recording) {
                recorder.stop();
              } else if (recorder.clip) {
                void handleTranscribeVoiceInput();
              } else {
                void recorder.start();
              }
            }}
            title="Nepali voice question"
          >
            {recorder.recording
              ? `⏹ Stop (${recorder.elapsed}s)`
              : recorder.clip
                ? "📝 Transcribe clip"
                : "🎙️"}
          </button>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={
              isSubmitting ||
              history.syncing ||
              history.localState === "loading" ||
              !input.trim()
            }
          >
            {isSubmitting ? text.consulting : text.askBtn}
          </button>
        </div>

        {recorder.recording && (
          <p className="voice-status-note" role="status">
            🔴{" "}
            {ne
              ? "नेपालीमा सुन्दै... बोल्न सकिएपछि Stop थिच्नुहोस्"
              : "Listening in Nepali... Press Stop when finished."}
          </p>
        )}
        {transcribingVoice && (
          <p className="voice-status-note" role="status">
            ⏳ {ne ? "आवाज उतारिँदै..." : "Transcribing your speech clip..."}
          </p>
        )}
      </form>

      {voiceSetupOpen && (
        <dialog
          ref={voiceDialog}
          aria-labelledby="voice-dialog-title"
          className="chat-voice-backdrop"
          onCancel={() => {
            voiceEpoch.current += 1;
            setVoiceSetupOpen(false);
          }}
        >
          <section
            className="chat-voice-dialog"
            aria-labelledby="voice-dialog-title"
          >
            <h2 id="voice-dialog-title">नेपालीमा कुरा गर्नुहोस्</h2>
            <p>
              तपाईंको आवाज र प्रश्न ArogyaAI सर्भरमा पठाइन्छ। जवाफ नेपालीमा सुनाइन्छ। यो
              अनुमति एक घण्टाका लागि हो।
            </p>
            <p>
              बोलिसकेपछि एकछिन रोक्नुहोस्। कुरा आफैँ पठाइन्छ र जवाफपछि माइक फेरि खुल्छ।
              जुनसुकै बेला रोक्न सक्नुहुन्छ।
            </p>
            {(recorder.error || voiceMessage) && (
              <p className="notice" role="alert">
                {recorder.error || voiceMessage}
              </p>
            )}
            <div className="chat-voice-dialog-actions">
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => {
                  voiceEpoch.current += 1;
                  setVoiceSetupOpen(false);
                }}
                disabled={voiceBusy}
              >
                अहिले होइन
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void enableVoiceMode()}
                disabled={voiceBusy}
              >
                {voiceBusy ? "तयार हुँदै छ…" : "अनुमति दिएर बोल्नुहोस्"}
              </button>
            </div>
          </section>
        </dialog>
      )}
    </section>
  );
}
