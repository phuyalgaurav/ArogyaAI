// Bound the entire background job, including slow or interrupted polling requests.
export async function pollRecognition<T extends { status: string }>(
  initial: T,
  fetchJob: (signal: AbortSignal) => Promise<T>,
  signal: AbortSignal,
  timeoutMs = 165000,
  intervalMs = 1800,
): Promise<T> {
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
  let job = initial;
  try {
    while (job.status === "processing") {
      await new Promise<void>((resolve, reject) => {
        const aborted = () => {
          clearTimeout(timer);
          reject(bounded.reason);
        };
        const timer = setTimeout(() => {
          bounded.removeEventListener("abort", aborted);
          resolve();
        }, intervalMs);
        if (bounded.aborted) aborted();
        else bounded.addEventListener("abort", aborted, { once: true });
      });
      job = await fetchJob(bounded);
    }
    return job;
  } catch (error) {
    if (bounded.aborted)
      throw new Error(
        signal.aborted
          ? "Image reading cancelled. Your image is still here."
          : "Image reading timed out. Retry with a clearer photo or choose another reading model in Processing options.",
      );
    throw error;
  }
}

export function recognitionError(code?: string | null): string {
  switch (code) {
    case "model_busy":
    case "bonsai_busy":
    case "recognition_capacity":
      return "The reading model is processing another request. Wait for it to finish, then retry.";
    case "invalid_photo_draft":
      return "The model could not produce a complete transcription. Try a clearer photo or another reading model in Processing options.";
    case "image_no_readable_text":
      return "No readable text found. Try a clearer photo, another reading method, or paste the text.";
    case "image_reader_unavailable":
      return "Printed text reading is unavailable on this server. Try reading on your device, visual reading, or paste the text.";
    case "image_reader_timeout":
    case "prescription_vision_timeout":
      return "Image reading timed out. Try a smaller, clearer photo or another reading model in Processing options.";
    case "cancelled":
      return "Image reading cancelled. Your image is still here.";
    case "document_limit_exceeded":
      return "This document exceeds the transcription limit. Upload one page or section at a time.";
    default:
      return "Image reading failed. Retry with a clearer photo or choose another reading model in Processing options.";
  }
}
