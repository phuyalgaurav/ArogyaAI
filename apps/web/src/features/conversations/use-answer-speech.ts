"use client";

import type { Conversation } from "@arogya/contracts";
import { useEffect, useRef, useState } from "react";
import { useSession } from "@/context/SessionContext";
import { useHistory } from "@/features/history/HistoryContext";
import { audioBlob } from "@/features/speech/lib/audio";
import { useConversation } from "./ConversationContext";

export function useAnswerSpeech(mode: Conversation["mode"]) {
  const conversation = useConversation();
  const session = useSession();
  const history = useHistory();
  const revision = conversation.snapshots[history.currentId]?.context_revision;
  const [url, setUrl] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cursor = useRef<{
    turn: string;
    consent: string;
    chunk: number;
    count: number;
  } | null>(null);
  const epoch = useRef(0);
  const latest = useRef({ conversation, session });
  latest.current = { conversation, session };
  useEffect(
    () => () => {
      epoch.current++;
    },
    [],
  );
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: These values invalidate audio even though the reset does not read them.
  useEffect(() => {
    epoch.current++;
    cursor.current = null;
    setUrl(null);
    setBusy(false);
  }, [
    revision,
    history.currentId,
    session.scopedConsents.speech_synthesis?.revoked,
  ]);
  async function load(
    turn: string,
    consent: string,
    chunk: number,
    generation: number,
  ) {
    setBusy(true);
    try {
      const result = await latest.current.conversation.speech(
        mode,
        "ne",
        turn,
        consent,
        chunk,
      );
      if (epoch.current !== generation) return;
      cursor.current = { turn, consent, chunk, count: result.chunk_count };
      setUrl(URL.createObjectURL(audioBlob(result.speech.audio_base64)));
      setText(result.speech.text);
    } catch (failure) {
      if (epoch.current === generation)
        setError(
          failure instanceof Error
            ? failure.message
            : "Speech could not finish.",
        );
      cursor.current = null;
    } finally {
      if (epoch.current === generation) setBusy(false);
    }
  }
  async function play(turn: string) {
    const generation = ++epoch.current;
    setError(null);
    setUrl(null);
    const grant =
      await latest.current.session.grantProcessing("speech_synthesis");
    if (!grant || generation !== epoch.current) return;
    await load(turn, grant.consent.id, 0, generation);
  }
  function next() {
    const current = cursor.current;
    if (current && current.chunk + 1 < current.count)
      void load(
        current.turn,
        current.consent,
        current.chunk + 1,
        epoch.current,
      );
  }
  function stop() {
    epoch.current++;
    cursor.current = null;
    setUrl(null);
    setBusy(false);
  }
  return { url, text, error, busy, play, next, stop };
}
