# ArogyaAI

A Nepali and English health companion centered on conversations about prescriptions, doctors’ notes, reports and medicine photos. Users should be able to ask follow-up questions by typing or speaking, hear Nepali answers, and return to their saved sessions on mobile.

## Authoritative implementation directives

The product documentation was replaced on **10 October 2026** after inspecting the running UI and current frontend/backend source. These directives supersede all previous architecture, milestone, task, status and feature documents:

- [Frontend directive](docs/FRONTEND_DIRECTIVE.md): five-item navigation, dashboard, shared conversation UI, accessible transcription review, integrated Nepali voice and mobile acceptance.
- [Backend and AI directive](docs/BACKEND_DIRECTIVE.md): conversation context, OCR/vision investigation, medicine identification, voice services, history, processing policy and shared contracts.
- [UI/UX directive](docs/UI_UX_DIRECTIVE.md): current rendered UX findings, a restrained visual system, task-specific layouts, complete Nepali UI, interaction recovery and measurable design acceptance.

The required sidebar contains only: **Dashboard**, **Prescription / Report transcription**, **Medicine info**, **Past chat records**, **Quick health question**, in that order. Home becomes Dashboard. Voice, photo reading and follow-ups belong inside these workflows. The current development UI at port 3000 has these five destinations; the inspected Python-served UI at port 8000 still has the older eleven. The UI/UX directive records this version difference and open usability defects; its addition changes documentation only.

These documents describe required work; they do not certify that the core workflows are complete. Current OCR quality, continuous document/medicine conversations and real-device Nepali voice acceptance remain unresolved. The documentation replacement changed docs only. Subsequent backend work adds contextual conversation, recognition-job, voice and opt-in history APIs; see the implementation handoff in the backend directive. Current frontend work integrates conversation APIs, with workflow and UX acceptance still outstanding.

## Existing workspace and commands

Frontend: `apps/web`. Python API and inference: `services/api`. Shared schemas and generated types: `packages/contracts`. Runners and verification utilities: `scripts`.

The five frontend destinations have dedicated routes: `/dashboard/`,
`/transcription/`, `/medicines/`, `/history/` and `/chat/`. `/` also opens the
dashboard, and older fragment bookmarks such as `/#documents` open the matching
route. The root layout mounts `WorkspaceLayout` once for the shared navigation,
page header, dialogs and conversation providers. Feature pages share its spacing
and controls; in-progress drafts remain available when navigating between tasks.
Unsubmitted drafts stay in memory and do not survive a full browser reload.

The existing package scripts provide `pnpm setup`, `pnpm dev`, `pnpm dev:web`, `pnpm dev:api`, `pnpm setup:ai`, `pnpm setup:language`, and `pnpm setup:server-ocr`. Inspect `package.json` and service configuration before running setup; setup can install dependencies and download models. Python-served mode uses `pnpm build:local` followed by `pnpm start:local --lan`; physical-phone microphones need a secure browser context.

Existing checks include `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:web`, `pnpm contracts:check`, and `pnpm build`. Integration scripts exist for images, documents, prescriptions and language. Passing these checks alone does not establish recognition accuracy, useful follow-ups or physical-phone voice quality.

Repository agent instructions and local commit instructions remain operational instructions. Licensed under the [MIT License](LICENSE); preserve applicable third-party model and asset notices.


## Repository layout

```text
apps/web/src/
  app/                  Next.js routes and root layout
  features/             Chat, documents, medicines, history, speech, knowledge, settings
  components/layout/    Sidebar, home/dashboard entry, layout icons
  components/ui/        Shared controls
  context/              Session and permission provider
  lib/                  Cross-feature API, copy and helpers
  styles/               Shared styles
services/api/src/arogya_api/
  main.py               Gateway composition
  conversations/        Sessions, attachments, turns and history coordination
  documents/ images/    Document explanation and recognition
  health/ history/      Reviewed answers and saved conversations
  speech/ inference/    Model clients, engines and private workers
  knowledge/ runtime/   Source review, catalog, bundles and runtime status
  core/                 Auth, configuration, contracts and shared utilities
  cli/ resources/       Setup/admin commands and pinned model manifests
services/api/tests/      Domain tests and fixtures
scripts/
  dev.mjs               Local process runner
  assets/ contracts/    Asset preparation and contract generation
  verify/ evaluate/     Live verification and quality evaluation
packages/contracts/     Generated JSON Schema and TypeScript contracts
```

Application code belongs with its feature. Keep shared code in the shared folders and generate contracts from Python models using `pnpm contracts:generate`. Setup commands, verification tools and evaluation fixtures are used tooling, not inactive application code.


The five-destination frontend uses contextual conversation APIs for document,
medicine and health sessions. Reviewed context is saved in browser SQLite and
can be restored when continuing a chat. Optional server history retains context
for conversations started after opting in. See both directives for implementation
status and remaining clinical, recognition and phone-voice acceptance work.

For a separate development API, set `AROGYA_API_PROXY_URL` when running
`pnpm dev:web`; leave `NEXT_PUBLIC_API_URL` empty to use the same-origin proxy.

Document conversations now keep a reusable retrieval index and extractive
context for each reviewed attachment. Follow-ups retrieve relevant passages with
original line references; corrections rebuild the context, and saved history
preserves it under the existing storage choice. See [Document RAG](docs/DOCUMENT_RAG.md)
for storage behavior, bounds and the real-inference verification command.
