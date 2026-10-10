# UI/UX directive: a considered health workspace

**Issued: 10 October 2026. Status: required implementation; audited defects remain open.**

Read this with the [frontend directive](FRONTEND_DIRECTIVE.md) and [backend and AI directive](BACKEND_DIRECTIVE.md). The frontend directive defines navigation and workflows; the backend directive defines processing, evidence and context. This document defines their presentation, interaction quality and UX acceptance. Implement all three together. This revision adds documentation only and does not certify a redesign or working clinical capability.

## 1. Audit basis and current experience

The current development UI at `http://127.0.0.1:3000` was inspected across Dashboard, Prescription / Report transcription, Medicine info, Past chat records and Quick health question. Desktop screenshots were reviewed at 1440 × 1000; phone layouts were inspected at 390 × 844. Nepali transcription was additionally measured at 320 × 740 and 360 × 800. Inspection included rendered text, computed styles, control dimensions, navigation, language switching and privacy-dialog dismissal.

The Python-served UI at `http://127.0.0.1:8000` still displays the older eleven-destination navigation. The current development UI and `apps/web/src/app/page.tsx` display the required five destinations. Treat these as different asset versions. Record the URL and served build when validating changes; inspecting one cannot establish acceptance of the other.

Source inspection covered the shell, dashboard, transcription, medicine, chat, history, shared styles and consent UI. A structural code map was used for discovery; its parser reported partial extraction in three files, so findings below were checked directly against source and the browser. No health documents or medicine photos were uploaded, no questions were submitted, and no camera, microphone or processing permission was granted. Recognition quality, generated answers, populated history, real-phone keyboards and speech remain untested here.

The existing restrained green palette, line icons, visible focus outline, native mobile drawer and five task destinations are useful foundations. The experience loses coherence through inconsistent page structure, repeated rounded panels, implementation terminology, weak empty states and controls competing with the actual task.

| Priority | Verified finding | User consequence | Required resolution |
| --- | --- | --- | --- |
| P1 | Unselected history filters have computed white text on white backgrounds. Their buttons sit inside a `tablist` without tab roles or selected state. | Categories appear blank and selection is unclear to assistive technology. | Set explicit foregrounds for every state. Use a labeled filter group with pressed buttons, or implement the complete tabs pattern. |
| P1 | Opening the privacy overlay leaves focus on its sidebar trigger; pressing Escape leaves the dialog open. Its source uses styled `div` elements without modal focus management. | Keyboard users can remain outside the supposed modal and cannot dismiss it conventionally. | Move focus inside, contain it, make the background inert, close on Escape and return focus to the trigger. Apply the same behavior to source and model dialogs. |
| P1 | Nepali transcription at 320 px has `scrollWidth` 332 px; the second input-mode button extends past the viewport. At 360 and 390 px, that inspected state fits horizontally. | Small-phone users encounter clipped controls and horizontal scrolling. | Wrap or stack the mode controls and validate every destination in both languages at all three widths. |
| P1 | At 390 × 844, the transcription screen places the heading, storage text, New conversation, model panel and reader selector before capture. File/photo actions are below the first screen. | Starting a document feels like configuring a tool. | Put capture or paste first; move processing choices into an optional disclosure. |
| P1 | Quick health question shows an empty approved-question catalog alongside broad claims about reviewed clinical answers. Medicine copy mentions both verified candidates and unverified matches. | Users cannot reliably tell what the service currently knows or what has been checked. | Make availability and evidence state explicit. Distinguish catalog provenance, candidate matching and user review. |
| P2 | Dashboard and transcription use large serif page headings; medicine and chat start with smaller `h2` headings. Medicine begins with storage text and New conversation before its title. | Destinations feel assembled independently and the current task is harder to scan. | Use one shared page-header hierarchy with a single `h1`, short purpose statement and secondary utilities. |
| P2 | Three equal dashboard cards repeat long descriptions and full-width green buttons; recent history has a large empty panel with an icon. | The dashboard resembles a feature showcase and consumes excess space on phones. | Use compact task starts and a small recent-session list with a brief empty state. |
| P2 | History foregrounds SQLite export, refresh, storage cards and server-copy controls before records. Recent/history categories are guessed from title/message keywords. | Finding a conversation competes with administration; session types can be misleading. | Put search, type filters and records first. Use stored session mode for type; move storage management into a disclosure or dialog. |
| P2 | The Nepali transcription view retains English model, reader and review-field text. A Nepali heading inherits negative tracking. Noto families are named in CSS, with no font loading declared in the inspected layout/styles. | Language switching is incomplete and typography depends on the device's available fonts. | Supply reliable Devanagari coverage, remove Latin tracking rules from Nepali and localize the complete task surface. |
| P2 | Inspected capture and New conversation buttons are 44 px high; core task controls use emoji alongside an established SVG icon system. | Primary touch controls fall below the frontend directive's 48 px target, and icon treatment varies across screens. | Use at least 48 × 48 px primary hit areas and the existing consistent icon family. |
| P2 | Source-only finding: navigation returns silently while work is busy, and a failed history resume is logged to the console. These failure paths were not exercised live. | A click can appear broken, with no visible way to recover. | Explain pending work and offer a visible cancel/continue choice; show a resume error and retry action beside the record. |

