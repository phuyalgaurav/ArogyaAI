# Functionality improvement review

**Current update:** See the final section, “10 October update: health education and explicitly included user context,” for the implemented fixes and current validation. The original findings below retain their inspection-time evidence.

**Reviewed:** 10 October 2026, Asia/Kathmandu  
**Scope:** Current working-tree frontend, Python API, shared contracts, existing tests, and the locally running application.  
**Deliverable:** Findings and improvement recommendations only; application implementation was not changed by this review.

The app has working conversation APIs and useful document follow-ups, but passing automated checks does not yet establish complete user workflows. The most consequential issues concern processing-location choices, lost drafts, stale document explanations, conversation navigation, session renewal, and truthful deletion results. General health and medicine answers also depend on reviewed content that is currently unavailable in the inspected development catalog.

## Evidence and boundaries

The repository contained substantial staged and unstaged work when inspection began, and source changes continued during the review. References below describe the working-tree implementation inspected during this session, rather than only the base commit `7d3b105`. Several references were refreshed after ongoing changes. Re-run the listed reproductions after subsequent changes before closing a finding.

Two running versions were inspected:

| Surface | Observed behavior |
| --- | --- |
| `http://127.0.0.1:3000` | Current five-destination frontend; its same-origin API exposes contextual conversations. |
| `http://127.0.0.1:8000` | Older eleven-destination Python-served frontend; `/api/v1/conversations/capabilities` returned HTTP 404. The running gateway process comes from a separate Codex worktree. |

The development API returned `reviewed_sources: 0`, `reviewed_questions: 0`, and `free_form_answers: false`. Its knowledge manifest contained no sources or bundles. Qwen, document vision, printed OCR, and Nepali speech engines reported availability independently of that empty catalog. Availability responses alone do not establish output quality.

Only synthetic text was submitted during this review. Browser testing added a synthetic document conversation and a synthetic health conversation to the development browser's local history. Existing records were not deleted. No personal medical documents were uploaded, and no running services were restarted.

### Checks performed

| Check | Result | What it establishes |
| --- | --- | --- |
| `pnpm test:web` | **23 passed** | Existing transport, SQLite, document-text, image, audio, device, and voice-turn helper checks pass. These are not rendered workflow tests. |
| `uv run --no-sync --project services/api python -m pytest services/api/tests -q` | **234 passed** | Existing backend tests pass. Inference substitutes and synthetic fixtures are used in relevant tests; this is not clinical or physical-device acceptance. |
| `pnpm typecheck` | **Passed** | Route generation and TypeScript checks pass for the inspected source. |
| `pnpm contracts:check` | **Passed** | Generated schemas and TypeScript contracts match the Python models. |
| `pnpm lint` | **Passed with 4 CSS specificity warnings** | Biome and Ruff complete without errors; no automatic fixes were applied. |
| Browser: document text, review, explanation, follow-up, resumption | **Mixed** | A literal follow-up returned the correct quoted line; the initial explanation returned a contradictory no-answer notice. |
| Browser: draft navigation, history New chat, skip link, privacy dialog, Nepali selection | **Issues reproduced** | Detailed below. |
| Browser/API: health question and medicine search | **Catalog limitation reproduced** | Health returned Evidence Unavailable; Paracetamol search returned no candidate. |

A production build was not run, and the old Python-served build was not replaced. This review did not establish handwriting accuracy, medicine identification accuracy, microphone recognition/pronunciation quality, real Android/iPhone behavior, network interruption recovery, multi-user load behavior, or successful server-history synchronization/deletion. No new regression tests were added as part of this documentation task.

**Evidence labels:** **Reproduced** means observed in the browser or through a live API request. **Source-confirmed** means the relevant implementation path is present, but its failure scenario was not exercised live. **Acceptance gap** means a required capability still lacks sufficient evidence; it is not automatically a confirmed defect.

## Prioritized findings

