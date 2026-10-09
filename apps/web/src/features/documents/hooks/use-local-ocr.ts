"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Worker } from "tesseract.js";
import type { OcrBBox } from "@/features/documents/lib/image-file";
import { originalOcrBox } from "@/features/documents/lib/image-file";

export type OcrLanguage = "eng" | "nep" | "eng+nep";
type State = "idle" | "loading" | "reading" | "ready" | "error";

export interface OcrLine {
  id: string;
  text: string;
  confidence: number;
  bbox: OcrBBox;
  correctedText?: string;
}

export function useLocalOcr() {
  const [state, setState] = useState<State>("idle");
  const [progress, setProgress] = useState(0);
  const [draft, setDraft] = useState("");
  const [lines, setLines] = useState<OcrLine[]>([]);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const worker = useRef<Worker | null>(null);
  const generation = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const cancelJob = useRef<(() => void) | null>(null);

  const cancel = useCallback(() => {
    generation.current += 1;
    abort.current?.abort();
    cancelJob.current?.();
    if (worker.current) void worker.current.terminate();
    worker.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  function reset() {
    cancel();
    setState("idle");
    setProgress(0);
    setDraft("");
    setLines([]);
    setSelectedLineId(null);
    setError(null);
  }

  async function read(image: HTMLCanvasElement, language: OcrLanguage) {
    reset();
    const current = generation.current;
    const controller = new AbortController();
    abort.current = controller;
    setState("loading");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cancelled = new Promise<never>((_, reject) => {
      cancelJob.current = () => reject(new Error("Reading cancelled."));
      timer = setTimeout(
        () =>
          reject(new Error("Reading timed out. Try a smaller, clearer image.")),
        60000,
      );
    });
    let local: Worker | null = null;
    try {
      const operation = async () => {
        if (!crypto.subtle)
          throw new Error(
            "On-device reading needs HTTPS or localhost. Choose the Python server on this connection.",
          );
        const response = await fetch("/ocr/manifest.json", {
          signal: controller.signal,
        });
        if (!response.ok)
          throw new Error(
            "Local OCR assets are unavailable. Run pnpm setup:ocr.",
          );
        const manifest = await response.json();
        if (
          manifest.engine !== "tesseract.js" ||
          manifest.version !== "7.0.0"
        ) {
          throw new Error("Unexpected OCR engine assets.");
        }
        await Promise.all(
          language.split("+").map(async (code) => {
            const pin = manifest.languages?.[code];
            if (
              !pin ||
              !/^[a-f0-9]{64}$/.test(pin.sha256) ||
              pin.bytes > 10_000_000
            ) {
              throw new Error("Invalid OCR language manifest.");
            }
            const asset = await fetch(`/ocr/languages/${code}.traineddata.gz`, {
              signal: controller.signal,
            });
            if (!asset.ok) throw new Error("OCR language download failed.");
            const data = await asset.arrayBuffer();
            const hash = Array.from(
              new Uint8Array(await crypto.subtle.digest("SHA-256", data)),
              (byte) => byte.toString(16).padStart(2, "0"),
            ).join("");
            if (data.byteLength !== pin.bytes || hash !== pin.sha256)
              throw new Error("OCR language integrity check failed.");
            return code;
          }),
        );
        const { createWorker } = await import("tesseract.js");
        local = await createWorker(language, 1, {
          workerPath: "/ocr/worker.min.js",
          corePath: "/ocr/core",
          langPath: "/ocr/languages",
          workerBlobURL: false,
          cacheMethod: "none",
          logger: (event) => {
            if (generation.current !== current) return;
            if (event.status === "recognizing text") setState("reading");
            setProgress(Math.round(event.progress * 100));
          },
          errorHandler: () => {},
        });
        if (generation.current !== current || controller.signal.aborted) {
          await local.terminate();
          throw new Error("Reading cancelled.");
        }
        worker.current = local;
        const result = await local.recognize(
          image,
          {},
          { text: true, blocks: true },
        );
        const text = result.data.text.trim();
        const extractedLines: OcrLine[] = [];
        let lineIdx = 0;
        if (result.data.blocks) {
          for (const block of result.data.blocks) {
            for (const para of block.paragraphs || []) {
              for (const line of para.lines || []) {
                const trimmed = line.text?.trim() || "";
                if (trimmed) {
                  extractedLines.push({
                    id: `line-${lineIdx++}`,
                    text: trimmed,
                    confidence: Math.round(line.confidence || 0),
                    bbox: originalOcrBox(
                      {
                        x0: line.bbox.x0,
                        y0: line.bbox.y0,
                        x1: line.bbox.x1,
                        y1: line.bbox.y1,
                      },
                      image.width,
                      image.height,
                      Number(image.dataset.originalWidth) || image.width,
                      Number(image.dataset.originalHeight) || image.height,
                      Number(image.dataset.rotation) || 0,
                    ),
                  });
                }
              }
            }
          }
        }
        if (extractedLines.length === 0 && text) {
          const split = text
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean);
          for (let i = 0; i < split.length; i++) {
            extractedLines.push({
              id: `line-${i}`,
              text: split[i],
              confidence: Math.round(result.data.confidence || 0),
              // No invented line region when the engine did not supply geometry.
              bbox: { x0: 0, y0: 0, x1: 0, y1: 0 },
            });
          }
        }
        return { text, lines: extractedLines };
      };
      const result = await Promise.race([operation(), cancelled]);
      if (generation.current === current) {
        if (!result.text)
          throw new Error(
            "No readable text found. Try brighter light or type the text yourself.",
          );
        setDraft(result.text);
        setLines(result.lines);
        setState("ready");
      }
    } catch (failure) {
      if (generation.current === current) {
        setError(
          failure instanceof Error
            ? failure.message
            : "Could not read this image.",
        );
        setState("error");
      }
    } finally {
      clearTimeout(timer);
      controller.abort();
      if (local) void (local as Worker).terminate();
      if (generation.current === current) {
        worker.current = null;
        cancelJob.current = null;
      }
    }
  }

  function updateLineCorrection(id: string, correctedText: string) {
    const next = lines.map((line) =>
      line.id === id ? { ...line, correctedText } : line,
    );
    setLines(next);
    setDraft(next.map((line) => line.correctedText ?? line.text).join("\n"));
  }

  return {
    state,
    progress,
    draft,
    setDraft,
    lines,
    setLines,
    selectedLineId,
    setSelectedLineId,
    updateLineCorrection,
    error,
    read,
    reset,
  };
}
