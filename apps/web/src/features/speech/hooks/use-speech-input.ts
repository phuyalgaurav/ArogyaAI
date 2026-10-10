"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "@/context/SessionContext";
import { useConversation } from "@/features/conversations/ConversationContext";
import { useRecorder } from "@/features/speech/hooks/use-recorder";
import { audioBase64 } from "@/features/speech/lib/audio";

interface SpeechRecognitionEvent {
  results: {
    [index: number]: {
      [index: number]: {
        transcript: string;
      };
      isFinal: boolean;
      length: number;
    };
    length: number;
  };
}

interface BrowserSpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => BrowserSpeechRecognition;
    webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
  }
}

interface UseSpeechInputOptions {
  language?: "ne" | "en";
  onTranscript?: (text: string) => void;
}

export function useSpeechInput({
  language = "ne",
  onTranscript,
}: UseSpeechInputOptions = {}) {
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [interimText, setInterimText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const isNativeSupported = useRef(false);
  const recorder = useRecorder();
  const session = useSession();
  const conversation = useConversation();

  useEffect(() => {
    isNativeSupported.current =
      typeof window !== "undefined" &&
      Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  }, []);

  const stop = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore already stopped
      }
    }
    if (recorder.recording) {
      recorder.stop();
    }
    setListening(false);
  }, [recorder]);

  const start = useCallback(async () => {
    setError(null);
    setInterimText("");

    const SpeechRecClass =
      typeof window !== "undefined"
        ? window.SpeechRecognition || window.webkitSpeechRecognition
        : undefined;

    if (SpeechRecClass) {
      try {
        const rec = new SpeechRecClass();
        rec.continuous = false;
        rec.interimResults = true;
        rec.lang = language === "ne" ? "ne-NP" : "en-US";

        rec.onresult = (event: SpeechRecognitionEvent) => {
          let fullTranscript = "";
          for (let i = 0; i < event.results.length; i++) {
            const res = event.results[i];
            if (res?.[0]) {
              fullTranscript += res[0].transcript;
            }
          }
          setInterimText(fullTranscript);
          if (onTranscript && fullTranscript.trim()) {
            onTranscript(fullTranscript);
          }
        };

        rec.onerror = (evt: { error: string }) => {
          if (evt.error !== "no-speech") {
            setError(
              language === "ne"
                ? "आवाज पहिचानमा त्रुटि भयो। फेरि प्रयास गर्नुहोस्।"
                : `Speech error: ${evt.error}`,
            );
          }
          setListening(false);
        };

        rec.onend = () => {
          setListening(false);
        };

        recognitionRef.current = rec;
        rec.start();
        setListening(true);
        return;
      } catch {
        // Fallback to server recorder if webkitSpeechRecognition fails
      }
    }

    // Server-based audio recorder fallback
    try {
      await recorder.start();
      setListening(true);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : language === "ne"
            ? "माइक सुरु गर्न सकिएन।"
            : "Could not start microphone.",
      );
      setListening(false);
    }
  }, [language, onTranscript, recorder]);

  // Transcribe recorded audio clip using server Whisper fallback
  const transcribeClip = useCallback(
    async (clipBlob?: Blob | null): Promise<string | null> => {
      const clipToUse = clipBlob || recorder.clip;
      if (!clipToUse) return null;

      setTranscribing(true);
      setError(null);
      try {
        let currentToken = session.token;
        if (!currentToken || session.isExpired) {
          currentToken = await session.initSession();
        }
        if (!currentToken) {
          throw new Error("Session unavailable");
        }

        const grant = await session.grantProcessing("speech_transcription");
        const consent = grant?.consent;
        if (!consent) {
          throw new Error("Speech permission required");
        }

        const b64 = await audioBase64(clipToUse);
        const result = await conversation.transcribe("document", language, {
          audio_base64: b64,
          language: "ne",
          consent_id: consent.id,
        });

        const recognized = result.transcription.text;
        if (recognized && onTranscript) {
          onTranscript(recognized);
        }
        recorder.clear();
        return recognized;
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Transcription failed.";
        setError(msg);
        return null;
      } finally {
        setTranscribing(false);
      }
    },
    [conversation, language, onTranscript, recorder, session],
  );

  return {
    listening,
    transcribing,
    interimText,
    error,
    start,
    stop,
    transcribeClip,
    clip: recorder.clip,
    elapsed: recorder.elapsed,
  };
}