P1 means resolve before treating the affected workflow as ready for users. P2 means a functional or recovery defect that should follow the P1 work. These priorities describe product readiness, not a claim that each issue affects every request.

| ID | Priority | Finding | Evidence |
| --- | --- | --- | --- |
| F01 | P1 | The image-processing location setting does not control the image workflow | Source-confirmed |
| F02 | P1 | Unfinished document drafts disappear on navigation | Reproduced |
| F03 | P1 | New chat from history can reopen the previous chat | Reproduced |
| F04 | P1 | Editing reviewed text leaves the previous explanation visible without a stale marker | Source-confirmed |
| F05 | P1 | Session renewal can reuse a consent belonging to the expired session | Source-confirmed |
| F06 | P1 | Session deletion reports success after a failed server request | Source-confirmed |
| F07 | P1 | The Python-served app and development app expose different functionality | Reproduced |
| F08 | P1 | Reviewed health and medicine content is unavailable in the inspected catalog | Reproduced; content/deployment blocker |
| F09 | P2 | Initial document explanation is submitted as a question and can return no match | Reproduced |
| F10 | P2 | Skip to content changes the active workflow to Dashboard | Reproduced |
| F11 | P2 | Contextual dialogs lack complete keyboard and navigation behavior | Reproduced and source-confirmed |
| F12 | P2 | Nepali UI selection and document response language drift apart | Reproduced |
| F13 | P2 | Document and medicine microphone failures are not surfaced | Source-confirmed |
| F14 | P2 | Retry and stale-context recovery are incomplete across the frontend | Source-confirmed |
| F15 | P2 | Medicine lookup failure is also presented as an empty search result | Source-confirmed |
| F16 | P2 | History search omits reviewed attachment text and uses generic record titles | Source-confirmed; generic titles observed |

## Detailed findings and acceptance checks

### F01 — Make the processing-location choice authoritative

**Evidence:** [page.tsx:70](/Users/gauravphuyal/hacks/arogyaAI/apps/web/src/app/page.tsx:70), [DeviceProcessing.tsx:152](/Users/gauravphuyal/hacks/arogyaAI/apps/web/src/features/settings/DeviceProcessing.tsx:152), [TranscriptionView.tsx:142](/Users/gauravphuyal/hacks/arogyaAI/apps/web/src/features/documents/TranscriptionView.tsx:142), [SessionContext.tsx:129](/Users/gauravphuyal/hacks/arogyaAI/apps/web/src/context/SessionContext.tsx:129).

The Tools & models dialog offers “On this device” and says image pixels stay here. That selection is stored in `MainContent` and passed to the diagnostics component, but is not passed into `TranscriptionView`. Selecting a document image automatically calls server recognition, including automatic creation of an image-processing consent when necessary. The separate local printed-text button becomes available after a file has already been selected through this path.

This makes the location choice misleading and defeats an expectation that selecting local reading will keep image pixels on the device. The current upload handler also lacks the promised separate preview-and-permission step before the first server transfer.

**Improve:** Route image admission through the selected processing policy. For local mode, initialize only the declared local printed-text reader. For server mode, show the destination and obtain the applicable processing choice before sending pixels. Keep local failure recovery explicit.

**Acceptance:** Select local mode, choose a synthetic image, and verify that no recognition/upload request is sent to the server. Trigger local failure and verify that pixels remain local until the user explicitly chooses server processing. Selecting server mode should provide a clear permission and cancellation path.

### F02 — Preserve unfinished drafts by conversation

**Reproduction:** Open transcription, choose Paste document text, enter a synthetic report without submitting it, switch to Medicine info, and return. The transcription workflow reopens in image mode with an empty draft.

