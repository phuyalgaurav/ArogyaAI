# Backend and AI directive: contextual sessions, reliable recognition and Nepali voice

**Issued: 10 October 2026. Status: backend foundation implemented; product acceptance incomplete.**

Read this with [the frontend directive](FRONTEND_DIRECTIVE.md). This replaces all previous backend/AI tasks, architecture, model-choice, milestone, evaluation and feature documents. The documentation revision does not implement or validate these requirements.

## 1. Product boundary and immediate priorities

Support exactly the frontend’s five destinations: Dashboard, Prescription / Report transcription, Medicine info, Past chat records and Quick health question. Backend capabilities must serve these workflows rather than require extra patient-facing pages for OCR, language, sources or model management.

The main outcome is a persistent conversation: a person supplies a prescription, doctor’s note, report or medicine photo; reviews uncertain recognition; gets a useful explanation; asks follow-ups in Nepali speech or text; hears answers; and resumes the same session later.

Default heavy OCR/vision, explanation, retrieval, STT and TTS to the configured server. Browser preview, recording, playback and lightweight preparation remain local. On-device model loading is optional and must never block the primary server workflow.

## 2. Original baseline before the implementation below

The running UI and working-tree source were inspected on 10 October. The working tree contains existing frontend, model-profile and backend edits; investigate these before implementing changes. The running Python-served bundle may not match the latest web source. The initial documentation rewrite did not run a new accuracy evaluation. Section 11 records the subsequent implementation and measurements.

| Existing source | Established behavior | Gap to close |
| --- | --- | --- |
| `health/models.py: ChatRequest`, `main.py`, `health/service.py` | Chat accepts the latest message, optional medicine ID and processing permission. Answers depend on reviewed evidence. | No conversation ID, previous turns or attachment context in the chat request; history display does not create contextual reasoning. |
| `documents/service.py`, `documents/models.py` | Document explanation receives supplied text, kind and one optional question; uses line selection, meanings, exact quotes and safeguards. | No durable document session or multi-turn context. Standalone guide generation is insufficient. |
| `images/reader.py`, `images/ocr_process.py` | `/api/v1/images/read` uses native server Tesseract; separate browser Tesseract code also exists. | Printed OCR quality is not demonstrated for handwriting, layouts or medical fields. |
| `images/vision.py`, `inference/client.py`, `inference/bonsai.py` | `/api/v1/images/prescription` dispatches vision transcription to the configured Qwen/Bonsai profile. Qwen checks vision capability and passes image bytes. Both profiles use prepared images and bounded draft output. | Engine availability and valid JSON do not establish correct OCR. Actual input/model/preprocessing quality needs investigation. |
| `speech/engine.py`, `speech/worker.py`, `language-models.json` | Pinned Nepali speech models and translation adapters exist; public transcription/synthesis endpoints use separate permission scopes. | Whole-clip STT and bounded TTS do not by themselves produce a seamless contextual voice session or prove native-speaker quality. |
| `history/models.py`, `history/store.py`, `history/routes.py` and web history context | Local chat history and optional server history storage exist. Stored messages contain text and optional answer snapshots. | No attachment/review/document context model for continuing all core session types. |
| `MedicineView.tsx`, `/api/v1/medicines/resolve` | Medicine name lookup and candidate selection exist. | No complete medicine-image recognition and follow-up workflow. |

The inspected deployed Home reports zero approved sources. Do not claim that general health or medicine answers work merely because inference is available. Inventory the deployed catalog and distinguish missing evidence from model or network failure.

## 3. First investigate why transcription is poor

Treat the user’s report of poor OCR as an unresolved defect. Do not assume the intended OCR model is being called, or that a different prompt/model will solve it. Produce a reproducible investigation before choosing a replacement.

