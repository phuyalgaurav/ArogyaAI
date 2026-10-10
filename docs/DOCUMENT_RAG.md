# Document RAG

Document conversations index each attachment's **reviewed text** once per review
revision. Follow-up questions retrieve passages from that attachment before
calling the configured Qwen or Bonsai reader. The pipeline uses local BM25 search
with shared English/Nepali glossary aliases; it requires no embedding model,
external vector database or additional dependency.

## Pipeline

1. Add or recognize an attachment, then review its transcription through the
   existing conversation API. Unreviewed text is not indexed or used for answers.
2. Review builds `attachment.document_context`: a text checksum, review revision,
   overlapping chunks, cached term frequencies, BM25 statistics and a short
   extractive summary with original line IDs. Summary wording is copied from the
   reviewed text; it is not a generated clinical interpretation.
3. A question searches only the selected/active attachment. Explicit line choices,
   literal navigation and resolved “that line” references are retained. Source
   line IDs remain unchanged, including when only late-document passages match.
4. The model receives retrieved lines plus relevant previous turns. Each model
   call contains at most 12 source lines and 3,200 source characters. Previous
   turns are limited to the latest three applicable turns with excerpts of at
   most 300 characters; excerpt truncation is explicit. Existing question and
   user-context limits still apply separately.
5. Model references and repeated quantities are validated against those supplied
   lines. A model cannot cite another passage merely because it exists elsewhere
   in the document. When no passage matches, the service returns `no_match`
   without inference.

Short documents that fit the retrieval budget use their complete text. Broad
summary requests can retrieve the extractive summary's source lines. The explicit
`operation: "explain"` action covers the entire document in bounded model batches;
it does not silently discard later lines. Existing admission limits remain:
8,000 characters, 40 nonempty lines, at most 500 characters per line.

Each document answer includes `retrieval` metadata: method, supplied line IDs,
total line count, whether the stored context was reused and whether only a subset
was supplied. These are source-character/line bounds, not tokenizer-level limits
or proof of clinical correctness. Existing model-context overflow checks remain.

## Storage and invalidation

The context lives inside `ConversationAttachment`, so the existing frontend
conversation calls and browser SQLite snapshots carry it automatically.

- Session conversations retain the index in bounded server memory until session
  expiry/deletion. Processing consent alone does not persist document data.
- Opted-in server history stores it in the existing conversation JSON in SQLite,
  under the same owner, 30-day retention, quotas and deletion policy. No database
  migration or separate index cleanup is needed.
- Browser-saved history includes the context. Restore rebuilds derived data from
  the reviewed text rather than trusting a client-supplied index or summary.
- A reviewed-text correction replaces the index and summary immediately. The
  existing context revision also prevents prior answers from becoming evidence
  for the corrected version.
- Older stored conversations without an index are indexed on their next review
  or successful turn. Nothing is shared between owners or unrelated attachments.
- The standalone `/api/v1/documents/explain` endpoint uses the same retrieval
  logic transiently and remains stateless.

Canonical models are in `documents/models.py`; retrieval is in `documents/rag.py`.
Shared JSON schemas and TypeScript types are generated with
`pnpm contracts:generate`. Existing snapshot formats remain readable because the
new attachment context and answer metadata are optional.

## Verification

```sh
uv run --project services/api python -m pytest services/api/tests/documents services/api/tests/conversations
uv run --project services/api python scripts/verify/rag.py
pnpm contracts:check
pnpm typecheck
```

The live verifier uses current gateway source, temporary databases and the real
configured Qwen worker from `.local/backend.env`. It covers an English lookup,
a pronoun follow-up, a Nepali lookup and a corrected value on a synthetic
40-line document. It deletes its test context and writes a receipt to
`.local/document-rag-validation/live.json` only after all checks pass. Existing
services are not restarted by this verifier.

On 10 October 2026, those four live checks passed with `qwen3.5:0.8b`, retaining
the exact source quote before and after correction. Each query supplied 3 of 40
lines, containing 326 source characters out of 5,764 in the document, and reused
the stored index. This measures reduced document input on one synthetic fixture;
it is not a clinical accuracy or general semantic-recall benchmark. BM25 relies
on wording and the implemented aliases. Unmatched semantic paraphrases can need
a rephrased question or an explicit line choice.

Restart the gateway to load this pipeline and the private inference worker to
load the updated retrieval instructions. Existing consent, diagnosis/dosing
boundaries, exact quotations and source validation remain in effect.
