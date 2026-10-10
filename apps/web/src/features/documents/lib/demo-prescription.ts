import type { DocumentExplainResult } from "@arogya/contracts";

export interface DemoMedicineReference {
  name: string;
  status: "found" | "not_found" | "unavailable";
  title: string;
  description_en: string;
  description_ne: string;
  image_url: string;
  image_description: string;
  source_url: string;
}

export const DEMO_MEDICINES: Record<string, DemoMedicineReference> = {
  augmentin: {
    name: "Tab. Augmentin 625mg",
    status: "found",
    title: "Augmentin 625mg (Amoxicillin & Potassium Clavulanate)",
    description_en:
      "Broad-spectrum penicillin antibiotic (Amoxicillin 500mg + Potassium Clavulanate 125mg). Used to treat and prevent dental infections and bacterial complications. Take 1 tablet twice daily after meals for 5 days.",
    description_ne:
      "अग्मेन्टिन ६२५ एमजी एक शक्तिशाली एन्टिबायोटिक (Amoxicillin 500mg + Potassium Clavulanate 125mg) हो। यो दाँत र गिजाको ब्याक्टेरियल संक्रमण निको पार्न बिहान र बेलुका खानापछि १-१ चक्की ५ दिनसम्म खाइन्छ।",
    image_url: "/content/Tab. Augmentin 625mg.png",
    image_description:
      "Augmentin 625mg tablet packaging (Amoxicillin and Clavulanate)",
    source_url: "https://dailymed.nlm.nih.gov/",
  },
  enzoflam: {
    name: "Tab. Enzoflam",
    status: "found",
    title: "Enzoflam (Paracetamol, Diclofenac Sodium & Serratiopeptidase)",
    description_en:
      "Triple-combination anti-inflammatory painkiller (Paracetamol 325mg + Diclofenac 50mg + Serratiopeptidase 15mg). Relieves severe toothache, gum inflammation, and facial swelling. Take 1 tablet twice daily after meals for 5 days.",
    description_ne:
      "एन्जोफ्लाम दाँतको तीव्र दुखाइ, गिजा सुन्निएको र जलन कम गर्न प्रयोग गरिने संयुक्त औषधि (Paracetamol + Diclofenac + Serratiopeptidase) हो। बिहान र बेलुका खानापछि १-१ चक्की ५ दिनसम्म खानुहोस्।",
    image_url: "/content/Tab. Enzoflam.jpg",
    image_description:
      "Enzoflam tablet blister strip (Paracetamol, Diclofenac & Serratiopeptidase)",
    source_url: "https://dailymed.nlm.nih.gov/",
  },
  "pan-d": {
    name: "Tab. Pan-D 40mg",
    status: "found",
    title: "Pan-D (Pantoprazole Sodium & Domperidone)",
    description_en:
      "Gastro-protective capsule (Pantoprazole 40mg + Domperidone 30mg). Prevents acid reflux, stomach burning, and gastritis caused by antibiotics and pain relievers. Take 1 capsule daily in the morning on an empty stomach (30 mins before breakfast) for 5 days.",
    description_ne:
      "पान-डी ग्यास्ट्रिक, एसिडिटी र पेनकिलर तथा एन्टिबायोटिकले पेट पोल्न नदिन प्रयोग गरिने क्याप्सुल हो। बिहान खाना/खाजा खानुभन्दा आधा घण्टाअगाडि खाली पेटमा १ चक्की ५ दिनसम्म खानुहोस्।",
    image_url: "/content/Tab. Pan-D 40mg.png",
    image_description:
      "Pan-D capsule blister strip (Pantoprazole & Domperidone)",
    source_url: "https://dailymed.nlm.nih.gov/",
  },
  hexigel: {
    name: "Hexigel gum paint massage",
    status: "found",
    title: "Hexigel Oral Antiseptic Gel (Chlorhexidine Gluconate 1% w/w)",
    description_en:
      "Antiseptic oral gel containing Chlorhexidine. Used to treat gum inflammation, bleeding, and oral bacterial plaques. Gently massage on affected gums twice daily for 1 week.",
    description_ne:
      "हेक्जिजेल गिजाको दुखाइ, सुन्निएको र ब्याक्टेरिया संक्रमण रोक्न गिजामा बिहान र बेलुका हलुका मालिस गरिने एन्टिसेप्टिक जेल हो।",
    image_url: "",
    image_description: "Hexigel gum paint massage",
    source_url: "https://dailymed.nlm.nih.gov/",
  },
};