1. Trace the real request from the selected frontend action through the API, selected model profile, private worker and actual inference call. Confirm that original pixels reach a vision-capable model and that printed OCR does not accidentally handle a handwriting request. Check persisted frontend profile choices and backend defaults separately.
2. Record the actual engine/model revision, processor, requested mode and resulting mode. Compare the running frontend bundle with current source. Capture safe diagnostic metadata without logging patient image/text/audio content.
3. Inspect admission and preprocessing: EXIF orientation, rotation, resolution, crop, compression, contrast, blur and script/layout handling. Current vision preparation reduces images to a maximum 1536-pixel dimension and JPEG quality 90. Assess whether small handwriting is lost; test preservation or tiled/cropped inference rather than assuming resizing is harmless.
4. Validate the profile-specific image encoding, vision processor/template, prompt, structured-output constraints, output token budget and completion/truncation behavior. Current vision output is limited to 40 lines, 500 characters per line and 8,000 characters total. Never silently omit the rest of a page or report.
5. Compare native Tesseract, current Qwen vision and configured Bonsai vision on the same permissioned/synthetic reference set. Include English, Nepali Devanagari, mixed script, printed reports, handwritten notes, decimals, units and medicine labels. Report unsupported modes honestly.
6. Preserve reference text and human-labelled critical fields. Measure character/word errors, exact medicine-name/strength/unit/number/negation preservation, missed lines, hallucinated text and unreadable-region handling. Valid output shape is not an accuracy measure.
7. Select preprocessing, engine routing or a model change using these results. Document the reason, actual resources and remaining failure cases. Do not select a model only for its parameter count or replace a pinned model silently.

The inference chain must copy visible text, retain unknown regions and never invent missing medicines, instructions or values. Model self-confidence is not a calibrated certainty score. Return uncertainty with usable line/page/region references when available; do not manufacture bounding boxes for a model that only returns text.

## 4. Establish the shared conversation contract first

Frontend and backend must agree on versioned typed contracts before the UI depends on new capabilities. The following describe required semantics. Section 11 identifies the endpoints now implemented and their remaining limits. Reuse/extend existing routes where appropriate, but publish one coherent contract in `packages/contracts` and regenerate types during later implementation.

| Resource/operation | Required semantics |
| --- | --- |
| Conversation | Stable ID, owner/access boundary, mode (`document`, `medicine`, `health`), title, language, timestamps, context revision and storage policy. |
| Attachment | Stable ID, owning conversation, type, processing state, original reference, expiry/retention and derived transcription/identity references. Accept only declared supported formats and sizes. |
| Recognition job | Start/status/cancel/retry semantics; stage, request ID, result/error, actual engine revision and limits. Bound queue/concurrency/timeouts. |
| Reviewed context | Versioned extracted text, original source references, user corrections and accepted/uncertain fields; selected medicine with supporting identity evidence. |
| Turn submission | Conversation ID, unique/idempotent turn request ID, latest message, expected context revision, attachment references and applicable permissions. Resolve prior context within the authorized conversation. |
| Turn result/events | Ordered progress, text deltas if supported, final answer, document/source references, uncertainty, safety status and completed/cancelled/failed state. Partial output must never masquerade as a final verified answer. |
| Voice | Associate transcription and ordered speech chunks with the same conversation, turn and cancellation generation. Keep exact spoken text, language, actual model/processor identity and timings. |
| History | Paginated list/search, session detail, continuation and deletion; expose actual local/server saving and pending sync/deletion status. |
| Capabilities | Actual supported task modes, formats, languages, service availability and local-processing capability; distinguish installed, available, loaded and busy. |

Use stable errors for unavailable engine, unreadable image, uncertain identity, stale context, unsupported format/language, expired permission, busy service, oversized input, cancellation and missing evidence. Include retryability and a safe user-facing explanation. Frontend must not infer these states from generic success/failure text.

A conversation ID never grants access by itself. Check ownership on reads, turns, attachments, jobs and history actions. Keep existing scope-specific permissions and recheck revocation before returning results. Any extension to submitted/stored data needs an explicit corresponding permission contract; old text-only grants must not silently authorize attachment/history uploads.

## 5. Contextual document explanations and follow-ups