**Evidence:** [page.tsx:242](/Users/gauravphuyal/hacks/arogyaAI/apps/web/src/app/page.tsx:242), [TranscriptionView.tsx:62](/Users/gauravphuyal/hacks/arogyaAI/apps/web/src/features/documents/TranscriptionView.tsx:62), [TranscriptionView.tsx:78](/Users/gauravphuyal/hacks/arogyaAI/apps/web/src/features/documents/TranscriptionView.tsx:78).

Workflow views are conditionally mounted, while unfinished text, input mode, image preview, and follow-up input live in component state. The parent draft field is not updated when the user edits the document. Saved server snapshots can recover submitted content, but do not preserve these unfinished changes.

**Improve:** Keep drafts under their conversation ID in shared state, with persistence governed by the chosen storage policy. Preserve input mode and review state along with the text. If unsaved work cannot be retained, explain that before discarding it.

**Acceptance:** Typed text, transcription corrections, and an unfinished question survive workflow changes and returning to the same conversation. Starting a new conversation explicitly clears its draft without carrying another conversation's state across.

### F03 — Create a fresh conversation without restoring a cached workflow ID

**Reproduction:** Submit a synthetic health question, open Past chat records, and click “+ New chat.” The previous health conversation remains visible after navigation to Quick health question.

**Evidence:** [page.tsx:131](/Users/gauravphuyal/hacks/arogyaAI/apps/web/src/app/page.tsx:131), [page.tsx:268](/Users/gauravphuyal/hacks/arogyaAI/apps/web/src/app/page.tsx:268).

The history callback calls `history.newChat()` and then `open("chat")`. The latter can select `workflowIds.current.chat`, replacing the newly created ID with the previous workflow ID.

**Improve:** Make new-conversation navigation one explicit operation that updates the active ID and workflow mapping together. Distinguish it from navigation that resumes an existing workflow.

**Acceptance:** Clicking New chat from history opens an empty conversation with a different ID. The next submission creates messages only in that new record, and the old record remains independently resumable.

### F04 — Mark explanations stale immediately when their source text changes

**Evidence:** [TranscriptionView.tsx:250](/Users/gauravphuyal/hacks/arogyaAI/apps/web/src/features/documents/TranscriptionView.tsx:250), [TranscriptionView.tsx:777](/Users/gauravphuyal/hacks/arogyaAI/apps/web/src/features/documents/TranscriptionView.tsx:777), [TranscriptionView.tsx:855](/Users/gauravphuyal/hacks/arogyaAI/apps/web/src/features/documents/TranscriptionView.tsx:855).

Editing the document resets the review checkbox but leaves `explanationResult` and the previous reading guide displayed. The UI does not compare the guide's `document_sha256` with the edited draft. Older conversation answers also remain displayed without an explicit distinction from the current text revision.

The backend requires reviewed context for new answers, which is useful protection. The remaining UI problem is that an explanation for an old number, instruction, or medicine wording can sit beside changed text as if it still applies.

**Improve:** Associate displayed guides and speech with their attachment and text revision. On an edit, label existing results as belonging to the previous reviewed text and require review before generating a current explanation. Historical answers can remain visible with their original revision identified.

**Acceptance:** Change a synthetic report value or follow-up day after an explanation. The old guide is immediately marked stale, cannot be presented as the current explanation, and is replaced only after the corrected text is reviewed.

### F05 — Renew session identity and scoped permission together

**Evidence:** [SessionContext.tsx:90](/Users/gauravphuyal/hacks/arogyaAI/apps/web/src/context/SessionContext.tsx:90), [SessionContext.tsx:240](/Users/gauravphuyal/hacks/arogyaAI/apps/web/src/context/SessionContext.tsx:240), [ConversationContext.tsx:127](/Users/gauravphuyal/hacks/arogyaAI/apps/web/src/features/conversations/ConversationContext.tsx:127), [ChatView.tsx:397](/Users/gauravphuyal/hacks/arogyaAI/apps/web/src/features/chat/ChatView.tsx:397), [TranscriptionView.tsx:271](/Users/gauravphuyal/hacks/arogyaAI/apps/web/src/features/documents/TranscriptionView.tsx:271).