P1 means fix before UX acceptance of the affected workflow. P2 means required for a coherent release. These priorities describe user impact, not measured clinical accuracy.

## 2. Product character and design decisions

ArogyaAI should feel like a carefully edited health information workspace for someone holding a prescription, a report or a medicine package. Give it a calm, practical character: legible text, clear task boundaries, useful evidence and predictable controls. Assume users may be anxious, unfamiliar with technical terms, or using a small phone in Nepali.

Make the app distinctive through the work it helps users do: comparing a document with its transcription, checking uncertain strengths and units, confirming which medicine a conversation concerns, and returning to the same session. These are the visual anchors. Generic illustrations and marketing language cannot substitute for them.

Apply these rules to every screen:

- Establish one current task, one clear next action and one visible place to recover from a failure. Emphasize the active step rather than coloring every available action as primary.
- Use spacing, alignment, type and dividers to organize information. Use a card when it represents an attachment, a review decision or a bounded conversation; avoid nesting cards around every heading, sentence and control.
- Keep a stable header, content alignment, utility placement and button vocabulary across destinations. Allow the body layout to follow the task: comparison for documents, identity review for medicines, conversation for questions, rows for history.
- Write short factual labels. Replace promotional eyebrows such as “YOUR HEALTH · CONTINUOUS CARE” with useful context or remove them. Do not imply ongoing clinical care from a question-and-document tool.
- Use the established SVG icon family with consistent size and stroke. Label unfamiliar actions; reserve icon-only controls for familiar actions with accessible names.
- Reserve motion for feedback: opening a drawer, indicating recording, or revealing a completed step. Remove decorative card lifting, looping decoration and unnecessary entrances. Respect reduced-motion preferences.
- Exclude fabricated metrics, sample patient histories, decorative confidence percentages, gradient text, glass panels, stock doctor heroes, glowing AI motifs and generic feature-card landing pages from the ordinary app flow.

## 3. Shared visual foundation

Use a small set of shared design tokens before changing individual screens. The following is the implementation baseline; any adjustment must be applied consistently and checked in the rendered app.

| Element | Baseline |
| --- | --- |
| Canvas and surfaces | Keep the warm off-white `#f6f7f2` canvas and white working surfaces. Use one quiet tinted surface for selected/contextual content. |
| Text and accent | Use a dark neutral such as `#1f2d27` for reading and `#52645b` for secondary text. Retain `#174d42` as the primary-action accent. Essential content must remain legible without the accent. |
| Borders and status | Keep subtle dividers for grouping. Essential control boundaries, focus and selected indicators need sufficient contrast. Use amber for text requiring review and red for an actual urgent condition or failed operation, with explicit labels. |
| Type | Use one dependable UI family with Latin and Devanagari coverage. Bundle/self-host needed fonts and preserve readable fallbacks during loading. If a serif brand accent is retained, keep it out of task instructions, review fields and conversation text. |
| Scale | Page titles: 28–36 px desktop, 24–28 px phone. Section titles: 18–22 px. Reading, transcription and input text: at least 16 px, preferably 17–18 px for long Nepali content. Metadata: normally at least 13–14 px. |
| Text rhythm | Body line height 1.6–1.75; allow extra space for Devanagari marks. Use normal letter spacing for Nepali. Avoid all-caps tracking on instructions. Limit long answer lines to roughly 60–75 Latin characters, adapting to Nepali readability. |
| Spacing | Use a shared 4, 8, 12, 16, 24, 32 px scale. Phone gutters: 16–20 px. Reduce empty-state padding instead of inflating a page to fill the screen. |
| Shape and depth | Controls: about 6–8 px radius. Bounded panels: about 8–12 px. Use shadows mainly for overlays; normal content should read through alignment and dividers. |
| Controls | Primary actions, capture, microphone and dialog close controls: minimum 48 × 48 px hit areas. Use at least 16 px phone input text. Allow long translated labels to wrap; define foreground and background together for every button variant. |