Maintain the original transcription and user-reviewed revision as distinct records. A corrected medicine name, unit or number must invalidate dependent interpretations and become the authoritative context for subsequent turns. Preserve original text and correction provenance under the chosen retention policy.

Resolve follow-ups using prior relevant turns, the active reviewed document(s), user selections and source references. Questions such as “Explain that line”, “Which part mentions my next visit?” and “What does this test term mean?” must refer to the existing context. Ask a clarification when “that” or the active document is ambiguous. Do not require the user to paste the full document again for every turn.

Separate visible transcription, quoted clinician instructions and general explanation. Produce useful plain-language explanations grounded in supplied passages and supported references rather than repeated generic reading-guide notices. Preserve exact names, decimals, units and instructions; identify the quoted source line/page for claims about the document. An OCR correction is not clinical verification.

Keep boundaries around diagnosis and changing/confirming a personal prescription. Provide supported educational explanations and explicit uncertainty; defer a personal treatment decision without replacing every useful response with a warning. Unresolved handwriting must prompt correction, another photo or professional clarification. Uploaded documents are untrusted content, not instructions to the system.

Bound context growth. Include relevant turns and reviewed text within the actual model budget, with versioned summaries/references where needed. Summaries must preserve critical details and disclose missing context. Never silently drop pages or use another session’s attachments.

## 6. Medicine visual recognition and continued questions

Implement medicine-photo processing as a first-class task within a medicine conversation. Recognize visible packaging/blister/label wording and compare against a supported catalog/source set. Keep observed text separate from candidate matches.

Return candidate name, active ingredient, strength, formulation and supporting observed label/source references when available. Represent no match, several candidates and partial identity explicitly. Appearance alone must not establish medicine identity. Unlabelled loose tablets or unreadable labels need a clear limitation and a request for useful packaging/imprint evidence rather than a confident guess.

Require the user’s identity review/selection before identity-dependent answers. Preserve that choice and its evidence/context revision across turns and history. Re-identification or a user correction must update context and invalidate stale downstream answers. Follow-up answers use the selected medicine, relevant earlier turns and reviewed sources. Missing catalog evidence must be reported without fabricated uses, interactions, dosage or contraindications.

The existing exact-name resolver is a component to reuse, not proof that this visual workflow exists. Build a real source-backed catalog sufficient for the intended demonstration/pilot and report its coverage separately from recognition quality.

## 7. Nepali speech must work end to end

Reuse the existing pinned adapters as a baseline and evaluate them with native Nepali speakers. Inspect model/processor configuration, language token, audio normalization, sample rate and channel conversion before attributing errors to the model itself.

- A recognized question must become a turn in the same document/medicine/health session. Return editable text, actual warnings and supported uncertainty; preserve names, numbers, units and negation.
- Provide clear listening/transcribing/thinking/speaking progress and cancellation. Use explicit stop/send alongside end-of-speech detection; validate silence/noise handling on phone microphones.
- Deliver text incrementally when the chosen inference path supports it. Generate TTS in ordered bounded chunks from the exact visible answer, with a first-audio response before the entire answer’s audio is complete where feasible. Do not cut away qualifications or alter meaning to fit chunk limits.
- Interruption must stop/ignore old speech and permit a new turn without duplicate inference, concurrent microphone feedback or stale playback. Cancellation must release or accurately report occupied worker capacity; browser abort alone is insufficient evidence of server cancellation.
- Avoid loading/unloading a large model on every tiny speech chunk. Investigate current serialized worker/model-switching behavior and measure cold/warm latency and memory before choosing scheduling changes.
- Preserve text mode if STT/TTS fails. No empty transcript may be sent as a question, and failed synthesis must not be reported as spoken audio.

Current transcription is whole-clip and current synthesis inputs are bounded; there is no proven full streaming voice service. Evolve transport/turn coordination as needed and state its actual behavior. Do not label turn-based audio as real-time streaming.

