"""Per-revision, offline document retrieval with exact source-line provenance.

Chunks overlap by one line so neighboring headings, units and instructions travel
together. Only term counts and an extractive summary are cached; no model output
becomes document evidence. There is no cross-owner or global content cache.
"""

import hashlib
import math
import re
import unicodedata
from collections import Counter

from arogya_api.documents.glossary import TERMS
from arogya_api.documents.models import DocumentChunk, DocumentContext, DocumentLine
from arogya_api.documents.rules import ADMIN, FOLLOW_UP, INSTRUCTION, MEDICINE

MAX_CONTEXT_CHARS = 3200
MAX_CONTEXT_LINES = 12
STOP_WORDS = set(
    "a an and are as at be by can do does explain for from how i in is it line me my of on "
    "please show tell that the these this to what when where which with you your "
    "about mean means meaning more "
    "के यो त्यो कुन कहाँ कहिले कसरी छ हो मलाई बारे हरफ लाइन व्याख्या गर्नुहोस्".split()
)
TOPICS = (
    *[(pattern, term) for pattern, term, *_ in TERMS],
    (FOLLOW_UP.pattern + r"|अर्को भेट|next (?:visit|appointment)", "follow_up"),
    (MEDICINE.pattern, "medicine"),
    (INSTRUCTION.pattern, "instruction"),
)
DEICTIC = re.compile(r"\b(?:it|that|this|those|them)\b|त्यो|त्यस|यसको", re.I)
BROAD = re.compile(r"\b(?:explain|summari[sz]e|overview)\b|व्याख्या|सारांश|बुझा", re.I)


def document_lines(text):
    return [
        DocumentLine(id=f"L{i + 1}", text=line)
        for i, line in enumerate(line.strip() for line in text.splitlines() if line.strip())
    ]


def tokens(text):
    # Python's \w separates Devanagari combining marks from their words.
    text = unicodedata.normalize("NFKC", text).casefold()
    words, word = [], []
    for char in text + " ":
        if unicodedata.category(char)[0] in {"L", "N", "M"}:
            word.append(str(unicodedata.decimal(char)) if char.isdecimal() else char)
        elif word:
            value = "".join(word)
            if value not in STOP_WORDS:
                words.append(value)
            word = []
    # Shared glossary aliases bridge common English/Nepali names without changing quotes.
    words.extend("topic:" + term for pattern, term in TOPICS if re.search(pattern, text, re.I))
    return words


def build_context(text, kind, reviewed_revision=0):
    lines = document_lines(text)
    chunks, start = [], 0
    while start < len(lines):
        end, size = start, 0
        while end < len(lines) and end - start < 3:
            extra = len(lines[end].text) + 1
            if end > start and size + extra > 900:
                break
            size += extra
            end += 1
        counts = Counter(tokens("\n".join(line.text for line in lines[start:end])))
        chunks.append(
            DocumentChunk(
                id=f"C{len(chunks) + 1}",
                line_ids=[line.id for line in lines[start:end]],
                terms=dict(counts),
                token_count=sum(counts.values()),
            )
        )
        if end == len(lines):
            break
        start = max(start + 1, end - 1)
    frequency = Counter(term for chunk in chunks for term in chunk.terms)
    # Take representative exact lines across the document, then fill from source order.
    from arogya_api.documents.rules import line_kind

    representative, seen = [], set()
    for line in lines:
        category = line_kind(line.text)
        if not ADMIN.search(line.text) and category not in seen:
            representative.append(line)
            seen.add(category)
    summary_lines, summary = [], ""
    for line in representative + [line for line in lines if line not in representative]:
        if ADMIN.search(line.text):
            continue
        quote = f"{line.id}: {line.text}\n"
        if len(summary) + len(quote) <= 1800 and len(summary_lines) < 6:
            summary += quote
            summary_lines.append(line.id)
    return DocumentContext(
        document_sha256=hashlib.sha256(text.encode()).hexdigest(),
        reviewed_revision=reviewed_revision,
        kind=kind,
        chunks=chunks,
        document_frequency=dict(frequency),
        average_chunk_length=sum(chunk.token_count for chunk in chunks) / len(chunks),
        summary=summary.rstrip(),
        summary_line_ids=summary_lines,
    )


def context_matches(context, text, kind, reviewed_revision):
    return context is not None and (
        context.document_sha256 == hashlib.sha256(text.encode()).hexdigest()
        and context.reviewed_revision == reviewed_revision
        and context.kind == kind
    )


def retrieve(context, lines, question, previous_turns=(), required_ids=()):
    """Rank only this document; always keep explicit/literal/deictic references."""
    if not question.strip():
        return lines
    known = {line.id: line for line in lines}
    query = set(tokens(question))
    required = list(dict.fromkeys(required_ids))
    if previous_turns and DEICTIC.search(question) and not query:
        required.extend(previous_turns[-1].answer_line_ids)
        query.update(tokens(previous_turns[-1].question))
    if (
        len(lines) <= MAX_CONTEXT_LINES
        and sum(len(line.text) + 1 for line in lines) <= MAX_CONTEXT_CHARS
    ):
        return lines

    ranked = []
    count = len(context.chunks)
    average = max(context.average_chunk_length, 1)
    for chunk in context.chunks:
        score = 0.0
        for term in query:
            tf = chunk.terms.get(term, 0)
            if not tf:
                continue
            df = context.document_frequency[term]
            idf = math.log(1 + (count - df + 0.5) / (df + 0.5))
            score += idf * tf * 2.5 / (tf + 1.5 * (0.25 + 0.75 * chunk.token_count / average))
        if score > 0:
            ranked.append((score, chunk))
    ranked.sort(key=lambda item: (-item[0], int(item[1].id[1:])))
    selected, size = set(), 0

    def include(line_id):
        nonlocal size
        if line_id not in known or line_id in selected:
            return
        length = len(known[line_id].text) + 1
        if len(selected) < MAX_CONTEXT_LINES and size + length <= MAX_CONTEXT_CHARS:
            selected.add(line_id)
            size += length

    for line_id in required:
        include(line_id)
    for _, chunk in ranked[:4]:
        for line_id in chunk.line_ids:
            include(line_id)
    if not ranked and not selected and BROAD.search(question):
        for line_id in context.summary_line_ids:
            include(line_id)
    return [line for line in lines if line.id in selected]


def batches(lines):
    """Bound model input for full-document guides too, without silently dropping lines."""
    batch, size = [], 0
    for line in lines:
        length = len(line.text) + 1
        if batch and (size + length > MAX_CONTEXT_CHARS or len(batch) == MAX_CONTEXT_LINES):
            yield batch
            batch, size = [], 0
        batch.append(line)
        size += length
    if batch:
        yield batch