The global active-consent calculation checks the consent expiry but does not include session expiry. A consent granted after session creation can therefore still appear active when that session expires. Conversation initialization can renew the session while a caller continues to use a captured consent ID from the earlier identity. Document handlers similarly read their captured consent after awaiting session initialization.

The API checks consent ownership, so the expected failure is rejected processing rather than unauthorized acceptance. However, a user can encounter a permission error immediately after an apparently successful renewal. Some speech handlers also reuse grants without checking their expiry.

**Improve:** Resolve the live session and required consent as one operation, returning a matching token/grant pair. Invalidate identity-bound caches and permission displays on expiry, replacement, and deletion. Do not rely on the ten-second expiry polling interval for request correctness.

**Acceptance:** With a controlled clock, expire the session while a later consent remains within its own expiry. Resume document, medicine, health, and speech workflows. Each must obtain permissions belonging to the new identity or show a clear permission step, without repeated 401/403 failures or lost input.

### F06 — Report deletion success only when the server confirms it

**Evidence:** [SessionContext.tsx:221](/Users/gauravphuyal/hacks/arogyaAI/apps/web/src/context/SessionContext.tsx:221), [PrivacyView.tsx:50](/Users/gauravphuyal/hacks/arogyaAI/apps/web/src/features/settings/PrivacyView.tsx:50).

`deleteSession()` catches and ignores every server deletion error, then drops the token and resolves normally. `PrivacyView` consequently displays its deletion-success message even when server cleanup failed. Losing the token also removes the immediate ability to retry that same session deletion.

This finding concerns processing-session data. The UI already explains that saved chat history has separate controls; those scopes should stay explicit.

**Improve:** Return a truthful deletion result, distinguish local sign-out from confirmed server erasure, and retain a bounded retry path when cleanup is pending. Apply the same precision to permission-revocation status.

**Acceptance:** Simulate an offline connection and a server error during session deletion. The UI must identify pending server cleanup and offer recovery. Show success only after a confirmed successful deletion response. Exercise this with isolated test sessions, not user records.

### F07 — Verify the build actually being served

**Reproduction:** Open ports 3000 and 8000. The development app has Dashboard and five destinations; port 8000 has Home and eleven destinations. The conversation-capabilities endpoint succeeds through port 3000 and returns 404 on port 8000.

**Evidence:** Live browser and HTTP observations; [README.md](/Users/gauravphuyal/hacks/arogyaAI/README.md), [serve.py:36](/Users/gauravphuyal/hacks/arogyaAI/services/api/src/arogya_api/cli/serve.py:36).

The inspected port-8000 gateway process originates from another worktree. This is a running-version mismatch, not evidence that a new build of the current source necessarily fails.

**Improve:** Add a build/version identifier to frontend and API diagnostics. Rebuild and restart the intended deployment from the intended checkout when preparing release evidence. Check the served static bundle and required API endpoints together.

**Acceptance:** The chosen deployment URL serves the current five-destination frontend and contextual APIs from compatible versions. Record its commit/build identifier and validate the actual URL used on the phone. Do not close this issue using only port-3000 screenshots or source inspection.

### F08 — Establish reviewed-content readiness per task

**Reproduction:** A synthetic health query returned “Evidence Unavailable” and explained that the English reviewed library has no available questions. Searching for Paracetamol returned no approved candidate. Runtime and manifest requests confirmed an empty reviewed source/question catalog.

**Evidence:** `GET /api/v1/runtime` and `GET /api/v1/knowledge/manifest` through the development origin; [TaskHome.tsx:96](/Users/gauravphuyal/hacks/arogyaAI/apps/web/src/components/layout/TaskHome.tsx:96).

An available model is insufficient for reviewed health and medicine answers. The dashboard currently bases its service warning on whether any engine is ready and does not communicate this content blocker at task entry.