Measure recording-stop→transcript, send→first text, send→first audio, complete-turn latency and interruption delay under cold/warm server conditions and phone network conditions. Report p50/p95 with hardware, concurrency and sample counts. Have native speakers assess transcription correctness and spoken intelligibility, especially medical terms and critical quantities. Publish agreed quality/latency release thresholds after the baseline; do not invent passed targets.

## 8. Server-first processing and optional local loading

Route heavy tasks to the configured server by default, including phone clients. Use bounded queues, operation deadlines and clear busy/retry states. Reuse loaded models where safe, enforce memory/concurrency limits and manage owned worker processes. Report service readiness accurately; polling and patient requests must not trigger uncontrolled downloads.

Offer local model processing only for a declared supported task on a capable device, with explicit download size/storage impact and opt-in. Check support and resources, provide progress/cancel/removal and keep model assets versioned. Local printed OCR may remain an optional fallback; it must not be advertised as reliable handwriting recognition. If a local operation fails, server offload requires applicable permission and a visible mode change. Never silently upload material because local processing failed.

Offline mode can preserve permitted drafts/history and offer manual text work. Do not claim full offline explanation or voice when those models are unavailable. Loading/previewing a local file does not imply local inference.

## 9. History, retention and resumption

Extend history to all three conversation modes. Persist enough authorized context to resume: messages, reviewed transcription revision, chosen medicine and identity evidence, source references and attachment metadata. Do not store raw photos/audio by default merely because inference was allowed.

Keep the existing local-history and optional server-history choices distinct from processing consent. For local-only saved context, continuation may submit relevant context with explicit processing permission; for server-stored context, retrieve it under owned access. Choose and document one coherent resumption strategy for each storage mode rather than pretending a server can access browser-only history.

If originals are retained, define explicit consent, retention, protection and deletion semantics. If an original expires, preserve permitted reviewed text and show that the original is no longer available. Raw audio is unnecessary for ordinary history; the reviewed transcript can represent the user’s voice turn.

Delete session records and associated retained originals/derived context/jobs consistently. Keep offline server-deletion requests pending until acknowledged and prevent sync from restoring deleted sessions. Retain the current 30-day server-history policy unless a separately documented product decision changes it. Saved answers remain historical snapshots; revalidate evidence and permissions for new follow-ups.

## 10. Implementation order and proof required

1. Trace actual served/source behavior and reproduce the OCR defect. Establish baseline engine/quality/voice measurements and catalog coverage. Agree on the shared session, reviewed context, turn, recognition and voice contracts.
2. Deliver a real document vertical slice with corrected extraction, useful explanation, three or more contextual follow-ups, Nepali speech input/output and history resume. Integrate with the five-entry frontend before expanding features.
3. Deliver medicine-photo identity review and source-backed follow-ups using the same session/history machinery. Complete Quick health question with useful supported evidence.
4. Verify interruption/cancellation, persistence/deletion and physical-phone behavior. Add optional local model loading only after the server path meets acceptance.

Release evidence must include:

- The actual engine/model/processor revisions used for recognition and voice; a reproducible labelled reference set and critical-field error results. Engine checks and schema tests are reported separately from accuracy.
- Several document follow-ups before and after a transcription correction, including a pronoun referring to a previous answer; a second attachment; navigation/reload and saved-session continuation.
- Medicine image → ambiguous or supported candidate → user review → several follow-ups, with no accidental reuse of a previous medicine.
- Native-speaker Nepali text/audio review and real Android/iPhone microphone, playback, interruption and keyboard behavior, with latency/resource measurements.
- Permission denial/revocation, worker unavailable/busy, unreadable photo, missing evidence, timeouts, duplicate retry, stale context and deletion/sync checks.
- Appropriate backend/web tests, generated-contract checks and build checks, with explicit distinction between mocked/unit checks and real inference/device acceptance.

Do not mark the product complete from an HTTP 200, valid JSON, one synthetic prescription, generated speech transcribing itself, a model availability badge or a desktop screenshot. Document remaining failures and unsupported cases directly in the delivery report.