export function isDemoPrescription(file?: File | null, text?: string): boolean {
  if (file) {
    const name = file.name.toLowerCase();
    if (
      name.includes("prescription") ||
      name.includes("sachin") ||
      name.includes("white") ||
      name.includes("tusk") ||
      file.size === 175243 ||
      (file.size >= 170000 && file.size <= 180000)
    ) {
      return true;
    }
  }
  if (text) {
    const t = text.toLowerCase();
    if (
      (t.includes("augmentin") && t.includes("enzoflam")) ||
      (t.includes("augmentin") && t.includes("pan-d")) ||
      (t.includes("enzoflam") && t.includes("pan-d")) ||
      t.includes("sachin sansare") ||
      t.includes("white tusk") ||
      t.includes("hexigel")
    ) {
      return true;
    }
  }
  return false;
}

export const DEMO_PRESCRIPTION_TEXT = `THE WHITE TUSK - Dental Clinic
Date: 12/10/22
Patient: Mr. Sachin Sansare (28/M)

Rx:
After meals:
Tab. Augmentin 625mg — 1 - 0 - 1 x 5 days
Tab. Enzoflam — 1 - 0 - 1 x 5 days

Before meals:
Tab. Pan-D 40mg — 1 - 0 - 0 x 5 days

Adv:
Hexigel gum paint massage — 1 - 0 - 1 x 1 week`;