Treat these as product choices, not a claim that WCAG mandates this typography or 48 px sizing. Text contrast must meet 4.5:1 for ordinary text and 3:1 for qualifying large text; essential authored control/state cues need 3:1 against adjacent colors. Check actual computed colors, including hover, selected and focus states. See [W3C text contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) and [non-text contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html).

Keep one shared implementation for headers, button variants, form fields, status messages, source disclosures and dialogs. Component boundaries should prevent the current white-on-white filter regression and screen-specific typography from recurring. Scope feature styles so a global button rule cannot silently change another feature's text color.

## 4. Screen requirements

### Dashboard

Keep the exact five navigation destinations and order from the frontend directive. Show a compact title and purpose line, followed by three concise task starts: document transcription, medicine information and a question. Give document capture appropriate emphasis; make the other starts readily discoverable. On a 390 × 844 phone, all three starts should be reachable without scrolling through promotional copy or oversized cards.

Show up to four recent sessions as compact rows: actual session type, meaningful title, last activity and Continue. Use the contract's mode, never title heuristics. Put View all beside the section heading. With no records, show one short explanation of how saved conversations will appear; do not create a large empty illustration panel or fictional entries.

Capability notices must be tied to the relevant action. A ready inference engine does not establish a populated evidence catalog or working voice service. An unknown runtime state should say that checking is pending; a service failure should identify the affected task and a useful next step.

### Prescription / Report transcription

The first screen should expose Take photo, Choose image and Paste text with supported formats and the 8 MB image limit in both languages. Put optional model/reader choices under a compact Processing options disclosure. Use an understandable default and explain any quality tradeoff without presenting model names and hardware as the user's first decision.

Use progressive disclosure: capture → review wording → explain/discuss. Before capture, avoid a large empty review textarea and inactive explanation panel dominating the page. After capture, keep the original and editable text side by side on desktop. On phones, provide clearly labeled Original / Transcription views or a readable stack that preserves position when switching.

Make rotation, retake, replace and zoom available as labeled controls with full hit areas. Preserve the original aspect ratio and let users examine the full document. Preview rotation must agree with the image actually processed. Surface unreadable words and uncertain numbers/units where they occur, with a route to correct them or take a clearer image.

Keep original wording, user corrections and explanation visually distinguishable. Label user review as “Text checked against photo”; it must never imply medical verification. Preserve the reviewed revision and active page reference in follow-up questions. The conversation and composer should become the working surface once explanation starts, with the document still available for comparison.

### Medicine info

Use the shared page header and the navigation label “Medicine info”. Place photo/upload and name search at the start of the task; label the search field visibly. Avoid opening with a database/directory heading or a lengthy storage notice.

Show visible label wording before candidate identity. A candidate row should expose name, ingredient, strength, formulation and the evidence for the match when available. Use explicit states: “Possible match”, “Label text needs checking”, “Selected for this conversation” and “No reliable match”. A reviewed catalog entry and a reviewed user transcription are different facts; neither guarantees that a photographed product was identified correctly.

Keep a concise candidate caution beside the identity decision. Attach more specific concerns to affected fields. Preserve necessary medicine warnings while removing duplicate boilerplate that competes with the review action. Do not style an uncertain match as a successful verification.

After selection, show the active medicine and strength above the conversation with a Change medicine action. Follow-ups must use that context. Require an explicit decision when switching identity, and keep the prior transcript attributable to its original context.

### Quick health question and shared conversation

Use the same conversation header, message rhythm, context strip, status treatment and composer across question, document and medicine modes. Show user questions and assistant responses in chronological order. Let longer answers read as paragraphs, short lists and source references instead of a pile of unrelated cards.

With no approved evidence, explain the limitation where a question would begin and identify any genuinely available alternative, such as document transcription. Do not invent reviewed topics or promise sourced health answers. Any supported submission must clearly distinguish “No reviewed answer available” from a technical failure or a successful response.

