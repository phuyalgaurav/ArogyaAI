"""Local model execution with one resident model, pinned files and bounded inputs."""

import base64
import gc
import io
import json
import re
import wave
from datetime import UTC, datetime
from pathlib import Path

from arogya_api.core.assets import sha256_file
from arogya_api.runtime.models import EngineRuntime, WorkerRuntime
from arogya_api.speech.models import SpeechResult, TranscriptionResult, TranslationResult

PINS = json.loads(
    (Path(__file__).resolve().parent.parent / "resources/language-models.json").read_text()
)
ENGINE_IDS = {"translation": "translation", "stt": "nepali_stt", "tts": "nepali_tts"}


def decode_clip(encoded):
    try:
        raw = base64.b64decode(encoded, validate=True)
        with wave.open(io.BytesIO(raw)) as audio:
            if (audio.getnchannels(), audio.getsampwidth(), audio.getframerate()) != (1, 2, 16000):
                raise ValueError
            frames = audio.getnframes()
            if not 4800 <= frames <= 320000 or audio.getcomptype() != "NONE":
                raise ValueError
            pcm = audio.readframes(frames)
            if len(pcm) != frames * 2:
                raise ValueError
        return pcm, frames / 16000
    except (ValueError, wave.Error, EOFError):
        raise ValueError("invalid_audio_clip") from None


def translation_warnings(original, translated, terms):
    def numbers(text):
        normalized = text.translate(str.maketrans("०१२३४५६७८९", "0123456789"))
        return re.findall(r"\d+(?:\.\d+)?", normalized)

    warnings = []
    if numbers(original) != numbers(translated):
        warnings.append("numbers_changed")
    if any(term not in translated for term in terms):
        warnings.append("protected_terms_changed")
    return warnings


