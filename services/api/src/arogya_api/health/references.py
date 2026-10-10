"""Public-source education, separate from the clinically reviewed medicine catalog.

Original summaries checked against the linked publisher pages on 2026-10-10.
Nepali text is an ArogyaAI translation, not a WHO/NHS or clinical endorsement.
These references are never imported into the review database or offline bundles.
"""

from datetime import UTC, datetime
from functools import lru_cache

from arogya_api.knowledge.models import EvidenceSentence, KnowledgeSource, ReviewedQuestion
from arogya_api.knowledge.store import normalized_question

VERSION = "public-education-2026-10-10"
EXPIRES = datetime(2027, 4, 10, tzinfo=UTC)

# Each entry contains a publisher URL and two bounded education sections per language.
TOPICS = (
    (
        "fever",
        "NHS · Fever in adults",
        "https://www.nhs.uk/symptoms/fever-in-adults/",
        (
            (
                "definition",
                ["What is a fever?", "What temperature counts as a fever?"],
                "In adults, a temperature of 38°C or higher is usually considered a fever. "
                "Normal temperature varies through the day. Feeling hot, cold or shivery can "
                "still indicate a fever even when a thermometer reads below 38°C.",
            ),
            (
                "care",
                [
                    "What are the general self-care steps for an adult fever?",
                    "When does an adult fever need medical help?",
                ],
                "General self-care for an adult fever includes rest and drinking fluids. "
                "Seek medical advice if the fever is getting worse or is not "
                "improving with self-care.",
            ),
        ),
        (
            (
                "definition",
                ["ज्वरो भनेको के हो?", "कति तापक्रमलाई ज्वरो भनिन्छ?"],
                "वयस्कमा सामान्यतया ३८ डिग्री सेल्सियस वा बढी तापक्रमलाई ज्वरो भनिन्छ। "
                "सामान्य तापक्रम दिनभरि बदलिन्छ। थर्मोमिटरमा ३८ भन्दा कम भए पनि "
                "तातो, चिसो वा काम्ने अनुभव हुँदा ज्वरो हुन सक्छ।",
            ),
            (
                "care",
                ["वयस्कको ज्वरोमा सामान्य हेरचाह के हो?", "ज्वरो हुँदा कहिले स्वास्थ्यकर्मीलाई भेट्ने?"],
                "वयस्कको ज्वरोमा सामान्य हेरचाहमा आराम र तरल पदार्थ पिउनु पर्छ। "
                "घरमा हेरचाह गर्दा पनि ज्वरो बढ्दै गएमा वा सुधार नभएमा "
                "स्वास्थ्यकर्मीको सल्लाह लिनुहोस्।",
            ),
        ),
    ),
    (
        "hydration",
        "WHO · Diarrhoea and dehydration",
        "https://www.who.int/news-room/fact-sheets/detail/diarrhoeal-disease",
        (
            (
                "definition",
                ["What is dehydration?", "Why can diarrhoea cause dehydration?"],
                "Dehydration occurs when lost water and salts are not replaced. Diarrhoea "
                "can cause these losses through loose stools and vomiting.",
            ),
            (
                "prevention",
                [
                    "How can diarrhoeal disease be prevented?",
                    "When does diarrhoea need professional care?",
                ],
                "Safe drinking water, sanitation and handwashing with soap help prevent "
                "diarrhoeal disease. Persistent diarrhoea, blood in stools or signs of "
                "dehydration need professional assessment.",
            ),
        ),
        (
            (
                "definition",
                ["निर्जलीकरण भनेको के हो?", "पखालाले किन निर्जलीकरण गराउँछ?"],
                "शरीरबाट गुमेको पानी र लवण पूर्ति नहुँदा निर्जलीकरण हुन्छ। "
                "पखाला र बान्ताबाट पानी र लवण गुम्न सक्छन्।",
            ),
            (
                "prevention",
                ["पखालाबाट कसरी बच्न सकिन्छ?", "पखाला हुँदा कहिले स्वास्थ्यकर्मीको सहायता चाहिन्छ?"],
                "सफा पिउने पानी, सरसफाइ र साबुनले हात धुनुले पखालाबाट बच्न मद्दत गर्छ। "
                "लामो समय पखाला लागेमा, दिसामा रगत देखिएमा वा निर्जलीकरणका लक्षण "
                "भएमा स्वास्थ्यकर्मीलाई देखाउनुहोस्।",
            ),
        ),
    ),
    (
        "diet",
        "WHO · Healthy diet",
        "https://www.who.int/news-room/fact-sheets/detail/healthy-diet",
        (
            (
                "variety",
                ["What makes a healthy diet?", "What foods are part of a balanced diet?"],
                "A varied diet includes vegetables, fruit, whole grains, pulses and suitable "
                "protein sources. Dietary needs depend on age, activity and "
                "individual circumstances.",
            ),
            (
                "limits",
                ["What foods should a healthy diet limit?", "Why limit salt and sugary foods?"],
                "A healthy diet limits foods high in salt, free sugars and unhealthy fats. "
                "Highly processed foods often contain large amounts of these ingredients.",
            ),
        ),
        (
            (
                "variety",
                ["स्वस्थ आहार भनेको के हो?", "सन्तुलित आहारमा कुन खाना पर्छन्?"],
                "विविध आहारमा तरकारी, फलफूल, सिङ्गो अन्न, दाल र उपयुक्त प्रोटिनका स्रोत पर्छन्। "
                "खानाको आवश्यकता उमेर, शारीरिक गतिविधि र व्यक्तिगत अवस्थामा भर पर्छ।",
            ),
            (
                "limits",
                ["स्वस्थ आहारमा कुन खाना कम खाने?", "नुन र गुलियो खाना किन कम गर्ने?"],
                "स्वस्थ आहारमा धेरै नुन, चिनी र अस्वस्थ बोसो भएका खाना सीमित गरिन्छन्। "
                "धेरै प्रशोधित खानामा यी पदार्थ बढी हुन सक्छन्।",
            ),
        ),
    ),
    (
        "activity",
        "WHO · Physical activity",
        "https://www.who.int/news-room/fact-sheets/detail/physical-activity",
        (
            (
                "benefits",
                ["Why is physical activity important?", "What are the benefits of exercise?"],
                "Regular physical activity supports heart health, mental well-being and sleep. "
                "It helps lower the risk of conditions such as cardiovascular "
                "disease and type 2 diabetes.",
            ),
            (
                "movement",
                ["What counts as physical activity?", "Does walking count as exercise?"],
                "Walking, cycling, sports, play and everyday movement can all count as physical "
                "activity. Some activity is better than none, and reducing "
                "prolonged sitting is beneficial.",
            ),
        ),
        (
            (
                "benefits",
                ["शारीरिक गतिविधि किन आवश्यक छ?", "व्यायामका फाइदा के हुन्?"],
                "नियमित शारीरिक गतिविधिले मुटुको स्वास्थ्य, मानसिक स्वास्थ्य र "
                "निद्रामा सहयोग गर्छ। "
                "यसले मुटुसम्बन्धी रोग र टाइप २ मधुमेहको जोखिम घटाउन मद्दत गर्छ।",
            ),
            (
                "movement",
                ["कुन कामलाई शारीरिक गतिविधि भनिन्छ?", "हिँड्नु पनि व्यायाम हो?"],
                "हिँड्ने, साइकल चलाउने, खेल्ने र दैनिक चलफिर शारीरिक गतिविधिमा पर्छन्। "
                "केही गतिविधि गर्नु केही नगर्नुभन्दा राम्रो हो। लामो समय बसिरहने "
                "बानी कम गर्नु लाभदायक हुन्छ।",
            ),
        ),
    ),
    (
        "antibiotics",
        "NHS · Antibiotics",
        "https://www.nhs.uk/medicines/antibiotics/",
        (
            (
                "purpose",
                ["What are antibiotics?", "What do antibiotics treat?"],
                "Antibiotics treat or prevent some bacterial infections. They do not work "
                "against viruses such as those causing colds and flu.",
            ),
            (
                "resistance",
                ["What is antibiotic resistance?", "Why avoid unnecessary antibiotics?"],
                "Unnecessary antibiotic use contributes to resistance, which can make "
                "antibiotics less effective in future. A clinician decides "
                "whether an antibiotic is needed.",
            ),
        ),
        (
            (
                "purpose",
                ["एन्टिबायोटिक भनेको के हो?", "एन्टिबायोटिकले के उपचार गर्छ?"],
                "एन्टिबायोटिकले केही ब्याक्टेरियाका संक्रमणको उपचार वा रोकथाम गर्छ। "
                "रुघाखोकी र फ्लु गराउने भाइरसमा यसले काम गर्दैन।",
            ),
            (
                "resistance",
                ["एन्टिबायोटिक प्रतिरोध भनेको के हो?", "अनावश्यक एन्टिबायोटिक किन नखाने?"],
                "अनावश्यक एन्टिबायोटिक प्रयोगले प्रतिरोध बढाउन सक्छ, जसले "
                "भविष्यमा औषधिको प्रभाव घटाउन सक्छ। "
                "एन्टिबायोटिक आवश्यक छ कि छैन भन्ने निर्णय स्वास्थ्यकर्मीले गर्छन्।",
            ),
        ),
    ),
)


