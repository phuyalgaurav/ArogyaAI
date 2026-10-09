export type ProcessingLocation = "server" | "device";
export interface DeviceSpecs {
  threads: number | null;
  memoryGb: number | null;
  webGpu: boolean;
  secureContext: boolean;
}

// These are conservative UX hints for browser OCR, not an AI benchmark.
export function assessDevice(specs: Pick<DeviceSpecs, "threads" | "memoryGb">) {
  const lowCpu = specs.threads !== null && specs.threads <= 4;
  const lowMemory = specs.memoryGb !== null && specs.memoryGb <= 4;
  return {
    lowCpu,
    lowMemory,
    level:
      lowCpu || lowMemory
        ? "low"
        : specs.threads === null || specs.memoryGb === null
          ? "unknown"
          : "normal",
  } as const;
}

export function readDeviceSpecs(): DeviceSpecs {
  const reported = navigator as Navigator & {
    deviceMemory?: number;
    gpu?: unknown;
  };
  const positive = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) && value > 0
      ? value
      : null;
  return {
    threads: positive(reported.hardwareConcurrency),
    memoryGb: positive(reported.deviceMemory),
    webGpu: Boolean(reported.gpu),
    secureContext: window.isSecureContext,
  };
}