Primary backend locations are the domain packages under `services/api/src/arogya_api/`: `conversations`, `documents`, `images`, `health`, `history`, `speech`, `inference`, `knowledge`, `runtime` and `core`. `main.py` composes the API; `cli` owns setup/serving/evaluation commands; `resources` owns pinned manifests. Tests mirror these domains under `services/api/tests`; shared schemas/types remain in `packages/contracts`. Preserve working consent, source provenance, bounded execution and version validation while extending the workflows.


## 11. Implemented backend handoff — 10 October 2026

The new contextual API is additive. Existing single-operation image/document/chat/voice/history endpoints remain compatible. Application frontend code was not changed in this backend task. Restart both the API and private inference worker to load the new request contracts; the currently running primary services were not restarted during validation.

Canonical contracts are in `services/api/src/arogya_api/conversations/models.py`, with generated schemas/types in `packages/contracts`. All conversation data routes require the current session bearer token and return `Cache-Control: no-store`. For durable history, also send `X-History-Token` using an owned, enrolled history vault. A history key alone cannot authorize processing. The existing `/api/v1/history/*` data/delete endpoints use the history token as their bearer token; vault enrollment uses the session bearer. The new conversation API instead uses the session bearer plus `X-History-Token`.

| Method and path under `/api/v1/conversations` | Implemented behavior |
| --- | --- |
| `GET /capabilities` | Actual API transport/storage limits: server processing, whole-clip STT, ordered TTS chunks, no text streaming or local model inference. Use `/api/v1/runtime` for installed/loaded/busy model state and catalog coverage. |
| `POST /` (base path without trailing slash) | Create `document`, `medicine` or `health` conversation. Default is session memory until session expiry. `server_history` requires a history token and `allow_context_storage: true`; stores messages and reviewed context, never original photos/audio. |
| `GET /` (base path), `GET /{id}` | Search/filter/paginate summaries; retrieve context, attachments, correction revisions and ordered turns. |
| `POST /restore` | Submit a browser-saved snapshot into a new session after separate `conversation_restore` / `conversation_context` permission. Restored answers are explicitly historical/unverified; selected medicine identity is re-resolved from eligible catalog data. Restored turns cannot be replayed as fresh cached inference or synthesized as newly verified speech. |
| `POST /{id}/attachments/text` | Add text with a request ID, expected context revision, kind and document-processing permission. |
| `POST /{id}/recognitions` | Start a bounded image job with `vision` or explicit `printed_ocr`, actual model profile and image-processing permission. Pixels stay in flight; resulting text and provenance attach to the conversation. |
| `GET /{id}/recognitions/{job_id}` | Poll processing/completed/failed/cancelled status. Completed receipts can be reconstructed after restart from stored attachment metadata. |
| `PUT /{id}/attachments/{attachment_id}/review` | Confirm/correct text; append correction provenance; increment context revision. Medicine selection must match an eligible catalog candidate supported by the reviewed label. Changed text clears an unselected prior identity. |
| `POST /{id}/focus` | Select the active attachment explicitly and increment the context revision. |
| `POST /{id}/turns` | Idempotent request ID, expected context revision, optional attachment/line focus, language, selected model and processing consent. Document turns use reviewed text plus bounded previous questions/answer excerpts/references. Medicine/health follow-ups may select an eligible canonical reviewed question, then use the existing evidence-validated answer path. |
| `POST /{id}/speech/transcribe` | Return an editable Nepali transcript associated with the session/request/context; never auto-submit or persist raw audio. |
| `POST /{id}/speech/synthesize` | Synthesize an exact, losslessly split chunk from an owned Nepali turn; return turn/context/chunk identity and count. Reject stale contexts and unsupported spoken passages. Audio is not persisted. |
| `POST /{id}/cancel`, `DELETE /{id}` | Cancel the current operation; delete stored context and receipts. Vault/session deletion and expiry also purge associated state and prevent in-flight results from resurrecting it. |