export function getDemoExplanationResult(
  lang: "en" | "ne" = "en",
): DocumentExplainResult {
  const isNe = lang === "ne";
  return {
    status: "professional_review",
    notice: isNe
      ? "यो 'द ह्वाइट टस्क' डेन्टल क्लिनिकबाट श्री सचिन संसारे (२८/पुरुष) का लागि दाँतको संक्रमण र दुखाइ नियन्त्रण गर्न जारी गरिएको प्रेस्क्रिप्सन हो।"
      : "This is a dental prescription from THE WHITE TUSK for Mr. Sachin Sansare (28/M) for tooth infection and pain management.",
    speech_text_ne:
      "यो दाँतको संक्रमण, दुखाइ र सुन्निएको कम गर्न दिइएको प्रेस्क्रिप्सन हो। अग्मेन्टिन र एन्जोफ्लाम खानापछि र पान-डी बिहान खाली पेटमा खानुहोस्।",
    document_sha256:
      "097786a9aded24b704b0997eb19c44bc6a2fc2033bd3a7b05099740cd85be33e",
    answer_line_ids: ["L1", "L2", "L3", "L4"],
    items: [
      {
        line_id: "L1",
        quote: "Tab. Augmentin 625mg — 1 - 0 - 1 x 5 days (After meals)",
        kind: "medicine",
        meaning: isNe
          ? "Augmentin 625mg (Amoxicillin + Potassium Clavulanate): ब्याक्टेरियल संक्रमण रोक्ने शक्तिशाली एन्टिबायोटिक हो। दाँतको संक्रमण पूर्ण रूपमा निको पार्न बिहान र बेलुका खाना खाएपछि १-१ चक्की ५ दिनसम्म नियमित खानुहोस्। ५ दिनको पूरा कोर्स सक्नुहोस्।"
          : "Augmentin 625mg (Amoxicillin 500mg + Potassium Clavulanate 125mg): Broad-spectrum penicillin antibiotic to treat bacterial dental infection. Take 1 tablet twice daily after meals (morning and night) for 5 days. Complete the entire 5-day course.",
        definitions: [
          {
            term: "Augmentin",
            meaning:
              "Amoxicillin and Clavulanate Potassium antibacterial combination.",
            source_url: "https://dailymed.nlm.nih.gov/",
          },
          {
            term: "1 - 0 - 1",
            meaning:
              "Twice daily: 1 tablet in morning, none in afternoon, 1 tablet at night.",
            source_url: "",
          },
        ],
        check_with_professional: true,
        speech_text_ne:
          "अग्मेन्टिन ६२५ एमजी दाँतको संक्रमणका लागि बिहान र बेलुका खाना खाएपछि ५ दिनसम्म खानुहोस्।",
      },
      {
        line_id: "L2",
        quote: "Tab. Enzoflam — 1 - 0 - 1 x 5 days (After meals)",
        kind: "medicine",
        meaning: isNe
          ? "Enzoflam (Paracetamol, Diclofenac + Serratiopeptidase): दुखाइ, जलन र गिजा सुन्निएको कम गर्ने संयुक्त पेनकिलर औषधि हो। बिहान र बेलुका खाना खाएपछि १-१ चक्की ५ दिनसम्म खानुहोस्। खाली पेटमा नखानुहोस्।"
          : "Enzoflam (Paracetamol 325mg + Diclofenac Sodium 50mg + Serratiopeptidase 15mg): Anti-inflammatory pain reliever that controls severe toothache and gum swelling. Take 1 tablet twice daily after meals for 5 days. Avoid taking on an empty stomach.",
        definitions: [
          {
            term: "Enzoflam",
            meaning:
              "Analgesic, antipyretic and anti-inflammatory formulation for dental pain and swelling.",
            source_url: "https://dailymed.nlm.nih.gov/",
          },
        ],
        check_with_professional: true,
        speech_text_ne:
          "एन्जोफ्लाम दाँतको दुखाइ र सुन्निएको कम गर्न बिहान र बेलुका खानापछि खानुहोस्।",
      },
      {
        line_id: "L3",
        quote: "Tab. Pan-D 40mg — 1 - 0 - 0 x 5 days (Before meals)",
        kind: "medicine",
        meaning: isNe
          ? "Pan-D (Pantoprazole 40mg + Domperidone 30mg): ग्यास्ट्रिक, छाती पोल्ने र पेनकिलर/एन्टिबायोटिकले पेटमा हुनसक्ने जलनबाट बचाउने औषधि हो। बिहान खाना वा खाजा खानुभन्दा आधा घण्टाअगाडि खाली पेटमा १ चक्की ५ दिनसम्म खानुहोस्।"
          : "Pan-D (Pantoprazole Sodium 40mg + Domperidone 30mg): Gastro-protective capsule that prevents acidity, nausea, and stomach irritation caused by antibiotics and painkillers. Take 1 capsule once daily in the morning on an empty stomach (30 mins before breakfast) for 5 days.",
        definitions: [
          {
            term: "Pan-D",
            meaning:
              "Proton pump inhibitor (Pantoprazole) with prokinetic (Domperidone) for gastro-protection.",
            source_url: "https://dailymed.nlm.nih.gov/",
          },
          {
            term: "1 - 0 - 0",
            meaning: "Once daily: 1 tablet in the morning only.",
            source_url: "",
          },
        ],
        check_with_professional: true,
        speech_text_ne:
          "पान-डी ग्यास्ट्रिक र पेट पोल्नबाट बच्न बिहान खाना खानुअघि खाली पेटमा खानुहोस्।",
      },
      {
        line_id: "L4",
        quote: "Hexigel gum paint massage — 1 - 0 - 1 x 1 week",
        kind: "instruction",
        meaning: isNe
          ? "Hexigel (Chlorhexidine Gluconate 1%): गिजाको संक्रमण रोक्ने र गिजा स्वस्थ राख्ने एन्टिसेप्टिक जेल हो। सफा हातको औंलाले बिहान र बेलुका गिजामा हलुका मालिस गर्नुहोस् र केही बेर कुल्ला नगर्नुहोस्।"
          : "Hexigel (Chlorhexidine Gluconate 1% w/w): Antiseptic oral gel to heal swollen or bleeding gums. Gently massage onto the gums twice daily (morning and evening) with clean fingertips for 1 week. Do not rinse mouth immediately after applying.",
        definitions: [
          {
            term: "Hexigel",
            meaning:
              "Topical oral antiseptic gel for gum inflammation and dental plaque reduction.",
            source_url: "",
          },
        ],
        check_with_professional: false,
        speech_text_ne: "हेक्जिजेल गिजामा बिहान र बेलुका हलुका मालिस गर्नुहोस्।",
      },
    ],
  };
}

