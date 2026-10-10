"""Literal document navigation, never an interpretation of a personal result or dose."""

import re

from arogya_api.documents.glossary import TERMS

FOLLOW_UP = re.compile(r"follow[ -]?up|review appointment|return visit|फेरि भेट|पुनः.*भेट", re.I)
FINDING = re.compile(
    r"\b(?:Hb|Hgb|CBC|hemoglobin|glucose|creatinine|result|reference range|g/dL|mg/dL)\b|"
    r"हेमोग्लोबिन|ग्लुकोज|क्रिएटिनिन|नतिजा|सन्दर्भ दायरा",
    re.I,
)
MEDICINE = re.compile(r"\b(?:medicine|medication|tablet|capsule|syrup|mg|mcg)\b|औषधि", re.I)
INSTRUCTION = re.compile(
    r"\b(?:instruction|take|apply|with food|after meals|before meals)\b|निर्देशन|खानापछि|खानाअघि",
    re.I,
)
ADMIN = re.compile(
    r"^(?:patient|name|age|id|address|phone|date of birth|synthetic|test report|"
    r"परीक्षणका लागि काल्पनिक)\b",
    re.I,
)


def line_kind(text):
    if FOLLOW_UP.search(text):
        return "follow_up"
    if FINDING.search(text):
        return "finding"
    if MEDICINE.search(text):
        return "medicine"
    if INSTRUCTION.search(text):
        return "instruction"
    return "other"


def literal_question_matches(question, lines):
    """Only navigation requests with an explicit topic; return None for semantic questions."""
    if not re.search(r"\b(?:which|what|where|when)\b|कुन|कहाँ|कहिले", question, re.I):
        return None
    if re.search(r"\bline\b|\bwhere\b|हरफ|लाइन|कहाँ", question, re.I):
        patterns = [pattern for pattern, *_ in TERMS if re.search(pattern, question, re.I)]
        if patterns:
            return [
                line.id
                for line in lines
                if any(re.search(pattern, line.text, re.I) for pattern in patterns)
            ][:3]
    pattern = None
    if FOLLOW_UP.search(question):
        pattern = FOLLOW_UP
    elif re.search(r"\b(?:tests?|results?)\b|परीक्षण|नतिजा", question, re.I):
        pattern = FINDING
    elif re.search(r"\b(?:medicine|medication)\b|औषधि", question, re.I):
        pattern = MEDICINE
    if pattern is None:
        return None
    return [line.id for line in lines if pattern.search(line.text)][:3]