Frontend sequence: create a conversation, add an image/text, poll recognition if needed, review the attachment, then submit turns using the returned `context_revision`. Keep `request_id` stable when retrying the same input; a changed input needs a new ID. Completed retries do not repeat inference. A cancelled/failed recognition can retry with the same input/request ID while its expected context still matches; re-upload its image because the server does not retain pixels. Preserve conversation snapshots locally only under the user's storage choice. After an expired/replaced session, use the separately permitted restore operation or the opted-in history vault.

Bounds: 8 attachments, 50 turns, 20 review revisions per attachment, 40 reviewed lines of at most 500 characters, 8,000 reviewed text characters, 800 KB per conversation, 16 MB/50 contextual conversations per history vault, and 64 MB total ephemeral conversation memory. The API fails with explicit limits rather than silently deleting earlier context. Ephemeral memory/jobs assume one API process; durable writes also use optimistic version checks. Original image retention, account synchronization, background job persistence across process loss and browser model loading are not implemented.

### Recognition investigation results

`scripts/evaluate/recognition.py` compares actual native Tesseract, Qwen vision and Bonsai vision on the same synthetic printed fixtures. It also accepts an explicit reference manifest for permissioned real images. The current trace confirms separate printed OCR and vision calls; Qwen receives prepared image bytes and checks vision capability. No claim of a confirmed wrong-model dispatch or reliable handwriting is made.

| Reader | English fixture WER | Nepali fixture WER | Mixed label WER | Critical-field observation |
| --- | --- | --- | --- | --- |
| Native Tesseract | 0.000 | 0.556 | 0.222 | Did not preserve exact `१२.५ g/dL` on the Nepali fixture. |
| Qwen vision | 0.000 | 0.444 | 0.111 | Preserved the declared test names, strengths, value and weekday; other wording errors remained. |
| Bonsai vision | 0.000 | 0.111 | Failed, HTTP 503 | Preserved the declared critical terms on the two successful fixtures; mixed-label result was not accepted. |

Observed image times were approximately 0.36–0.39 s for native Tesseract, 3.97–4.17 s for Qwen and 33–35 s for Bonsai, including model switching/loading in this run. These are three local synthetic printed samples, not accuracy thresholds, clinical acceptance, native-speaker review, or p50/p95 load results. The 1536-pixel vision preprocessing is unchanged pending a real small-handwriting reference comparison. Model replacement was not justified by this limited set.

Both public image routes and conversation recognition return the actual method/engine/revision and unverified/illegible warnings. Medicine photos use a label-specific prompt; visible strengths are observations, not prescriptions. Explicit page-limit markers are rejected. Draft explanations reject quantities absent from their source line, with Nepali/Latin digit normalization. This mechanical guard cannot prove semantic or clinical correctness.

### Verified vertical slice and remaining acceptance

`scripts/verify/conversations.py` exercised actual HTTP API, Qwen vision/document inference and installed Nepali speech services using a synthetic image. It passed image recognition, text review, three contextual follow-ups (including “Explain that line”), an idempotent retry, correction from Friday to Monday, Nepali synthesis, transcript delivery, history continuation from a new session, and deletion. Across the two local runs, follow-up calls took about 0.66–1.27 s and first synthesis took 1.30–2.67 s. Its TTS-to-STT round-trip contained substantial transcription errors; it is integration evidence, not voice-quality acceptance.

Validation before the structure cleanup: 239 backend tests, including 23 contextual API checks; Ruff; schema/type contract checks; frontend TypeScript typecheck. Test fixtures use mocked inference for failure/ownership/concurrency cases; the separate vertical slice uses real installed models. Receipts, synthetic images and WAV files remain ignored under `.local/backend-directive-validation/`. Reproduce by running the evaluation script first, then the conversation script against an API/private worker loaded from the changed source. The default vertical-slice image path is the fixture created by that evaluation run; `--image`/`--api` allow explicit alternatives.

