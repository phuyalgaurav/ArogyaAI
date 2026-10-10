"use client";

import { useEffect, useState } from "react";
import { DEMO_MEDICINES } from "@/features/documents/lib/demo-prescription";
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
  const [imageSrc, setImageSrc] = useState(ref.image_url);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageSrc(ref.image_url);
    setImageFailed(false);
  }, [ref.image_url]);

  return (
    <article className="document-medicine-card">
      <div className="document-medicine-image">
        {imageSrc && !imageFailed ? (
          // biome-ignore lint/performance/noImgElement: External and local demo label images
          <img
            src={imageSrc}
            alt={ref.image_description}
            loading="lazy"
            onError={() => {
              if (imageSrc.startsWith("/content/")) {
                setImageSrc(imageSrc.replace("/content/", "/contents/"));
              } else {
                setImageFailed(true);
              }
            }}
          />
        ) : (
          <span>{ne ? "तस्बिर उपलब्ध छैन" : "Image unavailable"}</span>
        )}
      </div>
      <div className="document-medicine-body">
        <h4>{ref.name}</h4>
        {ref.status === "found" ? (
          <>
            <p className="document-medicine-desc">{ref.description}</p>
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
          <p className="document-medicine-desc">
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: Serialized names and locale provide stable dependencies
  useEffect(() => {
    const controller = new AbortController();
    const queries: string[] = JSON.parse(key);
    setResults([]);
    setError(false);
    if (!queries.length) return;

    // Check for local demo medicines first
    const localMatches: Reference[] = [];
    const remoteQueries: string[] = [];

    for (const q of queries) {
      const lower = q.toLowerCase();
      let matchedKey: string | null = null;
      if (lower.includes("augmentin")) matchedKey = "augmentin";
      else if (lower.includes("enzoflam")) matchedKey = "enzoflam";
      else if (lower.includes("pan-d") || lower.includes("pand"))
        matchedKey = "pan-d";
      else if (lower.includes("hexigel")) matchedKey = "hexigel";

      if (matchedKey && DEMO_MEDICINES[matchedKey]) {
        const item = DEMO_MEDICINES[matchedKey];
        localMatches.push({
          name: q,
          status: "found",
          title: item.title,
          description: ne ? item.description_ne : item.description_en,
          image_url: item.image_url,
          image_description: item.image_description,
          source_url: item.source_url,
        });
      } else {
        remoteQueries.push(q);
      }
    }

    if (remoteQueries.length === 0) {
      setResults(localMatches);
      setBusy(false);
      return;
    }

    setBusy(true);
    void fetch(`${getApiBaseUrl()}/api/v1/medicines/references`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ names: remoteQueries }),
      signal: controller.signal,
      credentials: "omit",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("lookup_failed");
        return response.json() as Promise<Reference[]>;
      })
      .then((data) => {
        if (!controller.signal.aborted) {
          setResults([...localMatches, ...data]);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          if (localMatches.length > 0) {
            setResults(localMatches);
          } else {
            setError(true);
          }
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });

    return () => controller.abort();
  }, [key, attempt, ne]);
  if (!names.length) return null;
  return (
    <section
      className="document-medicines"
      aria-labelledby="document-medicines-heading"
    >
      <h3
        id="document-medicines-heading"
        className="document-medicines-heading"
      >
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