**Improve:** Provide the real, licensed, clinically reviewed content required by supported tasks. Show task-specific readiness for catalog, model, and language coverage. While content is unavailable, retain the explicit Evidence Unavailable result and explain the limitation before submission. Do not populate clinical answers with fabricated demonstration content.

**Acceptance:** Approved catalog entries resolve with provenance in each supported language, including expiry/revocation behavior. Unmatched and unavailable cases stay distinct. Until that evidence exists, treat health and medicine answer acceptance as blocked even if inference is ready.

### F09 — Give initial document explanation its own operation semantics

**Reproduction:** Paste and review this synthetic text:

```text
Synthetic functionality audit report
Follow-up: Monday
Hb: 12.5 g/dL
```

Click Explain this document in plain language. The conversation returned “No clear answer to this question was found…” while the reading guide still contained copied lines and definitions. A subsequent “Which line mentions follow-up?” returned the correct `L2` quote.

**Evidence:** [TranscriptionView.tsx:318](/Users/gauravphuyal/hacks/arogyaAI/apps/web/src/features/documents/TranscriptionView.tsx:318), [documents/service.py:109](/Users/gauravphuyal/hacks/arogyaAI/services/api/src/arogya_api/documents/service.py:109), [documents/service.py:133](/Users/gauravphuyal/hacks/arogyaAI/services/api/src/arogya_api/documents/service.py:133).

The initial action sends the nonempty question “Explain the wording of this document.” The backend's question-matching path can classify that as no match even though a general reading guide is available.

**Improve:** Represent a general explanation separately from a targeted question, and make response status agree with the content displayed. Preserve no-match results for actual unanswered questions.

**Acceptance:** Initial explanation of the synthetic text returns a coherent reading-guide state. Targeted questions select the correct lines, and absent information returns a clear no-match state. Verify both English and Nepali.

### F10 — Keep the skip link inside the current workflow

**Reproduction:** From transcription, activate Skip to content using the keyboard. The hash becomes `#main` and the page switches to Dashboard.

**Evidence:** [page.tsx:36](/Users/gauravphuyal/hacks/arogyaAI/apps/web/src/app/page.tsx:36), [page.tsx:103](/Users/gauravphuyal/hacks/arogyaAI/apps/web/src/app/page.tsx:103), [page.tsx:207](/Users/gauravphuyal/hacks/arogyaAI/apps/web/src/app/page.tsx:207).

The routing listener treats the content anchor as an unknown destination and defaults to Dashboard. This changes the user's task and can also trigger draft loss.

**Improve:** Separate content anchors from workflow routing. Move focus to the current main content without changing its conversation or destination.

**Acceptance:** Keyboard activation on every destination lands at that destination's main content and preserves its URL routing state, conversation ID, and draft.

### F11 — Complete dialog focus, close, and navigation behavior

**Reproduction:** Open Privacy & Data. Escape leaves the dialog open. Pressing Tab from the trigger moves focus to the background Tools & models control. The dialog's history link changes the underlying destination while the privacy overlay remains open.

**Evidence:** [page.tsx:288](/Users/gauravphuyal/hacks/arogyaAI/apps/web/src/app/page.tsx:288), [PrivacyView.tsx:87](/Users/gauravphuyal/hacks/arogyaAI/apps/web/src/features/settings/PrivacyView.tsx:87).

Privacy, tools, and source overlays use conditional `div` elements with dialog roles, without the complete modal lifecycle. Declaring `aria-modal` does not itself move or contain keyboard focus.

**Improve:** Use one accessible dialog implementation with initial focus, focus containment, Escape closing, background isolation, focus restoration, and intentional handling of links to other destinations.

**Acceptance:** Keyboard-only users can open, use, and close every dialog; background controls cannot receive focus while it is open. The privacy history link closes the dialog and opens history. Focus returns to a meaningful control after closing.

### F12 — Make response language and Nepali localization predictable

