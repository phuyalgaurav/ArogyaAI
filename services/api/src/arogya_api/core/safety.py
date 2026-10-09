import re
import unicodedata

POLICY_VERSION = "education-extractive-2"
EMERGENCY = re.compile(
    r"can't breathe|cannot breathe|trouble breathing|difficulty breathing|chest pain|"
    r"overdos|suicid|kill myself|severe bleeding|unconscious|"
    r"सास.*(गाह्रो|सक्दिन)|छाती.*दुख|बेहोस|आत्महत्या|"
    r"saas.*(garo|gaaro)|chhati.*dukh",
    re.I,
)
PERSONAL = re.compile(
    r"\b(diagnos\w*|dose|dosage|how much|how many|should i|can i take|"
    r"stop taking|change.*medicine|interact\w*|pregnan\w*|my symptoms|i have|"
    r"mg|milligrams?|tablets?\s+(?:a|per)\s+day)\b|"
    r"कति.*(खाने|औषधि)|मेरो.*(लक्षण|रोग)|गर्भवती|"
    r"kati.*(khane|ausadhi)|mero.*(lakshan|rog)",
    re.I,
)
INJECTION = re.compile(r"ignore.*instructions|system prompt|override.*rules", re.I)


def precheck(message):
    text = unicodedata.normalize("NFC", message)
    if EMERGENCY.search(text):
        return (
            "urgent",
            "possible_emergency",
            "Your message may describe an urgent situation. Seek urgent "
            "professional care now; this service cannot assess or rule out an emergency.",
        )
    if PERSONAL.search(text):
        return (
            "needs_professional_review",
            "personal_medical_decision",
            "A pharmacist or clinician needs to review this request. This "
            "service does not diagnose conditions or choose or change personal medicine doses.",
        )
    if INJECTION.search(text):
        return (
            "needs_clarification",
            "untrusted_instruction",
            "Please ask a general health-information question. Instructions to "
            "change system rules cannot be processed.",
        )
    return None


def rule_intent(message):
    if re.search(r"scan|prescription|handwrit|photo|प्रेस्क्रिप्सन", message, re.I):
        return "document_scan"
    if re.search(r"medicine|drug|औषधि|ausadhi", message, re.I):
        return "medicine_info"
    return "education"
