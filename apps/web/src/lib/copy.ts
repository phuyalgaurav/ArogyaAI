export const copy = {
  en: {
    brand: "ArogyaAI",
    builtForNepal: "BUILT FOR NEPAL",
    eyebrow: "BUILT FOR NEPAL",
    title: "Health information, closer to home.",
    description:
      "ArogyaAI is a private, local-first companion for understanding health guidance, medicines, and prescriptions in Nepal.",
    skipToContent: "Skip to content",
    languageSelect: "Language / भाषा",
    tamangNotice:
      "The interface uses English. Tamang translation drafts are in Language & voice; reviewed Tamang medical answers are still being prepared.",

    // Legacy shell keys
    privacy: "Your information stays with you",
    privacyBody:
      "This page sends no health questions or images. The development backend requires consent before forwarding questions to its AI worker.",
    foundation: "The foundation is ready",
    foundationBody:
      "The interface, API, and shared data contracts are in place. Medical features will be enabled only as their evidence and safety checks are ready.",
    next: "What comes next",
    library: "Health library",
    libraryBody:
      "Reviewed information with clear sources, prepared for offline access.",
    medicine: "Understand a medicine",
    medicineBody: "Catalog candidates and source-backed explanations.",
    prescription: "Read a prescription",
    prescriptionBody:
      "Transcription with visible uncertainty and professional review.",
    planned: "Planned",

    // Navigation Tabs
    navChat: "Ask ArogyaAI",
    navKnowledge: "Health Library",
    navMedicines: "Medicine Lookup",
    navPrivacy: "Privacy & Session",

    // Consent Dialogue
    consentTitle: "Consent for AI Health Assistance",
    consentSubtitle: "Local, privacy-first evidence extraction",
    consentBody:
      "Before sending health questions, processing requires your explicit consent. Your question is analyzed locally to extract facts exclusively from reviewed medical sources.",
    consentDataCategory: "Data category: Message text only",
    consentStorageNotice:
      "Chats are saved in SQLite on this browser. Server history requires separate permission. Anonymous session tokens remain in memory.",
    consentPurpose: "Purpose: Evidence-backed health information assistance",
    consentDuration: "Validity: 1 hour (auto-expiring)",
    grantConsentBtn: "Grant Consent & Continue",
    declineConsentBtn: "Decline / Browse Only",
    revokeConsentBtn: "Revoke Active Consent",
    consentGrantedBadge: "Consent Active",
    consentRevokedBadge: "Consent Revoked",
    consentRequiredNotice:
      "Consent is required before submitting health questions to the server worker.",

    // Chat Interface
    chatTitle: "Ask a Health Question",
    chatSubtitle:
      "Ask by typing or Nepali voice. Health answers require available reviewed content.",
    chatPlaceholder: "Type a health question or select a reviewed topic...",
    askBtn: "Ask ArogyaAI",
    consulting: "Analyzing evidence…",
    suggestedQuestions: "Reviewed Topics & Questions",
    noQuestionsAvailable:
      "No approved questions found in the catalog. The default catalog is empty pending clinical review.",
    openImageReader: "Read an image",
    openLanguageTools: "Open language & voice",
    browseReviewedQuestions: "Browse reviewed questions",
    clearChat: "New chat",
    modeLabel: "Processing",
    modeStatic: "Safety and reference checks",
    modelLabel: "Model",
    evidenceLabel: "Citations & Evidence",
    sourceLabel: "Source",
    sectionLabel: "Section",
    safetyRulesTriggered: "Safety policies evaluated",
    abstainedLabel: "Abstained from generative advice",

    // Answer Statuses
    statusAnswered: "Reviewed Source Answer",
    statusClarification: "Needs Clarification",
    statusProfessionalReview: "Professional Consultation Required",
    statusUrgent: "Urgent Medical Attention Advised",
    statusUnavailable: "Evidence Unavailable",

    statusProfessionalReviewNote:
      "This question involves a personal medical decision or diagnosis. ArogyaAI does not provide individual prescriptions or dosing advice. Please consult a licensed doctor or pharmacist.",
    statusUrgentNote:
      "Emergency symptoms or high-risk medical alerts detected. Please seek immediate urgent medical care. In Nepal, dial 102 for emergency ambulance services or visit your nearest emergency room immediately.",

    // Knowledge Catalog
    knowledgeTitle: "Reviewed Health Knowledge",
    knowledgeSubtitle:
      "Browse approved medical sections, source licenses, and validated questions.",
    knowledgeEmptyTitle: "Catalog is Currently Empty",
    knowledgeEmptyBody:
      "To safeguard public health in Nepal, ArogyaAI strictly answers from licensed, clinically reviewed sources. No production sources have been approved yet.",
    searchQuestions: "Search reviewed questions…",
    sourceDetails: "Source Details",
    licenseLabel: "License",
    versionLabel: "Version",
    validUntilLabel: "Valid Until",
    statusLabel: "Review Status",

    // Medicine Directory
    medicineTitle: "Medicine info",
    medicineSubtitle: "Identify candidate medicines by generic or brand name.",
    medicineSearchPlaceholder: "Enter medicine name (e.g., Paracetamol)…",
    medicineLookupBtn: "Search Directory",
    medicineSearching: "Searching…",
    medicineWarning:
      "Candidate medicines are unverified matches. Professional confirmation by a licensed pharmacist or doctor is mandatory before taking any medication.",
    activeIngredients: "Active Ingredients",
    jurisdiction: "Jurisdiction",
    aliases: "Known Aliases",
    noMedicineFound: "No matching candidate found in the reviewed directory.",

    // Privacy & Session Management
    privacyTitle: "Anonymous Session & Data Controls",
    privacySubtitle:
      "Manage processing permissions and session metadata here. Chat history and optional server copies have separate controls.",
    tokenLabel: "Session Token",
    sessionExpires: "Expires at",
    sessionActive: "Session Active",
    sessionExpired: "Session Expired",
    createNewSession: "Create New Session",
    exportDataBtn: "Export My Metadata",
    deleteDataBtn: "Delete All Session Data",
    deleteSuccess: "Session metadata has been permanently deleted.",
    exportTitle: "Exported Session Metadata",

    // General & Footer
    development: "DEVELOPMENT CONNECTION",
    check: "Check local API",
    checking: "Checking…",
    idle: "Check the local development server when you need it.",
    ready: "API connected. Health information still requires approved sources.",
    unavailable: "API unavailable. Start it with pnpm dev:api and try again.",
    requestNote:
      "Sends a metadata request only. No personal or health information is shared.",
    footer:
      "ArogyaAI · Multilingual health companion for Nepal · Not a substitute for professional clinical medical advice.",
  },
  ne: {
    brand: "आरोग्यएआई",
    builtForNepal: "नेपालका लागि",
    eyebrow: "नेपालका लागि",
    title: "स्वास्थ्य जानकारी, तपाईंको नजिक।",
    description:
      "आरोग्यएआई नेपालका लागि स्वास्थ्य जानकारी, औषधि र प्रेस्क्रिप्सन बुझ्न सघाउने निजी, स्थानीय सहयोगी हो।",
    skipToContent: "सामग्रीमा जानुहोस्",
    languageSelect: "Language / भाषा",
    tamangNotice:
      "यो इन्टरफेस अंग्रेजीमा छ। भाषा र आवाजमा तामाङ अनुवाद मस्यौदा उपलब्ध छ; समीक्षित तामाङ स्वास्थ्य उत्तर तयार हुँदै छन्।",

    // Legacy shell keys
    privacy: "तपाईंको जानकारी तपाईंसँगै",
    privacyBody:
      "यो पृष्ठले स्वास्थ्य प्रश्न वा फोटो पठाउँदैन। विकास ब्याकएन्डले प्रश्न एआईमा पठाउनुअघि अनुमति माग्छ।",
    foundation: "आधार तयार छ",
    foundationBody:
      "इन्टरफेस, एपीआई र साझा डेटा संरचना तयार छन्। प्रमाण र सुरक्षा जाँच तयार भएपछि स्वास्थ्य सुविधा थपिनेछन्।",
    next: "अब आउने सुविधाहरू",
    library: "स्वास्थ्य पुस्तकालय",
    libraryBody: "स्पष्ट स्रोतसहित समीक्षा गरिएको जानकारी, अफलाइन पहुँचका लागि।",
    medicine: "औषधि बुझ्नुहोस्",
    medicineBody: "प्रमाणित औषधि पहिचान र स्रोतमा आधारित जानकारी।",
    prescription: "प्रेस्क्रिप्सन पढ्नुहोस्",
    prescriptionBody: "अस्पष्टता देखाउने लिप्यन्तरण र स्वास्थ्यकर्मीको समीक्षा।",
    planned: "योजनामा",

    // Navigation Tabs
    navChat: "आरोग्यएआईसँग सोध्नुहोस्",
    navKnowledge: "स्वास्थ्य पुस्तकालय",
    navMedicines: "औषधि खोजी",
    navPrivacy: "गोपनीयता र सत्र",

    // Consent Dialogue
    consentTitle: "एआई स्वास्थ्य सहयोगका लागि सहमति",
    consentSubtitle: "स्थानीय र निजी प्रमाणमा आधारित प्रक्रिया",
    consentBody:
      "स्वास्थ्य प्रश्न पठाउनुअघि तपाईंको स्पष्ट सहमति आवश्यक छ। तपाईंको प्रश्नको जवाफ स्वीकृत चिकित्सा स्रोतहरूबाट मात्र निकालिन्छ।",
    consentDataCategory: "साझा हुने विवरण: प्रश्नको पाठ मात्र",
    consentStorageNotice:
      "कुराकानी यस ब्राउजरको SQLite मा सुरक्षित हुन्छ। सर्भरमा इतिहास राख्न छुट्टै अनुमति चाहिन्छ। सत्र टोकन मेमोरीमा रहन्छ।",
    consentPurpose: "उद्देश्य: प्रमाणमा आधारित स्वास्थ्य जानकारी सहयोग",
    consentDuration: "अवधि: १ घण्टा (स्वतः समाप्त हुने)",
    grantConsentBtn: "सहमति दिन्छु र अगाडि बढ्छु",
    declineConsentBtn: "अस्वीकार / पढ्न मात्र",
    revokeConsentBtn: "सहमति खारेज गर्नुहोस्",
    consentGrantedBadge: "सहमति सक्रिय छ",
    consentRevokedBadge: "सहमति खारेज भयो",
    consentRequiredNotice: "स्वास्थ्य प्रश्न पठाउनका लागि पहिले सहमति प्रदान गर्नुपर्छ।",

    // Chat Interface
    chatTitle: "स्वास्थ्य प्रश्न सोध्नुहोस्",
    chatSubtitle:
      "उत्तरहरू स्वीकृत चिकित्सा स्रोतबाट मात्र निकालिन्छन्। व्यक्तिगत जोखिमपूर्ण निर्णयहरू स्वास्थ्यकर्मीमा पठाइन्छ।",
    chatPlaceholder: "स्वास्थ्य प्रश्न लेख्नुहोस् वा तलबाट विषय छान्नुहोस्…",
    askBtn: "सोध्नुहोस्",
    consulting: "प्रमाण जाँच हुँदैछ…",
    suggestedQuestions: "स्वीकृत विषय र प्रश्नहरू",
    noQuestionsAvailable:
      "पुस्तकालयमा कुनै स्वीकृत प्रश्न भेटिएन। क्लिनिकल समीक्षा नभएसम्म मुख्य पुस्तकालय खाली छ।",
    openImageReader: "तस्बिर पढ्नुहोस्",
    openLanguageTools: "भाषा र आवाज खोल्नुहोस्",
    browseReviewedQuestions: "स्वीकृत प्रश्नहरू हेर्नुहोस्",
    clearChat: "कुराकानी खाली गर्नुहोस्",
    modeLabel: "प्रक्रिया",
    modeStatic: "सुरक्षा र स्रोतको जाँच",
    modelLabel: "मोडेल",
    evidenceLabel: "प्रमाण र स्रोत",
    sourceLabel: "स्रोत",
    sectionLabel: "खण्ड",
    safetyRulesTriggered: "सुरक्षा नीति जाँच",
    abstainedLabel: "अपुष्ट सल्लाह दिन अस्वीकार",

    // Answer Statuses
    statusAnswered: "समीक्षित स्रोतबाट उत्तर",
    statusClarification: "थप स्पष्टता आवश्यक",
    statusProfessionalReview: "चिकित्सकको परामर्श आवश्यक",
    statusUrgent: "तत्काल आकस्मिक उपचार आवश्यक",
    statusUnavailable: "प्रमाण उपलब्ध छैन",

    statusProfessionalReviewNote:
      "यो प्रश्न व्यक्तिगत चिकित्सा निर्णय वा औषधिको मात्रासँग सम्बन्धित छ। आरोग्यएआईले व्यक्तिगत सिफारिस गर्दैन। कृपया दर्तावाला चिकित्सक वा फार्मासिस्टसँग सम्पर्क गर्नुहोस्।",
    statusUrgentNote:
      "गम्भीर वा आकस्मिक स्वास्थ्य लक्षण देखिएको छ। तत्काल नजिकको अस्पताल वा आकस्मिक कक्षमा जानुहोस्। नेपालमा एम्बुलेन्स सेवाका लागि १०२ मा फोन गर्नुहोस्।",

    // Knowledge Catalog
    knowledgeTitle: "स्वीकृत स्वास्थ्य पुस्तकालय",
    knowledgeSubtitle:
      "समीक्षा गरिएका चिकित्सा सामग्री, इजाजतपत्र र प्रमाणित प्रश्नहरू हेर्नुहोस्।",
    knowledgeEmptyTitle: "पुस्तकालय हाल खाली छ",
    knowledgeEmptyBody:
      "नेपालको जनस्वास्थ्य सुरक्षालाई ध्यानमा राखी आरोग्यएआईले प्रमाणित स्रोतबाट मात्र उत्तर दिन्छ। हालसम्म कुनै पनि उत्पादन स्रोत स्वीकृत भइसकेको छैन।",
    searchQuestions: "प्रश्न खोज्नुहोस्…",
    sourceDetails: "स्रोत विवरण",
    licenseLabel: "इजाजतपत्र",
    versionLabel: "संस्करण",
    validUntilLabel: "मान्य अवधि",
    statusLabel: "समीक्षा स्थिति",

    // Medicine Directory
    medicineTitle: "औषधि जानकारी",
    medicineSubtitle: "जेनेरिक वा ब्रान्ड नामबाट सम्भावित औषधि खोज्नुहोस्।",
    medicineSearchPlaceholder: "औषधिको नाम लेख्नुहोस् (जस्तै: Paracetamol)…",
    medicineLookupBtn: "औषधि खोज्नुहोस्",
    medicineSearching: "खोज्दैछ…",
    medicineWarning:
      "यहाँ देखाइएका औषधिहरू अप्रमाणित सम्भावित सूची मात्र हुन्। कुनै पनि औषधि प्रयोग गर्नुअघि चिकित्सक वा फार्मासिस्टबाट प्रमाणीकरण अनिवार्य छ।",
    activeIngredients: "सक्रिय तत्वहरू",
    jurisdiction: "क्षेत्राधिकार",
    aliases: "अन्य नामहरू",
    noMedicineFound: "निर्देशिकामा कुनै मिल्दो औषधि भेटिएन।",

    // Privacy & Session Management
    privacyTitle: "गोप्य सत्र र डेटा नियन्त्रण",
    privacySubtitle:
      "यहाँ सत्र र प्रक्रिया अनुमतिहरू हेर्नुहोस्। कुराकानी इतिहास र वैकल्पिक सर्भर प्रतिको छुट्टै नियन्त्रण छ।",
    tokenLabel: "सत्र टोकन",
    sessionExpires: "समाप्त हुने समय",
    sessionActive: "सत्र सक्रिय छ",
    sessionExpired: "सत्र समाप्त भयो",
    createNewSession: "नयाँ सत्र सुरु गर्नुहोस्",
    exportDataBtn: "मेरो मेटाडेटा डाउनलोड/हेर्नुहोस्",
    deleteDataBtn: "सबै सत्र डेटा मेटाउनुहोस्",
    deleteSuccess: "सत्र र सहमतिको सबै डेटा पूर्ण रूपमा मेटाइयो।",
    exportTitle: "निर्यात गरिएको मेटाडेटा",

    // General & Footer
    development: "विकास सर्भरको जडान",
    check: "स्थानीय एपीआई जाँच्नुहोस्",
    checking: "जाँच हुँदैछ…",
    idle: "आवश्यक पर्दा स्थानीय विकास सर्भर जाँच्नुहोस्।",
    ready: "एपीआई जोडिएको छ। स्वास्थ्य जानकारीका लागि स्वीकृत स्रोत आवश्यक छन्।",
    unavailable: "एपीआई उपलब्ध छैन। pnpm dev:api चलाएर फेरि प्रयास गर्नुहोस्।",
    requestNote: "सेवाको जानकारी मात्र मागिन्छ। व्यक्तिगत वा स्वास्थ्य विवरण पठाइँदैन।",
    footer:
      "आरोग्यएआई · नेपालका लागि बहुभाषिक स्वास्थ्य सहयोगी · यो चिकित्सकको सल्लाहको विकल्प होइन।",
  },
};