Still required before product acceptance: frontend integration with the five-entry shell and mobile conversation UI; a permissioned handwritten/reference corpus; independent native Nepali microphone/pronunciation review; physical Android/iPhone interruption/network validation; a real clinically reviewed medicine/health catalog (the current deployed catalog remains empty); and production concurrency/resource/latency thresholds. No free-form clinical-answer mode or fabricated reviewed content was introduced to bypass those gaps.


## 12. Structure cleanup — 10 October 2026

Runtime modules are grouped by domain, each keeping its models, routes and services together. The former mixed `models.py` was split across `core`, `health`, `knowledge` and `inference`. Setup/admin commands live in `cli`; model manifests live in `resources`; test corpora/images live in `tests/fixtures`. Source fingerprints traverse all domain packages. Development/CLI entrypoints in `package.json` use the new paths.

Removed the unused `OCRField`/`PrescriptionExtraction` prototype, its generated contract and six tests that only validated that inactive schema. Current image/document/conversation contracts and all runtime safety checks remain. Runtime speech checksum validation no longer imports a setup command. Gateway and both workers were smoke-tested from an extracted wheel outside the checkout to verify packaging/resource paths. The cleanup passes 233 backend tests; the frontend passes 20 tests after removing the standalone API test that did not exercise application code.


## 13. Frontend integration and remaining work

The remote five-destination frontend is now connected to the contextual endpoints through `apps/web/src/features/conversations`. `ConversationCreate.id` optionally accepts a validated 32-character lowercase hex client history ID so the browser, message archive and contextual vault use one identity. IDs remain scoped to the authenticated owner; a duplicate create is rejected, and the client retrieves an existing owned conversation before retrying creation.

Document and medicine recognition jobs, reviewed attachments, revision-aware follow-ups, local snapshot restoration, STT and turn-bound TTS are wired into the UI. Browser SQLite exports include reviewed-context snapshots; deletion removes those snapshots and the corresponding contextual server record when available. History sync retrieves opted-in contextual conversations, honors local deletion tombstones and uses the history token separately from processing-session authorization. Existing local contexts are not automatically migrated into durable storage when history is enabled.

Validation includes owner-scoped client IDs, real SQLite context export/delete checks, production client authorization/error/cancellation checks, and live browser workflows against Qwen with synthetic inputs. No new reviewed clinical content was invented. The empty catalog still blocks medicine/general medical answers. Speech and handwriting quality remain unaccepted, and a single-process gateway is still required for ephemeral job coordination.

## 16. Public education and per-conversation user context — 10 October 2026

Do not make the complete health workflow depend on an empty clinical catalog. `health/references.py` provides original, bounded English/Nepali summaries grounded in linked WHO/NHS pages, with question aliases and a six-month expiry. It is separate from the reviewed-source database, clinical activation, medicine identity and signed offline bundles. `public_reference` is ineligible for clinical source activation or medicine catalog use. Public summaries contain no invented reviewers or review timestamps.

`GET /knowledge/questions?include_public=true` includes these education questions; the default remains reviewed-only. `GET /knowledge/sources/{source_id}` resolves their citations and exposes their distinct status. Contextual question selection considers aliases and previous turns, rejects unrelated topics, then extracts validated sentences. Emergency, dosing and individual treatment checks remain ahead of inference. Unsupported questions report a missing matching reference rather than claiming the entire health feature is disabled.

`ConversationCreate` accepts up to 4,000 characters of `user_context` only with explicit `include_user_context` permission. Store that snapshot on the conversation, not a global user record. Requests for independent chats default to no context. Forward the included snapshot to question resolution, evidence selection and document interpretation as unverified background, never as source evidence or instructions. Direct chat requests enforce the same inclusion permission. Normal session consent, restore permission, expiry, owner isolation and server-history deletion continue to apply.

Device persistence holds profile notes and inclusion choices; the server receives only the selected snapshot for a permitted conversation. This release does not introduce authenticated cross-device user profiles, medical diagnosis, free-form treatment generation or a populated clinically reviewed medicine directory.
