"use client";

import type { DocumentExplainResult, SpeechResult } from "@arogya/contracts";
import { useEffect, useRef, useState } from "react";
import { useSession } from "@/context/SessionContext";
import { audioBlob } from "@/features/speech/lib/audio";
import { splitSpeech } from "@/features/speech/lib/voice-turn";
import { getApiBaseUrl } from "@/lib/api";

export function DocumentSpeech({
  result,
  ne,
}: {
  result: DocumentExplainResult;
  ne: boolean;
}) {
  const session = useSession();
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const queue = useRef<string[]>([]);
  const grant = useRef<{ token: string; consent: string } | null>(null);
  const revoked = session.scopedConsents.speech_synthesis?.revoked;
  useEffect(
    () => () => {
      generation.current++;
      controller.current?.abort();
    },
    [],
  );
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: New document or revoked permission invalidates pending playback.
  useEffect(() => {
    generation.current++;
    controller.current?.abort();
    queue.current = [];
    setUrl(null);
    setBusy(false);
    setError("");
  }, [result, revoked]);
  function stop() {
    generation.current++;
    controller.current?.abort();
    queue.current = [];
    setUrl(null);
    setBusy(false);
  }
  async function next(epoch: number) {
    const chunk = queue.current.shift();
    if (!chunk || !grant.current) return;
    setBusy(true);
    setUrl(null);
    controller.current = new AbortController();
    try {
      const response = await fetch(
        `${getApiBaseUrl()}/api/v1/speech/synthesize`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${grant.current.token}`,
          },
          body: JSON.stringify({
            text: chunk,
            language: "ne",
            speaker: "kala",
            consent_id: grant.current.consent,
          }),
          signal: controller.current.signal,
          credentials: "omit",
        },
      );
      if (!response.ok)
        throw new Error(
          ne
            ? "नेपाली आवाज तयार हुन सकेन। भाषा सेवा उपलब्ध छ कि जाँच्नुहोस्।"
            : "Nepali audio could not be prepared. Check that the language service is available.",
        );
      const speech: SpeechResult = await response.json();
      if (epoch !== generation.current) return;
      setText(speech.text);
      setUrl(URL.createObjectURL(audioBlob(speech.audio_base64)));
    } catch (failure) {
      if (epoch === generation.current)
        setError(
          failure instanceof Error ? failure.message : "Speech unavailable.",
        );
    } finally {
      if (epoch === generation.current) setBusy(false);
    }
  }
  async function play() {
    stop();
    setError("");
    const epoch = generation.current;
    setBusy(true);
    try {
      const permission = await session.grantProcessing("speech_synthesis");
      if (epoch !== generation.current) return;
      if (!permission) {
        setBusy(false);
        return;
      }
      grant.current = {
        token: permission.token,
        consent: permission.consent.id,
      };
      queue.current = [
        ...new Set([
          result.speech_text_ne,
          ...result.items.flatMap((item) =>
            splitSpeech(
              /[\u0900-\u097f]/.test(item.meaning)
                ? item.meaning
                : item.speech_text_ne,
            ),
          ),
        ]),
      ].filter(Boolean);
      await next(epoch);
    } catch (failure) {
      if (epoch === generation.current) {
        setBusy(false);
        setError(String(failure));
      }
    }
  }
  return (
    <div className="document-speech">
      <div className="document-speech-actions">
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy}
          onClick={() => void play()}
        >
          {busy
            ? ne
              ? "आवाज तयार गर्दै…"
              : "Preparing Nepali audio…"
            : ne
              ? "नेपालीमा व्याख्या सुन्नुहोस्"
              : "Listen to the guide in Nepali"}
        </button>
        {(url || busy) && (
          <button type="button" className="btn btn-outline" onClick={stop}>
            {ne ? "रोक्नुहोस्" : "Stop audio"}
          </button>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      {url && (
        <>
          {/* biome-ignore lint/a11y/useMediaCaption: The spoken Nepali transcript is visible immediately below. */}
          <audio
            controls
            autoPlay
            src={url}
            onEnded={() => void next(generation.current)}
          />
          <p lang="ne" className="audio-transcript">
            {text}
          </p>
        </>
      )}
    </div>
  );
}
