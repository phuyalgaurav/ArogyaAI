"use client";

import type { RuntimeStatus } from "@arogya/contracts";
import { useEffect, useState } from "react";
import {
  assessDevice,
  type DeviceSpecs,
  type ProcessingLocation,
  readDeviceSpecs,
} from "@/features/settings/device-specs";

export function DeviceProcessing({
  locale,
  mode,
  onChange,
  runtime,
  disabled = false,
}: {
  locale: "en" | "ne" | "tam";
  mode: ProcessingLocation;
  onChange: (mode: ProcessingLocation) => void;
  runtime: RuntimeStatus | null;
  disabled?: boolean;
}) {
  const [device, setDevice] = useState<DeviceSpecs | null>(null);
  useEffect(() => setDevice(readDeviceSpecs()), []);
  const ne = locale === "ne";
  const unknown = ne ? "उपलब्ध छैन" : "Not reported";
  const assessment = device ? assessDevice(device) : null;
  const host = runtime?.host;
  const reader = runtime?.engines.find((engine) => engine.id === "server_ocr");
  const warning = assessment?.level === "low";
  return (
    <section className="device-processing" aria-labelledby="processing-title">
      <div className="processing-heading">
        <h2 id="processing-title">
          {ne ? "कहाँ प्रक्रिया गर्ने छान्नुहोस्" : "Choose where the work happens"}
        </h2>
        <p>
          {ne
            ? "फोन वा कम्प्युटरको जानकारी हेरेर तस्बिर पढ्ने ठाउँ छान्नुहोस्।"
            : "Compare your device with the computer running Python, then choose where to read images."}
        </p>
      </div>
      <div className="device-spec-grid">
        <article>
          <h3>{ne ? "तपाईंको उपकरण" : "This device"}</h3>
          <dl>
            <div>
              <dt>{ne ? "CPU थ्रेड" : "CPU threads"}</dt>
              <dd>{device?.threads ?? unknown}</dd>
            </div>
            <div>
              <dt>{ne ? "अनुमानित RAM" : "Approx. RAM"}</dt>
              <dd>{device?.memoryGb ? `~${device.memoryGb} GB` : unknown}</dd>
            </div>
            <div>
              <dt>WebGPU</dt>
              <dd>
                {!device
                  ? unknown
                  : !device.secureContext
                    ? ne
                      ? "HTTPS चाहिन्छ"
                      : "Needs HTTPS"
                    : device.webGpu
                      ? ne
                        ? "ब्राउजरमा उपलब्ध"
                        : "Browser API available"
                      : unknown}
              </dd>
            </div>
          </dl>
          <small>
            {ne
              ? "ब्राउजरको सीमित जानकारी हो; वास्तविक CPU मोडेल वा GPU शक्ति थाहा हुँदैन।"
              : "Browser reports are limited and may be rounded. GPU performance and the CPU model are not measured. Specs stay on this device."}
          </small>
        </article>
        <article>
          <h3>{ne ? "Python सर्भर" : "Python server"}</h3>
          <dl>
            <div>
              <dt>{ne ? "प्रणाली" : "System"}</dt>
              <dd>
                {host ? `${host.system} · ${host.architecture}` : unknown}
              </dd>
            </div>
            <div>
              <dt>{ne ? "CPU थ्रेड" : "CPU threads"}</dt>
              <dd>{host?.cpu_threads ?? unknown}</dd>
            </div>
            <div>
              <dt>{ne ? "कुल RAM" : "Total RAM"}</dt>
              <dd>
                {host?.memory_bytes
                  ? `${(host.memory_bytes / 1073741824).toFixed(1)} GB`
                  : unknown}
              </dd>
            </div>
            <div>
              <dt>{ne ? "तस्बिर पढ्ने उपकरण" : "Image reader"}</dt>
              <dd>
                {reader?.state === "ready"
                  ? ne
                    ? "उपलब्ध"
                    : "Available"
                  : reader?.state === "busy"
                    ? ne
                      ? "व्यस्त"
                      : "Busy"
                    : ne
                      ? "अनुपलब्ध"
                      : "Unavailable"}
              </dd>
            </div>
          </dl>
          <small>
            {ne
              ? "RAM कुल मेमोरी हो; अहिले खाली भएको मेमोरी होइन।"
              : "RAM is the computer’s total memory, not its current free memory. Runtime availability is checked separately."}
          </small>
        </article>
      </div>
      {warning && (
        <p className="device-warning" role="status">
          <strong>
            {ne ? "कम स्रोत भएको उपकरण" : "Limited device resources"}
          </strong>{" "}
          ·{" "}
          {ne
            ? "४ वा कम CPU थ्रेड वा ४ GB सम्म RAM देखिएको छ। यही उपकरणमा पढ्दा ढिलो हुन वा रोकिन सक्छ। Python सर्भर सिफारिस गरिन्छ; छान्ने अधिकार तपाईंकै हो।"
            : "This browser reports 4 or fewer CPU threads or at most 4 GB RAM. On-device reading may be slow or stop on large images. The Python server is recommended; you can still choose this device."}
        </p>
      )}
      {assessment?.level === "unknown" && (
        <p className="device-caveat">
          {ne
            ? "केही विवरण उपलब्ध छैनन्। उपकरण पर्याप्त छ भनेर पक्का गर्न सकिँदैन; Python सर्भर सिफारिस गरिन्छ।"
            : "Some specs are not reported, so capacity cannot be confirmed. The Python server remains the recommended option."}
        </p>
      )}
      {host &&
        ((host.cpu_threads != null && host.cpu_threads <= 4) ||
          (host.memory_bytes != null && host.memory_bytes <= 4294967296)) && (
          <p className="device-warning" role="status">
            {ne
              ? "सर्भरमा पनि स्रोत कम छन्। साना तस्बिर प्रयोग गर्नुहोस् र एकपटकमा एउटा काम गर्नुहोस्।"
              : "The Python server also reports limited resources. Use smaller images and run one task at a time."}
          </p>
        )}
      <fieldset className="processing-options" disabled={disabled}>
        <legend>{ne ? "तस्बिर प्रक्रिया" : "Image processing"}</legend>
        <label className={mode === "server" ? "selected" : ""}>
          <input
            type="radio"
            name="processing-location"
            value="server"
            checked={mode === "server"}
            onChange={() => onChange("server")}
          />
          <span>
            <strong>{ne ? "Python सर्भर" : "Python server"}</strong>
            <small>
              {ne
                ? "फोनका लागि सिफारिस · पठाउनुअघि अनुमति"
                : "Recommended for phones · asks permission before sending pixels"}
            </small>
          </span>
        </label>
        <label className={mode === "device" ? "selected" : ""}>
          <input
            type="radio"
            name="processing-location"
            value="device"
            checked={mode === "device"}
            onChange={() => onChange("device")}
          />
          <span>
            <strong>{ne ? "यही उपकरणमा" : "On this device"}</strong>
            <small>
              {ne
                ? "ब्राउजरमा छापिएको पाठ · तस्बिर पठाइँदैन"
                : "Browser printed-text reader · keeps image pixels here"}
            </small>
          </span>
        </label>
      </fieldset>
      {mode === "device" && device && !device.secureContext && (
        <p className="device-warning" role="status">
          {ne
            ? "यही उपकरणमा OCR को लागि HTTPS चाहिन्छ। यो जडानमा Python सर्भर छान्नुहोस्।"
            : "On-device OCR needs HTTPS or localhost to verify model assets. Use the Python server on this HTTP connection."}
        </p>
      )}
      <p className="device-caveat">
        {ne
          ? "यो रोजाइ तस्बिरका लागि हो। अनुवाद, आवाज र स्वास्थ्य प्रश्न Python मा चल्छन्; ब्राउजरमा ती मोडेल अझै छैनन्। रोजाइ यो सत्रमा मात्र रहन्छ।"
          : "This choice applies to image reading. Translation, speech and health-question processing use Python; their browser models are not implemented. Your choice lasts for this page session."}
      </p>
    </section>
  );
}