**Reproduction:** Resume the English synthetic document and switch the global language to Nepali. Navigation and headings change to Nepali, but the document's explanation-language selector stays English. Image-reader choices, review labels, and microphone actions also retain English text.

**Evidence:** [TranscriptionView.tsx:65](/Users/gauravphuyal/hacks/arogyaAI/apps/web/src/features/documents/TranscriptionView.tsx:65), [TranscriptionView.tsx:578](/Users/gauravphuyal/hacks/arogyaAI/apps/web/src/features/documents/TranscriptionView.tsx:578), [PrivacyView.tsx:184](/Users/gauravphuyal/hacks/arogyaAI/apps/web/src/features/settings/PrivacyView.tsx:184).

The response-language state is initialized from locale once. Later global changes do not update it. Preserving historical answers in their original language is reasonable, but new-answer language needs a clear policy and visible control.

**Improve:** Define whether the global language controls new responses or only the interface. Synchronize the response language accordingly, with an explicit override if needed. Translate task controls, errors, permission descriptions, and voice states. Keep unsupported-language previews clearly identified.

**Acceptance:** After switching to Nepali, a newly requested document answer uses the visibly selected language. Fluent-speaker review covers the entire task and recovery path. Earlier English answers remain clearly identifiable as historical English content.

### F13 — Surface recorder failures in document and medicine workflows

**Evidence:** [use-recorder.ts:89](/Users/gauravphuyal/hacks/arogyaAI/apps/web/src/features/speech/hooks/use-recorder.ts:89), [use-recorder.ts:186](/Users/gauravphuyal/hacks/arogyaAI/apps/web/src/features/speech/hooks/use-recorder.ts:186), [TranscriptionView.tsx:1019](/Users/gauravphuyal/hacks/arogyaAI/apps/web/src/features/documents/TranscriptionView.tsx:1019), [MedicineView.tsx:808](/Users/gauravphuyal/hacks/arogyaAI/apps/web/src/features/medicines/MedicineView.tsx:808).

The recorder hook records errors for unavailable recording, denied permission, failed capture, and audio conversion. The document and medicine views render recording/transcribing states but do not consume `recorder.error` or its preparing state. Users can click Speak and receive no visible explanation when capture fails. Some hook error messages suggest choosing an audio file, but those workflow composers do not provide that action.

**Improve:** Render and announce recorder errors beside the affected composer, show preparation state, and provide working retry and typed-input recovery. Keep suggested recovery actions aligned with controls actually present. Only offer read-aloud for eligible current Nepali turns.

**Acceptance:** Denied permission, unsupported/insecure browser context, capture failure, and conversion failure each produce an actionable visible message. Typed follow-ups remain usable. Physical-device speech quality requires a separate acceptance run.

### F14 — Recover the same operation after uncertain delivery

**Evidence:** [ConversationContext.tsx:257](/Users/gauravphuyal/hacks/arogyaAI/apps/web/src/features/conversations/ConversationContext.tsx:257), [ConversationContext.tsx:315](/Users/gauravphuyal/hacks/arogyaAI/apps/web/src/features/conversations/ConversationContext.tsx:315), [ConversationContext.tsx:378](/Users/gauravphuyal/hacks/arogyaAI/apps/web/src/features/conversations/ConversationContext.tsx:378), [conversations/api.ts:35](/Users/gauravphuyal/hacks/arogyaAI/apps/web/src/features/conversations/api.ts:35), [TranscriptionView.tsx:355](/Users/gauravphuyal/hacks/arogyaAI/apps/web/src/features/documents/TranscriptionView.tsx:355).

Text-attachment and recognition submissions generate new request IDs on each invocation, even when retrying after an uncertain response. A recognition job ID is not retained for recovery outside its active polling call. A completed operation whose response was lost can therefore be repeated or run into stale context. Repeated reads/rotations also create additional attachments and can exhaust the eight-attachment limit without an attachment-management flow.

