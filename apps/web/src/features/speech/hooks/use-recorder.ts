"use client";

import { useEffect, useRef, useState } from "react";
import { prepareAudio } from "@/features/speech/lib/audio";
import { createTurnDetector } from "@/features/speech/lib/voice-turn";

export function useRecorder(
  options: {
    autoStopOnSilence?: boolean;
    getAudioContext?: () => AudioContext | null;
  } = {},
) {
  const [level, setLevel] = useState(0);
  const meter = useRef<AudioContext | null>(null);
  const ownsMeter = useRef(false);
  const meterInput = useRef<MediaStreamAudioSourceNode | null>(null);
  const starting = useRef(false);
  const monitor = useRef<ReturnType<typeof setInterval> | null>(null);
  function stopMeter() {
    if (monitor.current) clearInterval(monitor.current);
    monitor.current = null;
    meterInput.current?.disconnect();
    meterInput.current = null;
    if (meter.current && ownsMeter.current)
      void meter.current.close().catch(() => {});
    meter.current = null;
    setLevel(0);
  }
  const [recording, setRecording] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [clip, setClip] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const current = useRef(0);
  const ticks = useRef<ReturnType<typeof setInterval> | null>(null);
  const stop = () => {
    stopMeter();
    if (recorder.current?.state === "recording") recorder.current.stop();
    stream.current?.getTracks().forEach((track) => {
      track.stop();
    });
  };
  useEffect(
    () => () => {
      current.current += 1;
      if (monitor.current) clearInterval(monitor.current);
      meterInput.current?.disconnect();
      meterInput.current = null;
      if (meter.current && ownsMeter.current)
        void meter.current.close().catch(() => {});
      if (ticks.current) clearInterval(ticks.current);
      if (recorder.current?.state === "recording") recorder.current.stop();
      stream.current?.getTracks().forEach((track) => {
        track.stop();
      });
    },
    [],
  );

  async function load(blob: Blob) {
    const id = ++current.current;
    setPreparing(true);
    setError(null);
    setClip(null);
    try {
      const wav = await prepareAudio(blob);
      if (id === current.current) setClip(wav);
    } catch (failure) {
      if (id === current.current)
        setError(
          failure instanceof Error
            ? failure.message
            : "Could not open this audio.",
        );
    } finally {
      if (id === current.current) setPreparing(false);
    }
  }

  async function start() {
    if (starting.current || preparing || recording) return;
    starting.current = true;
    const id = ++current.current;
    setPreparing(true);
    setError(null);
    setClip(null);
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setError(
        options.autoStopOnSilence
          ? "यो ब्राउजरमा माइक उपलब्ध छैन। तल लेखेर पठाउनुहोस्।"
          : "Recording is unavailable in this browser. Choose an audio file instead.",
      );
      setPreparing(false);
      starting.current = false;
      return;
    }
    try {
      const input = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (id !== current.current) {
        input.getTracks().forEach((track) => {
          track.stop();
        });
        return;
      }
      stream.current = input;
      const active = new MediaRecorder(input);
      recorder.current = active;
      const chunks: Blob[] = [];
      let heardSpeech = !options.autoStopOnSilence;
      active.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      active.onstop = () => {
        if (id === current.current) {
          stopMeter();
          if (ticks.current) clearInterval(ticks.current);
        }
        input.getTracks().forEach((track) => {
          track.stop();
        });
        if (id === current.current) {
          setRecording(false);
          if (heardSpeech)
            void load(new Blob(chunks, { type: active.mimeType }));
          else {
            setPreparing(false);
            setError("आवाज सुनिएन। फेरि बोल्नुहोस्।");
          }
        }
      };
      active.onerror = () => {
        if (id === current.current) {
          clear();
          setError(
            options.autoStopOnSilence
              ? "आवाज रेकर्ड भएन। फेरि बोल्नुहोस् वा लेखेर पठाउनुहोस्।"
              : "Recording failed. Try a short audio file instead.",
          );
        }
      };
      active.start();
      setRecording(true);
      setElapsed(0);
      setPreparing(false);
      const begun = Date.now();
      if (options.autoStopOnSilence) {
        const shared = options.getAudioContext?.();
        const context = shared || new AudioContext();
        ownsMeter.current = !shared;
        meter.current = context;
        void context.resume().catch(() => {});
        const analyser = context.createAnalyser();
        analyser.fftSize = 2048;
        meterInput.current = context.createMediaStreamSource(input);
        meterInput.current.connect(analyser);
        const samples = new Float32Array(analyser.fftSize);
        const detect = createTurnDetector();
        monitor.current = setInterval(() => {
          if (id !== current.current || active.state !== "recording") return;
          analyser.getFloatTimeDomainData(samples);
          const rms = Math.sqrt(
            samples.reduce((sum, v) => sum + v * v, 0) / samples.length,
          );
          setLevel(Math.min(1, rms * 12));
          const turn = detect(rms, Date.now());
          heardSpeech = turn.heardSpeech;
          if (turn.ended) stop();
        }, 50);
      }
      ticks.current = setInterval(() => {
        const seconds = Math.floor((Date.now() - begun) / 1000);
        setElapsed(seconds);
        if (seconds >= 19 && active.state === "recording") active.stop();
      }, 250);
    } catch {
      if (id !== current.current) return;
      stopMeter();
      if (recorder.current?.state === "recording") recorder.current.stop();
      stream.current?.getTracks().forEach((track) => {
        track.stop();
      });
      if (id === current.current) {
        setPreparing(false);
        setError(
          options.autoStopOnSilence
            ? "माइकको अनुमति दिनुहोस् वा तल लेखेर पठाउनुहोस्।"
            : "Microphone access was denied or unavailable. You can type or choose an audio file.",
        );
      }
    } finally {
      starting.current = false;
    }
  }

  function clear() {
    stopMeter();
    current.current += 1;
    if (recorder.current?.state === "recording") stop();
    if (ticks.current) clearInterval(ticks.current);
    setRecording(false);
    setPreparing(false);
    setClip(null);
    setError(null);
  }
  return {
    level,
    recording,
    preparing,
    elapsed,
    clip,
    error,
    start,
    stop,
    load,
    clear,
  };
}
