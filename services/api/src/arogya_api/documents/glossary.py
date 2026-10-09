"""Bounded general definitions, not patient-specific interpretation or approved catalog data.

Sources checked 2026-10-09. Nepali copy is an engineering translation awaiting
native clinical review. No reference ranges, diagnoses or dosing expansions.
"""

import re

from arogya_api.documents.models import DocumentDefinition

ROOT = "https://medlineplus.gov/lab-tests/"
TERMS = (
    (
        r"\b(?:CBC|complete blood count)\b|पूर्ण रक्त गणना",
        "CBC",
        "A group of tests measuring blood cells and related measurements.",
        "रगतका कोष र सम्बन्धित मापन जाँच्ने परीक्षणहरूको समूह हो।",
        "complete-blood-count-cbc/",
    ),
    (
        r"\b(?:Hb|Hgb|hemoglobin|haemoglobin)\b|हेमोग्लोबिन",
        "Hemoglobin",
        "An oxygen-carrying protein in red blood cells; this test measures its level.",
        "रातो रक्तकोषमा अक्सिजन बोक्ने प्रोटिन हो। परीक्षणले यसको स्तर मापन गर्छ।",
        "hemoglobin-test/",
    ),
    (
        r"\b(?:glucose|blood sugar|FBS|FPG|FBG)\b|ग्लुकोज|रगतको चिनी",
        "Blood glucose",
        "This test measures sugar in the blood. It does not establish a diagnosis by itself.",
        "यो परीक्षणले रगतको चिनी मापन गर्छ। यसबाट मात्र रोगको निदान हुँदैन।",
        "blood-glucose-test/",
    ),
    (
        r"\bcreatinine\b|क्रिएटिनिन",
        "Creatinine",
        "A waste product from muscle activity, normally filtered out by the kidneys.",
        "मांसपेशीको कामबाट बन्ने फोहोर पदार्थ हो, जसलाई मिर्गौलाले सामान्यतया छान्छ।",
        "creatinine-test/",
    ),
    (
        r"\b(?:reference range|normal range)\b|सन्दर्भ दायरा",
        "Reference range",
        (
            "Use the range printed by this laboratory. A number alone cannot "
            "confirm health or disease."
        ),
        ("यही प्रयोगशालाले दिएको दायरा हेर्नुहोस्। एउटा अंकले मात्र स्वास्थ्य वा रोग पुष्टि गर्दैन।"),
        "how-to-understand-your-lab-results/",
    ),
)


def definitions(text, language):
    return [
        DocumentDefinition(
            term=term, meaning=ne if language == "ne" else en, source_url=ROOT + path
        )
        for pattern, term, en, ne, path in TERMS
        if re.search(pattern, text, re.I)
    ]


MEANINGS = {
    "medicine": (
        (
            "Medicine wording copied from the document. Confirm its name, "
            "strength and directions with a pharmacist; no dose has been "
            "inferred."
        ),
        (
            "कागजातमा लेखिएको औषधिको विवरण हो। नाम, मात्रा र निर्देशन "
            "फार्मासिस्टसँग जाँच्नुहोस्। नयाँ मात्रा निकालिएको छैन।"
        ),
    ),
    "instruction": (
        (
            "An instruction recorded in the document. Check the original "
            "wording before acting; missing timing or amounts cannot be "
            "filled in."
        ),
        ("कागजातमा लेखिएको निर्देशन हो। पालना गर्नुअघि मूल पाठ जाँच्नुहोस्। नलेखिएको समय वा मात्रा थप्न मिल्दैन।"),
    ),
    "finding": (
        (
            "A finding or measurement recorded in the document. Its meaning "
            "depends on the report's units, ranges and your clinician's "
            "assessment."
        ),
        (
            "कागजातमा लेखिएको नतिजा वा मापन हो। यसको अर्थ एकाइ, रिपोर्टको "
            "दायरा र चिकित्सकको मूल्याङ्कनमा भर पर्छ।"
        ),
    ),
    "follow_up": (
        (
            "Follow-up wording from the document. Confirm when, where and "
            "with whom to return if any of these details are unclear."
        ),
        ("फेरि भेट्ने सम्बन्धी विवरण हो। कहिले, कहाँ र कसलाई भेट्ने अस्पष्ट भए चिकित्सकसँग सोध्नुहोस्।"),
    ),
    "other": (
        "Copied document text. Its clinical meaning has not been established by this reader.",
        "कागजातबाट लिइएको पाठ हो। यसको चिकित्सकीय अर्थ यस सेवाले पुष्टि गरेको छैन।",
    ),
}