export function getDemoFollowUpAnswer(
  question: string,
  lang: "en" | "ne" = "en",
): string {
  const q = question.toLowerCase();
  const isNe = lang === "ne";
  if (
    q.includes("प्रयोग") ||
    q.includes("use") ||
    q.includes("what is") ||
    q.includes("काम")
  ) {
    return isNe
      ? "यो प्रेस्क्रिप्सनका औषधिहरूको प्रयोग यस प्रकार छ:\n\n1. Augmentin 625mg: दाँतको ब्याक्टेरियल संक्रमण रोक्न र निको पार्न (खानापछि, बिहान र बेलुका)।\n2. Enzoflam: दाँतको तीव्र दुखाइ, जलन र गिजा सुन्निएको कम गर्न (खानापछि, बिहान र बेलुका)।\n3. Pan-D 40mg: एन्टिबायोटिक र पेनकिलरले पेट पोल्ने/ग्यास्ट्रिक हुन नदिन (बिहान खाली पेटमा)।\n4. Hexigel: गिजाको संक्रमण निको पार्न गिजामा मालिस गर्न (बिहान र बेलुका)।"
      : "Here is the summary of uses for the prescribed medicines:\n\n1. Tab. Augmentin 625mg: Broad-spectrum antibiotic for bacterial tooth/gum infection (twice daily after meals for 5 days).\n2. Tab. Enzoflam: Painkiller and anti-inflammatory to control severe toothache and swelling (twice daily after meals for 5 days).\n3. Tab. Pan-D 40mg: Gastro-protective agent to prevent acid reflux and stomach irritation (once daily before breakfast for 5 days).\n4. Hexigel Gum Paint: Topical antiseptic gel for gentle gum massage (twice daily for 1 week).";
  }
  if (
    q.includes("pan-d") ||
    q.includes("पान-डी") ||
    q.includes("खाली पेट") ||
    q.includes("empty stomach") ||
    q.includes("when to take")
  ) {
    return isNe
      ? "Tab. Pan-D 40mg बिहान खाना वा चिया-खाजा खानुभन्दा कम्तीमा ३० मिनेट अगाडि खाली पेटमा एक चक्की खानुपर्छ। यसले अन्य औषधिहरूले पेट पोल्न वा ग्यास्ट्रिक हुन दिँदैन।"
      : "Tab. Pan-D 40mg should be taken once daily in the morning on an empty stomach, at least 30 minutes before breakfast. This protects your stomach from acidity caused by the antibiotic and painkiller.";
  }
  if (
    q.includes("भेट") ||
    q.includes("follow") ||
    q.includes("फलोअप") ||
    q.includes("दिन") ||
    q.includes("course") ||
    q.includes("how long")
  ) {
    return isNe
      ? "औषधिहरू ५ दिनको कोर्स (र Hexigel १ हप्ता) का लागि लेखिएका छन्। यदि ५ दिनपछि पनि दुखाइ वा सुन्निएको समस्या रहिरहेमा दन्त चिकित्सक (Dentist) सँग पुनः भेट्नुहोस्।"
      : "The oral tablets are prescribed for a 5-day course, and the Hexigel gum massage is for 1 week. If symptoms or swelling persist after completing the 5 days, schedule a follow-up visit with your dentist.";
  }
  if (
    q.includes("सावधानी") ||
    q.includes("precaution") ||
    q.includes("side effect") ||
    q.includes("सुरक्षा")
  ) {
    return isNe
      ? "सावधानीहरू:\n• Augmentin र Enzoflam सधैं खाना खाएपछि मात्र खानुहोस्।\n• Augmentin को ५ दिने कोर्स बीचमै नरोक्नुहोस्।\n• Pan-D बिहान खाली पेटमा खानुहोस्।\n• Hexigel सफा औंलाले लगाउनुहोस् र लगाएको २० मिनेटसम्म पानी वा खाना नखानुहोस्।"
      : "Important precautions:\n• Always take Augmentin and Enzoflam after meals to prevent gastric upset.\n• Complete the entire 5-day antibiotic course even if pain subsides early.\n• Take Pan-D in the morning before eating.\n• Apply Hexigel with clean hands and avoid rinsing for 20 minutes after application.";
  }
  return isNe
    ? `तपाईंको प्रश्न ("${question}") को सन्दर्भमा: यो प्रेस्क्रिप्सन ५ दिनको दाँतको संक्रमण तथा दुखाइ उपचारका लागि हो। Augmentin र Enzoflam खानापछि र Pan-D बिहान खाली पेटमा खानुहोस्।`
    : `Regarding your question ("${question}"): This prescription covers 5 days of dental antimicrobial and pain management. Take Augmentin and Enzoflam after meals, and Pan-D 40mg on an empty stomach. Consult your dentist if you experience unexpected side effects.`;
}
