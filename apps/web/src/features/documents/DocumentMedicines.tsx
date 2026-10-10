"use client";

import { useEffect, useState } from "react";
import { getApiBaseUrl } from "@/lib/api";

interface Reference {
  name: string;
  status: "found" | "not_found" | "unavailable";
  title: string;
  description: string;
  image_url: string | null;
  image_description: string;
  source_url: string | null;
}

function MedicineCard({
  reference: ref,
  ne,
}: {
  reference: Reference;
  ne: boolean;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  return (
    <article className="document-medicine-card">
      <div className="document-medicine-image">
        {ref.image_url && !imageFailed ? (
          // biome-ignore lint/performance/noImgElement: External source label images may have variable dimensions.
          <img
            src={ref.image_url}
            alt={ref.image_description}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <span>{ne ? "तस्बिर उपलब्ध छैन" : "Image unavailable"}</span>
        )}
      </div>
      <div>
        <h4>{ref.name}</h4>
        {ref.status === "found" ? (
          <>
            <p>{ref.description}</p>
            {ref.image_url && !imageFailed && (
              <small>{ref.image_description}</small>
            )}
            {ref.source_url && (
              <a href={ref.source_url} target="_blank" rel="noreferrer">
                {ne
                  ? "DailyMed मा मूल लेबल हेर्नुहोस्"
                  : "View source label on DailyMed"}
              </a>
            )}
          </>
        ) : (
          <p>
            {ref.status === "unavailable"
              ? ne
                ? "स्रोतमा अहिले सम्पर्क हुन सकेन। फेरि प्रयास गर्नुहोस्।"
                : "The reference source could not be reached. Please retry."
              : ne
                ? "यो नामसँग मिल्ने स्रोत भेटिएन। फर्मासिस्टसँग नाम पुष्टि गर्नुहोस्।"
                : "No matching label found for this name. Confirm the spelling with a pharmacist."}
          </p>
        )}
      </div>
    </article>
  );
}

export function DocumentMedicines({
  names,
  ne,
}: {
  names: string[];
  ne: boolean;
}) {
  const key = JSON.stringify(names);
  const [results, setResults] = useState<Reference[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Serialized names provide a stable request dependency.
  useEffect(() => {
    const controller = new AbortController();
    const queries: string[] = JSON.parse(key);
    setResults([]);
    setError(false);
    if (!queries.length) return;
    setBusy(true);
    void fetch(`${getApiBaseUrl()}/api/v1/medicines/references`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ names: queries }),
      signal: controller.signal,
      credentials: "omit",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("lookup_failed");
        return response.json() as Promise<Reference[]>;
      })
      .then((data) => {
        if (!controller.signal.aborted) setResults(data);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [key, attempt]);
  if (!names.length) return null;
  return (
    <section
      className="document-medicines"
      aria-labelledby="document-medicines-heading"
    >
      <h3 id="document-medicines-heading">
        {ne ? "कागजातमा उल्लेख भएका औषधिहरू" : "Medicines listed in this document"}
      </h3>
      <p className="storage-note">
        {ne
          ? "औषधिका नाम मात्र DailyMed मा खोजिन्छन्। यी अमेरिकी लेबलका सन्दर्भ तस्बिर हुन्; तपाईंको औषधिको प्याकेट, मात्रा र उत्पादक फरक हुन सक्छ।"
          : "Medicine names are looked up on DailyMed. These are US label references; packaging, strength and manufacturer may differ from your medicine."}
      </p>
      {busy && (
        <p role="status">
          {ne
            ? "औषधिको विवरण र तस्बिर खोज्दै…"
            : "Finding medicine descriptions and images…"}
        </p>
      )}
      {error && (
        <p role="alert">
          {ne
            ? "औषधिको विवरण खोज्न सकिएन।"
            : "Medicine references could not be loaded."}
        </p>
      )}
      {!busy && (error || results.some((r) => r.status === "unavailable")) && (
        <button
          type="button"
          className="btn btn-outline"
          onClick={() => setAttempt((a) => a + 1)}
        >
          {ne ? "फेरि खोज्नुहोस्" : "Retry lookup"}
        </button>
      )}
      <div className="document-medicines-list">
        {results.map((ref) => (
          <MedicineCard
            key={`${ref.name}:${attempt}`}
            reference={ref}
            ne={ne}
          />
        ))}
      </div>
    </section>
  );
}
