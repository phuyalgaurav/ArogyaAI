"use client";
import type { RuntimeStatus } from "@arogya/contracts";
import { useModel } from "@/features/settings/ModelContext";
export function ModelChoice({
  runtime,
  locale = "en",
  disabled = false,
  onChange,
}: {
  runtime: RuntimeStatus | null;
  locale?: "en" | "ne" | "tam";
  disabled?: boolean;
  onChange?: () => void;
}) {
  const ne = locale === "ne";
  const { model, choose } = useModel();
  const engine = runtime?.engines.find(
    (item) => item.id === (model === "bonsai" ? "bonsai" : "qwen_selector"),
  );
  const unavailable =
    engine && ["unconfigured", "unavailable"].includes(engine.state);
  return (
    <section className="model-choice" aria-label="Document and vision model">
      <label>
        {ne ? "पाठ पढ्ने मोडेल" : "Reading model"}
        <select
          value={model}
          disabled={disabled}
          onChange={(event) => {
            choose(event.target.value as typeof model);
            onChange?.();
          }}
        >
          <option value="bonsai">Bonsai 2 · 27B</option>
          <option value="qwen">Qwen · 0.8B</option>
        </select>
      </label>
      <p>
        {ne
          ? "दुवै विकल्प सर्भरमा चल्छन्। Bonsai ले बढी मेमोरी र समय लिन्छ; सानो Qwen ले जटिल हस्तलेखनमा बढी गल्ती गर्न सक्छ।"
          : model === "bonsai"
            ? "Main server model for prescription photos and document reading. Uses more computer memory and may take longer."
            : "Smaller model for lighter processing. Complex handwriting and documents may produce weaker results."}
      </p>
      <small>
        {engine
          ? `${engine.state === "ready" ? "Available" : engine.state === "busy" ? "Server is processing another request" : "Unavailable"} · ${engine.loaded ? "Loaded" : "Loads when requested"}`
          : "Server availability has not been confirmed"}{" "}
        · Both choices run on the Python computer. No silent model fallback.
      </small>
      {model === "bonsai" &&
        runtime?.host?.memory_bytes &&
        runtime.host.memory_bytes < 16 * 1024 ** 3 && (
          <p role="alert">
            This server reports under 16 GB RAM. Bonsai may run out of memory;
            consider the lighter Qwen option.
          </p>
        )}
      {unavailable && (
        <p role="alert">
          This model is unavailable. Check Tools & models or explicitly choose
          the other model.
        </p>
      )}
    </section>
  );
}