Keep one microphone control at the composer and an explicit read-aloud control with each eligible answer. Show Listening, Transcribing, Check recognized text, Preparing answer and Speaking using understandable Nepali/English labels. Make Stop, edit, resend and replay discoverable. Preserve a text path when speech fails.

On phones, keep the composer usable above the software keyboard and safe area without covering messages or review controls. Avoid unexpected scroll jumps while reading older messages. New content should scroll into view when the user is already at the bottom; otherwise offer a New reply indicator.

Keep processing location, sharing consent and saved-state feedback compact but truthful. Associate permission with the action that needs it and preserve distinct grants. In normal copy, use “Saved on this device” and “Save a server copy”; put SQLite, worker identifiers and technical origins in details where useful. Name the actual destination in sharing details without making a raw localhost URL the primary history description.

### Past chat records

Start with the shared header, search, type filters and the record list. Use list rows with title, stored workflow mode, last activity, short preview and Continue. Give deletion a separate secondary action, preserve necessary confirmation, and make resume failures visible beside the relevant record.

Use compact controls or a Manage saved chats disclosure for export, server copies, retention and deletion. Call the normal export action “Export saved chats”; disclose its SQLite format before download. Preserve access to privacy and deletion controls while keeping record discovery dominant.

Distinguish first-use emptiness, no search matches, no records of the selected type, loading and unavailable storage. Each needs its own useful action: start a task, clear a search, reset a filter, retry loading or recover saving. Opening history must not imply that unsaved in-memory work is durable.

## 5. Interaction, language and trust requirements

- Every task needs deliberate empty, processing, success, partial/uncertain, failure, cancelled and unavailable states. Loading text must describe actual work; do not invent progress percentages or present a spinner as a completed result.
- Preserve entered text, attachments and reviewed revisions when an operation fails. Give a specific next action: Retry recognition, Replace photo, Edit wording, Retry answer or Retry opening conversation. Keep errors beside the affected step and announce them appropriately.
- A delayed reply, retry or cancellation remains attached to its originating session/turn. Prevent duplicate messages and stale updates. If navigation is temporarily blocked, show the reason and a visible cancel or wait choice; do not silently ignore a click.
- Use one primary action for the current step. Explain disabled actions beside the control: for example, “Check the transcription to continue.” Do not rely on low opacity alone to explain what is missing.
- Make all dialogs and drawers keyboard operable: suitable initial focus, contained Tab/Shift+Tab, Escape dismissal, background inertness and focus return. A dialog must have a visible title and named close control. Follow the [W3C modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/); adding `aria-modal` alone does not implement it.
- Localize visible instructions, status, validation, empty states, accessible names, source controls and permission summaries together. Keep exact original medical wording intact while localizing its surrounding UI. Do not transform clinically significant numbers/units for visual consistency.
- Use Nepali terminology that people understand and obtain a fluent-speaker review before acceptance. Treat English-only technical panels in a Nepali task as incomplete localization. Clearly label any unsupported-language preview.
- Show evidence title, relevant excerpt/reference, recorded review date/status and a working source action where available. Surface uncertainty next to the affected claim. A green status or user checkbox must not manufacture authority.
- Keep accessibility essentials consistent: single page `h1`, ordered headings, visible labels, accessible icon names, selected/pressed state, keyboard focus, error associations and screen-reader status announcements. Use color with text or an icon for meaning.
- Keep first interaction light: text and task actions should be usable while optional assets load. Do not block the dashboard on model metadata, large decorations or font downloads. Preserve the local-serving constraints when choosing font/assets and keep ordinary UI free of remote trackers or unnecessary UI libraries.

## 6. Delivery sequence and acceptance gate

1. Fix history-filter contrast/semantics, dialog focus/dismissal, the 320 px overflow and contradictory capability/identity copy. Verify these in the rendered app before cosmetic changes.
2. Establish shared type, spacing, controls, status and dialog patterns. Apply the page-header hierarchy to all five destinations and complete the Nepali task copy.
3. Simplify dashboard/history and make transcription capture the first action. Build document comparison and medicine identity review around the real contracts and existing functioning code.
4. Apply the shared conversation/composer pattern across all three modes. Exercise recovery, permission denial, cancelled work, context changes and reopened records using the backend requirements.
5. Validate the build users actually receive, including Python-served assets. Record functional limitations independently of visual quality.

UX acceptance requires evidence against this checklist:

- [ ] Desktop 1440 px and phone 320, 360 and 390 px screenshots cover all five destinations in English and Nepali. Long labels, mixed-script medicine names, long responses and nonempty records fit without page-level horizontal overflow or clipped actions.
- [ ] At 390 × 844, all three dashboard starts are compactly discoverable, and transcription capture/paste actions appear in the first screen with advanced processing collapsed.
- [ ] Computed colors pass the stated contrast thresholds for all live button/filter states. The history filters remain readable before selection and expose their current state to assistive technology.
- [ ] Primary touch controls meet the 48 × 48 px product target. Content remains usable at 200% text zoom; focus is visible and never hidden behind sticky UI.
- [ ] Keyboard-only navigation opens/closes every dialog and drawer, cycles focus inside, returns focus correctly and completes task-entry/review controls. A screen-reader pass confirms headings, labels, errors and status.
- [ ] Real transcripts and medicine candidates have clear original, reviewed, uncertain and selected states. Original images can be fully examined; corrections and context changes remain attributable in the conversation.
- [ ] Empty catalog, unavailable services, denied permissions, poor images, ambiguous identity, slow processing, cancellation, retry and failed history resume each produce a truthful state with a working next action.
- [ ] Document, medicine and quick-question sessions each pass at least three contextual follow-ups, saving/reopening and typed/voice transitions as required by the other directives. Acceptance uses real responses, not fabricated demonstration content.
- [ ] Physical Android and iPhone checks cover camera/file alternatives, software keyboards, drawer/composer reachability, Nepali text, recording, playback, interruption and restoration. Emulated screenshots are reported separately.
- [ ] Both development and shipped/static-serving modes show the expected navigation and current assets. The reviewer records URL/build, device/viewport, language, tested state, screenshots and remaining failures.

Run relevant existing build, typecheck and feature checks when implementation changes. Add focused regression coverage for consequential shared-control or state defects; avoid tests that merely mirror styling code. Build success is supporting evidence, not UX acceptance.

Implementation entry points: `apps/web/src/components/layout/{TaskHome,WorkspaceSidebar,WorkspaceIcon}.tsx`, `apps/web/src/app/page.tsx`, `apps/web/src/components/ui`, `apps/web/src/features/{chat,conversations,documents,medicines,history}`, `apps/web/src/styles/{globals,workspace,sidebar}.css` and `apps/web/src/lib/copy.ts`. Preserve ongoing work and shared contracts. Mark a requirement complete only after its user-visible behavior has been verified.
# Implementation checkpoint — 2026-10-10

The current implementation keeps five navigation destinations, compact dashboard task rows, capture-first document input, explicit permission before image reading, native contextual dialogs, in-memory drafts across navigation, and readable controls with bundled Devanagari fonts. Browser layout checks covered all five workflows in English and Nepali at 320, 360 and 390 px without page-level horizontal overflow. Physical-device and screen-reader acceptance remain open.

Workflow validation must go beyond navigation. The public production deployment now completes a synthetic document explanation and a contextual follow-up using the default Bonsai model. The Node API proxy must retain its 180-second timeout, since its default 30 seconds cancelled AI turns. Local SQLite rejects malformed message IDs; stable hexadecimal user IDs and duplicate prevention are required for all task modes. Reopening a saved document must expose its existing guide and follow-up composer when the draft matches its reviewed text.

General health education now has public WHO/NHS references, separately labeled from clinical review. Reviewed medicine matching remains unavailable while its catalog is empty. Synthetic Nepali speech synthesis/transcription service checks passed, but the transcript contained errors and required review. Native-speaker accuracy, microphone/speaker behavior, camera quality, handwriting recognition, interruption recovery and clinical content remain release requirements. Do not treat an installed model, working button or successful build as proof of these capabilities.

## Saved context at the start of a chat — 10 October 2026

Use the same saved-context control and inclusion prompt for all three conversation modes. Ask once for each new conversation, preserve that choice when resuming, and show an included/independent status above the workspace. Present the exact editable context before it is shared; the two actions are **Start without context** and **Include this context**. Keep profile editing within a contextual dialog rather than adding a sixth sidebar destination. Support English/Nepali labels, keyboard focus, small-screen wrapping and browser reload.

Keep general public-source education visually distinct from clinical review. Health answers display their source citations and a concise public-education note. Suggested topics should span different subjects before showing alternate wording of the same question. Never show a global empty-clinical-library warning as if all general health education were unavailable.