class LanguageEngine:
    def __init__(self, directory):
        self.directory = directory
        self.available = {kind: self.verify(kind) for kind in ENGINE_IDS}
        self.active = None
        self.model = self.processor = None

    def verify(self, kind):
        if not self.directory:
            return False
        try:
            profiles = [kind, "stt_processor"] if kind == "stt" else [kind]
            return all(
                (self.directory / profile / name).stat().st_size == spec["bytes"]
                and sha256_file(self.directory / profile / name) == spec["sha256"]
                for profile in profiles
                for name, spec in PINS[profile]["files"].items()
            )
        except OSError:
            return False

    def runtime(self, busy=False):
        tasks = {"translation": "translation", "stt": "transcription", "tts": "speech_synthesis"}
        return WorkerRuntime(
            checked_at=datetime.now(UTC),
            engines=[
                EngineRuntime(
                    id=ENGINE_IDS[kind],
                    name=spec["repository"],
                    task=tasks[kind],
                    revision=spec["revision"],
                    loaded=self.active == kind,
                    state="busy"
                    if busy and self.available[kind]
                    else "ready"
                    if self.available[kind]
                    else "unavailable",
                    reason="Local, pinned, unreviewed language assistance."
                    if self.available[kind]
                    else "Run pnpm setup:language to prepare the pinned assets.",
                )
                for kind, spec in PINS.items()
                if kind in ENGINE_IDS
            ],
        )

    def load(self, kind):
        if not self.verify(kind):
            self.available[kind] = False
            raise ValueError("pinned_language_model_unavailable")
        if self.active == kind:
            return
        self.model = self.processor = None
        self.active = None
        gc.collect()
        path = self.directory / kind
        if kind == "tts":
            from kala_tts._infer import KalaEngine

            self.model = KalaEngine(
                path / "real_nepali_v02_kala.fp32.onnx",
                path / "config.json",
                path / "speaker_id_map.json",
            )
        else:
            import torch

            torch.set_num_threads(2)
            if kind == "translation":
                from transformers import FSMTForConditionalGeneration, FSMTTokenizer

                # The supplied conversion uses placeholder src/tgt Moses language codes.
                self.processor = FSMTTokenizer.from_pretrained(
                    path, langs=["en", "en"], local_files_only=True
                )
                self.model, audit = FSMTForConditionalGeneration.from_pretrained(
                    path, local_files_only=True, weights_only=True, output_loading_info=True
                )
                # This conversion contains legacy fused projections as well as all
                # HF attention projections. Keep the supplied HF mapping; reject
                # missing/randomly initialized weights or any other unused entry.
                allowed = {
                    f"model.encoder.layers.{layer}.{name}"
                    for layer in range(self.model.config.encoder_layers)
                    for name in (
                        "in_proj_weight",
                        "in_proj_bias",
                        "out_proj_weight",
                        "out_proj_bias",
                    )
                }
                if (
                    audit["missing_keys"]
                    or audit["mismatched_keys"]
                    or audit["error_msgs"]
                    or set(audit["unexpected_keys"]) != allowed
                ):
                    self.model = self.processor = None
                    self.available[kind] = False
                    raise ValueError("invalid_translation_checkpoint_mapping")
                self.model.eval()
            else:
                from transformers import WhisperForConditionalGeneration, WhisperProcessor

                self.processor = WhisperProcessor.from_pretrained(
                    self.directory / "stt_processor", local_files_only=True
                )
                self.model = WhisperForConditionalGeneration.from_pretrained(
                    path, local_files_only=True, use_safetensors=True
                ).eval()
                if self.processor.tokenizer.convert_tokens_to_ids("<|ne|>") != 50313:
                    raise ValueError("invalid_nepali_processor")
        self.active = kind

    def run(self, kind, payload):
        if kind == "stt":
            pcm, duration = decode_clip(payload.audio_base64)
            import numpy as np

            samples = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768
            if float(np.sqrt(np.mean(samples**2))) < 0.00005:
                raise ValueError("no_speech_detected")
        self.load(kind)
        spec = PINS[kind]
        identity = {"model": spec["repository"], "revision": spec["revision"]}
        if kind == "tts":
            if not re.search(r"[\u0900-\u097f]", payload.text):
                raise ValueError("nepali_text_required")
            raw = self.model.synthesize(payload.text, speaker=payload.speaker)
            with wave.open(io.BytesIO(raw)) as audio:
                duration = audio.getnframes() / audio.getframerate()
            result = SpeechResult(
                text=payload.text,
                speaker=payload.speaker,
                duration_seconds=duration,
                audio_base64=base64.b64encode(raw).decode(),
                **identity,
            )
        else:
            import torch

            with torch.inference_mode():
                if kind == "translation":
                    token = {"ne": "__ne__", "tam": "__ta__", "en": "__en__"}[
                        payload.target_language
                    ]
                    inputs = self.processor(token + " " + payload.text, return_tensors="pt")
                    if inputs.input_ids.shape[1] > 256:
                        raise ValueError("text_too_long_for_model")
                    output = self.model.generate(
                        **inputs, num_beams=5, max_new_tokens=128, max_time=45, early_stopping=True
                    )
                    text = self.processor.decode(output[0], skip_special_tokens=True).strip()
                    warnings = translation_warnings(payload.text, text, payload.protected_terms)
                    if (
                        output.shape[1] >= 129
                        or output[0][-1].item() != self.model.config.eos_token_id
                    ):
                        warnings.append("output_truncated")
                    result = TranslationResult(
                        text=text,
                        original_text=payload.text,
                        source_language=payload.source_language,
                        target_language=payload.target_language,
                        status="needs_review" if warnings else "draft",
                        warnings=warnings,
                        **identity,
                    )
                else:
                    inputs = self.processor(
                        samples,
                        sampling_rate=16000,
                        return_tensors="pt",
                        return_attention_mask=True,
                    )
                    output = self.model.generate(
                        inputs.input_features,
                        attention_mask=inputs.attention_mask,
                        language="nepali",
                        task="transcribe",
                        return_timestamps=False,
                        max_new_tokens=180,
                        max_time=45,
                        use_cache=True,
                    )
                    text = self.processor.batch_decode(output, skip_special_tokens=True)[0].strip()
                    result = TranscriptionResult(
                        text=text,
                        duration_seconds=duration,
                        processor_model=PINS["stt_processor"]["repository"],
                        processor_revision=PINS["stt_processor"]["revision"],
                        status="draft"
                        if output[0][-1].item() == self.model.config.eos_token_id
                        else "needs_review",
                        **identity,
                    )
        if not self.verify(kind):
            self.active = None
            self.model = self.processor = None
            self.available[kind] = False
            raise ValueError("language_model_changed_during_processing")
        return result