Turn retries do preserve a request ID while pending, which should be retained. However, UI handlers clear question input early and append fresh local user messages before obtaining a result. Re-submitting can duplicate the local message even when the server deduplicates its turn. The transport also drops structured error codes and retryability, and no workflow exposes the provider's context-refresh method for stale-context recovery.

**Improve:** Track operation IDs, payload, originating conversation, and recognition job receipts until completion or deliberate replacement. Reconcile server state after uncertain delivery before resubmitting. Upsert local messages by operation ID. Retain error code/retryability and offer refresh/retry actions while preserving unsent input.

**Acceptance:** Drop the response after the server accepts an attachment or completes a turn. Retry without adding a duplicate attachment, inference call, or local user message. Recover from a missed recognition poll and a stale revision. Cancellation must leave the originating conversation usable without attaching late output elsewhere.

### F15 — Separate failed medicine lookup from no candidates

**Evidence:** [MedicineView.tsx:90](/Users/gauravphuyal/hacks/arogyaAI/apps/web/src/features/medicines/MedicineView.tsx:90).

On lookup failure, `executeSearch()` sets an error and also sets `candidates` to an empty list. The results renderer then displays the no-match card as well as the error. A technical failure is thus presented as evidence that no approved medicine matched.

**Improve:** Model idle, searching, successful-empty, successful-matches, and failed as separate states. Keep the query and provide Retry after failure. Label retained prior results with the query that produced them.

**Acceptance:** A network or 5xx error shows lookup unavailable with Retry and no no-match conclusion. A successful response with an empty candidate list alone shows no candidates. Changing the query cannot mislabel old results as new ones.

### F16 — Make saved records findable by their reviewed content

**Evidence:** [HistoryContext.tsx:317](/Users/gauravphuyal/hacks/arogyaAI/apps/web/src/features/history/HistoryContext.tsx:317), [HistoryView.tsx:95](/Users/gauravphuyal/hacks/arogyaAI/apps/web/src/features/history/HistoryView.tsx:95), [TranscriptionView.tsx:333](/Users/gauravphuyal/hacks/arogyaAI/apps/web/src/features/documents/TranscriptionView.tsx:333).

History search checks titles and message text, while full reviewed attachment text is stored separately. Initial document/medicine context can create a generic placeholder message and title. The document explanation's extra user message contains only the first 500 characters. Consequently, a unique term found only later in the reviewed text can be absent from search despite being present in the saved conversation. The synthetic document also appeared as the generic “[Prescription / Report conversation]” record.

**Improve:** Maintain a local search index and useful summary derived from saved reviewed context, within the existing storage limits. Preserve explicit workflow mode and let users rename records. Avoid treating implementation placeholders as real user turns when displaying message counts.

**Acceptance:** Save a document containing a unique term beyond its first 500 characters, reopen history, and find it by that term. The record title, workflow, preview, and displayed conversation count should describe the saved conversation accurately. Local deletion must remove its indexed text too.

## Recommended sequence

1. **Protect processing choices and continuity:** F01, F02, F03, F04, F05, F06. Add focused regressions for the proven navigation failures and identity/error paths.
2. **Establish the actual deployable product:** F07 and F08. Record the served build/API versions and approved catalog coverage before claiming health or medicine readiness.
3. **Complete task behavior and recovery:** F09 through F16. Reuse shared conversation, permission, error, and dialog behavior so document, medicine, and health workflows handle the same failure modes consistently.
4. **Run the remaining acceptance work:** Use permissioned reference images, fluent Nepali reviewers, and actual Android/iPhone devices. Measure recognition accuracy, microphone transcription, pronunciation, interruption recovery, resource limits, and latency against explicit thresholds.

## Acceptance still required