@lru_cache(maxsize=1)
def _sources():
    return tuple(
        KnowledgeSource(
            source_id=f"public-{topic}-{language}",
            title=title,
            version=VERSION,
            language=language,
            source_url=url,
            license="Original ArogyaAI educational summary; publisher material "
            "retains its own terms. "
            "Nepali text is an ArogyaAI translation. Not independently clinically reviewed.",
            review_status="public_reference",
            valid_until=EXPIRES,
            sections=[
                {"id": sid, "questions": questions, "sentences": [text]}
                for sid, questions, text in sections
            ],
        )
        for topic, title, url, english, nepali in TOPICS
        for language, sections in (("en", english), ("ne", nepali))
    )


def sources(language=None):
    return [
        s.model_copy(deep=True)
        for s in _sources()
        if s.valid_until > datetime.now(UTC) and (language is None or s.language == language)
    ]


def source_get(source_id):
    return next((s for s in sources() if s.source_id == source_id), None)


def questions(language):
    # Show a variety of topics before alternate wording of the same question.
    ranked = [
        (
            (alias, section_index, source_index),
            ReviewedQuestion(
                question=q,
                language=language,
                source_id=s.source_id,
                section_id=section.id,
                version=s.version,
            ),
        )
        for source_index, s in enumerate(sources(language))
        for section_index, section in enumerate(s.sections)
        for alias, q in enumerate(section.questions)
    ]
    return [question for _, question in sorted(ranked, key=lambda row: row[0])]


def available_questions(store, language, limit=100):
    reviewed = store.questions(language, limit)
    known = {normalized_question(q.question) for q in reviewed}
    return (
        reviewed + [q for q in questions(language) if normalized_question(q.question) not in known]
    )[:limit]


def retrieve(message, language):
    for source in sources(language):
        for section in source.sections:
            if any(
                normalized_question(message) == normalized_question(q) for q in section.questions
            ):
                return [
                    EvidenceSentence(
                        id=f"s{i + 1}",
                        source_id=source.source_id,
                        section_id=section.id,
                        version=source.version,
                        text=text,
                    )
                    for i, text in enumerate(section.sentences)
                ]
    return []
