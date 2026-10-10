# Frontend directive: five destinations, continuous conversations

**Issued: 10 October 2026. Status: frontend and backend conversation integration implemented; product acceptance incomplete.**

Read this with [the backend directive](BACKEND_DIRECTIVE.md) and [the UI/UX directive](UI_UX_DIRECTIVE.md). This document defines workflows; the UI/UX directive adds required visual, interaction, language and design acceptance rules grounded in the current rendered app. This replaces the previous frontend tasks, milestones, architecture and feature documents. The original revision defined requirements without changing code. Subsequent implementation and its current limits are recorded below.

## 1. What the investigation established

The findings below describe the earlier Python-served snapshot. A subsequent UI/UX audit found that the current development UI at port 3000 and working source now have five destinations and conversation integration, while port 8000 still serves the older UI. Consult the [UI/UX directive's current audit](UI_UX_DIRECTIVE.md#1-audit-basis-and-current-experience) for open usability defects; neither snapshot establishes complete workflow acceptance.

The running Python-served UI at `http://127.0.0.1:8000` was inspected on Home, Prescription photo, Understand a document and Ask a question. The Home screenshot and navigation confirm eleven destinations and a large task-launcher layout. Source inspection confirms the same navigation in `apps/web/src/app/page.tsx` and `components/TaskHome.tsx`.

- Photo reading, prescription reading, document explanation, language/voice and questions occupy separate destinations. Photo results offer transfers to other pages instead of a conversation within the task.
- `DocumentView.tsx` displays original text and a reading guide with an optional question. Its UI explicitly says drafts are discarded on leaving. It does not present a durable multi-turn document conversation.
- `MedicineView.tsx` searches the text catalog and transfers a selected medicine into general chat. It does not contain a complete medicine-photo conversation.
- `ChatView.tsx` saves displayed messages, but its outgoing request includes only the latest question, language, selected model, permission and optional medicine ID. A visible transcript is not evidence that the server understands follow-ups.
- Current source includes automatic Nepali voice-turn logic. The inspected served chat exposes a separate language/voice action rather than that complete source flow; source and served assets may differ. Neither proves seamless voice on a physical phone.
- The inspected Home shows zero approved sources. Do not present a useful health-answer capability when the deployed evidence catalog is empty.

This was a navigation/layout and source audit. No patient document, medicine image, camera or microphone was used, and recognition/voice accuracy was not tested in this revision.

## 2. Exact navigation requirement

Keep exactly these five primary destinations, in this order, on desktop and mobile:

| Label | Responsibility |
| --- | --- |
| Dashboard | Replace Home with useful starts and recent conversations. |
| Prescription / Report transcription | Capture, transcribe, correct and discuss prescriptions, doctors’ notes and reports in one session. |
| Medicine info | Photograph or search a medicine, review its identity and continue asking questions in one session. |
| Past chat records | Find, open and continue saved conversations from all workflows. |
| Quick health question | Start a general health conversation with typing or Nepali voice. |

Remove the current primary entries: Home, Read an image, Prescription photo, Understand a document, Language & voice, Medicines, Library, Ask a question, Chat history, Tools & models and Privacy. Replace them with the five entries above; do not retain duplicates or add a sixth settings destination.

Keep language preference and contextual privacy/storage controls as compact controls or dialogs. Show sources inside responses. Keep model/runtime diagnostics out of the ordinary task flow; advanced processing choices can live in a contextual disclosure. Preserve permission revocation and deletion access. Existing bookmarks must resolve to the relevant new destination: home → Dashboard; images/prescriptions/documents → transcription; medicines → Medicine info; chat → Quick health question; history → Past chat records. Legacy language/library/engines/privacy links must open the relevant contextual feature without restoring old navigation.

## 3. Dashboard replaces the current Home

Use a compact dashboard with primary actions to start document transcription, identify a medicine and ask a question. Show a small recent-conversation list with type, title, last activity and a working Continue action. Link the full list to Past chat records. The empty state must offer the three useful starts without fake history, fabricated health metrics or sample answers.

Remove the oversized image-reader promotion and redundant tool cards. A concise service issue can appear when it affects an action; engine names, hardware specs and model installation are not the dashboard’s purpose.

## 4. One conversation surface for every core task

Build a shared session UI adapted to document, medicine and general-question modes. Each session needs a stable identity, ordered user/assistant messages, attachment previews, review cards, a persistent composer and continued context. New chat must create a new session; navigation, refresh and reopening history must restore the existing session according to its storage choice.

The user must be able to add an image or corrected text, read an explanation, ask several follow-ups, switch between speech and typing, and return later without restarting the task. Show references to the active document or medicine. Support more than one attachment with an explicit active context; never silently answer about the wrong page or medicine. Use the server contract to preserve context; concatenating visible messages in a browser alone is insufficient.

Sending, cancellation, retry, delayed results and errors must remain attached to their originating turn. A retry must not duplicate messages. Navigating away must stop recording/playback without deleting an intentionally saved session. Explain limits and allow continuation when a session becomes too long.

## 5. Prescription, note and report conversation

1. Start from camera, image upload or pasted text in the transcription destination. Keep a clear primary action and accessible file-picker alternative. Show supported formats/limits before upload; unsupported PDFs need a clear message until backend support exists.
2. Preview the original, provide rotation/retake and allow server processing after the applicable permission. Prefer the server automatically; ordinary users should not have to choose Tesseract or a model to begin.
3. Show progress in the session. Place the transcription review card next to the image on desktop and in a readable stacked or toggled layout on mobile. Preserve line/page references and unresolved text. Allow individual corrections and comparison without tiny overlay-only controls.
4. Make names, medicine strengths, numbers, units and unclear handwriting easy to check. Acknowledge transcription review without implying medical verification. Retaking the photo and manual correction must always work.
5. After review, explain the supplied document in plain language within the same thread. Keep original wording distinguishable from explanation. Offer useful follow-ups such as “Explain this line” or “What does this term mean?” grounded in the current document.
6. Continue with typed or spoken follow-ups and Nepali read-aloud answers. Do not send the user to a separate voice, OCR or reading-guide destination. Preserve the reviewed text and its revision for later continuation.

Do not equate a successful upload or a generated reading guide with this workflow being complete.

## 6. Medicine info conversation

Offer “Take a medicine photo”, upload and name search in the same destination. Preview packaging, blister or label images, then display extracted visible wording and candidate identity details: name, active ingredient, strength and formulation when supported by evidence.

Ambiguous results need a correction/selection card and a request for another view or clearer label. Never announce a verified identity based solely on packaging appearance. After identity review, attach the medicine context to the session and explain supported medicine information with sources. Follow-ups such as “What is it used for?” and “What did you identify on this label?” must preserve the selected medicine. Changing the medicine must visibly change context.

## 7. Nepali STT and TTS are part of the session

Use one visible microphone action in each session composer. Explain and obtain required permissions together where possible while preserving distinct scopes. Do not repeatedly show setup dialogs while grants remain active.

- Show Listening → Transcribing → Thinking → Speaking states in plain Nepali/English, with immediate recording feedback and a manual stop/send action.
- Show the recognized text. Let users correct it; pause before sending when recognition is uncertain or changes critical names, numbers, units or negation. Make correction possible even when the model did not flag an error.
- Send voice questions as ordinary turns with the same document/medicine context as typed turns.
- In explicitly enabled voice mode, play the answer in ordered chunks, retain its written transcript and support stop, replay and interruption to speak. Outside voice mode, use explicit read-aloud controls.
- Resume listening after playback only while voice mode remains active. Prevent feedback from the app’s own audio and discard stale clips or playback after cancellation/session changes.
- Retain a working text composer when microphone permission is denied, the browser is insecure, audio fails or speech services are unavailable. Show a useful reason and retry action without claiming success.

Reuse working recorder, playback and voice-turn code where appropriate; validate it in all three conversation modes. Keep unsupported languages honest. Nepali and English text are the immediate product focus; extra language previews must not distract from functioning Nepali voice.

## 8. Past chat records and mobile accessibility

History must include document, medicine and quick-question sessions, with search, type, title, last activity, preview and Continue. Resume the same session and its reviewed context. Provide per-session deletion and storage controls, with truthful pending/offline states. Old answers keep their recorded evidence date/status; a new follow-up requires fresh processing and validation.

Design for small phones first. Use a collapsible drawer containing the same five destinations, readable Nepali type, at least 48 px primary touch targets, and a composer that remains usable above the software keyboard and safe area. At 320, 360 and 390 px widths there must be no horizontal document overflow or clipped actions. Images, review text and sources must remain usable without a desktop layout.

Support keyboard operation, visible focus, named icon controls, focus return from dialogs/drawers, screen-reader status updates and errors associated with their controls. Do not communicate uncertainty solely through color. Keep the conversation dominant; avoid repeated warnings, oversized promotional copy and simultaneous technical panels.

## 9. Delivery order and frontend acceptance

1. Agree on session/attachment/turn/voice contracts with backend, then replace navigation and Home with the exact five-entry shell and Dashboard.
2. Deliver one real vertical slice: image → transcription review → document explanation → at least three contextual follow-ups → Nepali voice → history resume.
3. Reuse that surface for medicine-photo recognition and Quick health question; extend history to all modes.
4. Complete physical-phone, keyboard, screen-reader and failure-path validation. Local processing is optional after the server path works.

Acceptance requires real backend responses, no fabricated transcript/results, correct context after correction/navigation/reload, no duplicate retry turns, and working cancellation. Verify document and medicine follow-ups through both text and speech. Test permission denial, server outage, poor image, ambiguous medicine, speech failure, interrupted playback and reopened history. Report desktop/emulated-mobile checks separately from physical Android/iPhone microphone and speaker evidence. Build/typecheck success alone does not close these requirements.

Primary locations: `src/app/page.tsx` composes navigation; `src/components/layout` owns the shell and dashboard entry; `src/components/ui` contains shared controls. Feature code lives under `src/features/{chat,documents,medicines,history,speech,knowledge,settings}` with related hooks/helpers alongside it. Session permission state stays in `src/context/SessionContext.tsx`; cross-feature utilities stay in `src/lib`; shared CSS lives in `src/styles`. Inspect current uncommitted work before implementation and preserve functioning pieces.


## 13. Integrated frontend handoff

The remote frontend now provides the five required destinations. Its document and medicine screens are connected to `/api/v1/conversations`, rather than using separate one-shot document/chat requests for follow-ups. Shared conversation state lives in `src/features/conversations`; the task views, history and speech are grouped in their corresponding feature directories.

- Document photos create bounded recognition jobs, use the selected Qwen/Bonsai vision reader or explicit printed server OCR, and require transcription review. Optional printed browser OCR is an explicit action. Text corrections are saved as reviewed context revisions. The full backend dialogue and quoted line references remain visible.
- Medicine photos preserve the complete label for correction. Review resolves candidates from the full wording. A user must select a supported reviewed identity before medical follow-ups. An empty directory remains an unavailable capability.
- Quick health questions use contextual turns. The question selector can use prior dialogue and explicitly included user context. General education also uses the bounded WHO/NHS reference collection; these answers are labeled public education, never clinically reviewed. Reviewed medicine-specific evidence still requires the existing approval workflow.
- SQLite stores conversation snapshots, reviewed text, correction history and turns alongside message history. Continue opens the appropriate document, medicine or health workspace. After a fresh processing session, continuing local context requires `conversation_restore` permission. Original photos and audio are not retained.
- New conversations created after enabling server history store their reviewed context in the history vault. Sync retrieves those contexts. Existing local sessions remain local-context sessions; their message copies alone do not create a contextual server copy. This is not account-based synchronization.
- Speech requests use context-bound STT and exact answer chunks. Recognized questions are editable before sending. Manual listening follows the backend chunk count instead of truncating at 300 characters. Restored historical answers and stale revisions cannot be synthesized as fresh output.

Live browser validation used synthetic documents/labels: Qwen recognition, explanation, follow-up, reload/restore, Friday-to-Monday correction and the empty-catalog health response passed. A 390 px viewport exposed and then verified fixes for document tab and medicine search overflow. This is browser-layout evidence, not physical-phone camera/microphone acceptance. Nepali OCR/STT accuracy, handwriting evaluation, native-speaker testing, reviewed medical content, and production latency/concurrency remain release requirements.

## 14. Public UI runtime and click verification

Public hosting must serve a production build. Run `pnpm build:production`, then `pnpm start:web`; the production output is isolated in `apps/web/.next-production` so development compilation cannot overwrite the files used by the running production server. Set `AROGYA_API_PROXY_URL` when building if the gateway is not at `http://127.0.0.1:8000`. Run `pnpm start:backend` separately to start the configured gateway, inference worker, speech worker and Ollama when needed, without source autoreload. The web server listens on `127.0.0.1:3000` behind the existing tunnel. Rebuild and restart the production web server together when releasing changes; do not rebuild its active output during live requests.

On 2026-10-10 the public dashboard rendered but sidebar clicks did nothing. The public origin was running `next dev`, and a required development JavaScript chunk returned HTTP 502. The tunnel subsequently lost connectivity with QUIC timeouts. The runtime was replaced with `next start`, and the existing tunnel was restarted over HTTP/2. Public-browser checks then confirmed all five navigation destinations, Privacy open/close, and Tools & models open. This verifies UI activation and navigation; it does not establish OCR, voice, or clinical-answer quality.

After a release, verify through the public hostname: open all five destinations; type into a field; open and close both dialogs; check mobile menu navigation. A successful HTML response alone does not prove that scripts downloaded or that React activated the controls. Keep the HTML and its matching JavaScript assets from the same build, and use production assets with content-based filenames rather than publicly exposing development chunks.

The subsequent workflow audit found two additional failures: Ollama was stopped at its configured port, and user-message IDs suffixed with `-user` violated SQLite's 32-character hexadecimal contract. User IDs now derive deterministically from the turn ID, history append ignores an already-recorded turn, and health context no longer inserts a duplicate placeholder question. Lost server conversations invalidate the cached handle so an explicit retry can restore the local snapshot. Document and medicine permission requests are covered by their error/finally handlers so request failures release the busy controls.

The Next.js API rewrite also defaulted to a 30-second proxy timeout, cancelling longer Bonsai requests despite the gateway's 165-second processing budget. Set `experimental.proxyTimeout` to 180000 milliseconds for the Node deployment; the browser's existing 170-second limit remains bounded. Proxy responses that are HTML or plain text now produce an explicit connection/retry message instead of a JSON parser error. The external tunnel may impose its own timeout and connectivity limits, so verify slow model requests through the public hostname as well as localhost.

The reviewed health library and medicine directory remain empty. Health submission can return an explicit unavailable result and save that conversation; it cannot supply reviewed medical advice. Label OCR can produce a draft, but an empty directory cannot confirm an identity or enable reviewed medicine answers. Do not report these functions as accepted merely because their buttons respond. Live generated Nepali audio exercised TTS/STT successfully, but transcription still contained wording errors and required review; physical microphone/speaker and native-speaker quality acceptance remain outstanding.

## 15. Saved user context and public health education — 10 October 2026

Before each **new** health, document or medicine conversation, show a native modal asking whether to include saved context. Show an editable preview of the exact text to be shared. Offer equally explicit **Start without context** and **Include this context** actions; never infer consent from previous chats. Resuming the same chat preserves its original choice. A context-free chat sends an empty context and `include_user_context: false`.

The `profile` feature stores user-entered notes and per-chat choices in the existing device SQLite database. Messages, reviewed document text and follow-ups remain in the existing history records. Build a bounded preview from those records, excluding the active chat, assistant answers and unreviewed OCR drafts. Distinguish user words from verified clinical facts. Notes can be edited or cleared through **Your saved details**; deleting chats removes their stored messages, document context and their own inclusion choice. Previously included copies belong to their respective conversations and are deleted with those chats. Server-history permission remains separate; if enabled, its conversation snapshot includes any context explicitly shared for that chat.

Health suggestions request `include_public=true`. Preserve the default reviewed-only API for clinical/offline clients. Show source-backed education for fever, dehydration/diarrhoea, diet, activity and antibiotics in English and Nepali. Sources identify their publisher, URL, version, expiry and `public_reference` status. Do not relabel these summaries or their Nepali translations as clinician-reviewed. Broader coverage, reviewed medicine identity and physical-device Nepali speech acceptance remain outstanding.