- [ ] Reproduce and close each finding against the chosen served build, recording which checks use synthetic fixtures and which use actual models/devices.
- [ ] Document, medicine, and health conversations each support three relevant follow-ups, review corrections, saving/reopening, and typed/voice transitions where the catalog permits answers.
- [ ] Poor handwriting, unreadable images, ambiguous medicine identity, absent evidence, unsupported files, and oversized input each produce truthful outcomes with working recovery.
- [ ] Permission denial/revocation/expiry, offline operation, busy services, cancellation, lost responses, and stale context preserve input and never duplicate or misroute a turn.
- [ ] Session deletion and opted-in history deletion distinguish confirmed erasure from pending cleanup, including interruption and retry.
- [ ] Keyboard and screen-reader users can complete review, navigation, dialogs, and error recovery; verify responsive behavior at phone widths and on real devices.
- [ ] The selected deployment serves compatible frontend/API versions and exposes task-specific readiness instead of inferring completion from model availability.

The existing automated checks provide a sound baseline for implementation work. Closing these findings requires demonstrated user behavior and recovery on the relevant running build.

## Implementation verification — 2026-10-10

- Image selection now waits for explicit reading permission. Device processing uses browser OCR without a silent server fallback. Medicine OCR waits for reviewed-label matching instead of showing an empty result immediately after extraction.
- Drafts survive workflow navigation in bounded tab memory. History New chat starts a fresh health conversation. Edited document text clears the active guide; matching reviewed text can reopen its existing guide and follow-up composer.
- Renewed sessions use newly bound permissions. Failed session deletion retains retry access and reports failure. Native dialogs support Escape and focus restoration. The skip control focuses the main area without changing workflow.
- Speech recorder failures are visible, and response language follows the UI language. Search failures remain distinct from empty results. History searches include reviewed attachment wording and titles use actual document/question text.
- Fixed an additional SQLite failure: suffixed turn IDs were invalid. Stable hexadecimal IDs and duplicate prevention now save health turns correctly. Lost server handles are invalidated for explicit context restoration on retry.
- Restored the configured Ollama runtime and started a gateway without source autoreload. Increased the Next.js rewrite timeout from 30 to 180 seconds to accommodate the gateway's bounded AI operations. Public Bonsai document explanation, contextual follow-up, and saved-chat continuation passed using synthetic text. Synthetic mixed-language medicine image recognition returned the label and preserved its strength/unit; Nepali transcription still needed correction.
- The reviewed health library and medicine directory are still empty. Health/medicine medical-answer acceptance remains blocked by reviewed content. Live generated-audio TTS/STT checks establish service connectivity, not native-speaker accuracy or physical-device microphone/speaker acceptance.

## 10 October update: health education and explicitly included user context

The global empty-reviewed-library message has been replaced for supported general education: five public WHO/NHS topics provide 20 question phrasings per language, source citations and contextual follow-ups. These original summaries and Nepali translations are labeled `public_reference`, not clinically reviewed. Reviewed clinical/medicine catalogs remain empty. Unknown topics still require an appropriate source; this is bounded education, not unrestricted medical generation.

Each new health/document/medicine chat now asks whether to include saved user context. An editable 4,000-character preview combines user notes and prior user dialogue/reviewed document text. No context is sent when declined, and the API rejects supplied context without inclusion permission. Notes and decisions persist in device SQLite, existing chats preserve their snapshots, and new chats do not inherit earlier choices. User questions are labeled as unverified prior words, never converted into inferred diagnoses.

Validation: 243 backend tests and 31 frontend tests passed, including permission isolation, evidence validation, persistence, bounds and context-free chats; contracts/type checking/lint and a production build passed. Live Bonsai and Qwen returned the same sourced English fever definition; Bonsai answered the English medical-help follow-up using the fever-care section and produced the Nepali source answer. Browser checks confirmed profile editing, a fresh prompt on New chat, independent and explicitly included chats, and real sourced health answers. Browser testing used synthetic preference text and general questions, preserving existing records.
