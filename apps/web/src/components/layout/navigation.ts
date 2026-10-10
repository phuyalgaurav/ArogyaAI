export type WorkspaceTab =
  | "dashboard"
  | "transcription"
  | "medicines"
  | "history"
  | "chat";

export type WorkspaceLocale = "en" | "ne" | "tam";

export const workspacePaths: Record<WorkspaceTab, string> = {
  dashboard: "/dashboard/",
  transcription: "/transcription/",
  medicines: "/medicines/",
  history: "/history/",
  chat: "/chat/",
};

export const workspaceTabs = Object.keys(workspacePaths) as WorkspaceTab[];

export function destinationForPath(pathname: string): WorkspaceTab {
  const segment = pathname.replace(/^\/+|\/+$/g, "");
  return workspaceTabs.find((tab) => tab === segment) || "dashboard";
}

export function destinationForHash(hash: string): WorkspaceTab | null {
  const segment = hash.replace(/^#/, "");
  if (["home", "dashboard"].includes(segment)) return "dashboard";
  if (
    ["images", "prescriptions", "documents", "transcription"].includes(segment)
  )
    return "transcription";
  return workspaceTabs.find((tab) => tab === segment) || null;
}

export function isConversationPage(tab: WorkspaceTab) {
  return tab === "transcription" || tab === "medicines" || tab === "chat";
}

export function destinationForMode(mode?: string): WorkspaceTab {
  return mode === "document"
    ? "transcription"
    : mode === "medicine"
      ? "medicines"
      : "chat";
}

export function pageCopy(locale: WorkspaceLocale) {
  const ne = locale === "ne";
  return {
    dashboard: {
      title: ne ? "ड्यासबोर्ड" : "Dashboard",
      description: ne
        ? "कागजात उतार्नुहोस्, औषधि जानकारी हेर्नुहोस् वा स्वास्थ्य जिज्ञासा सोध्नुहोस्।"
        : "Transcribe a document, find medicine information or ask a health question.",
    },
    transcription: {
      title: ne
        ? "प्रेस्क्रिप्सन र रिपोर्ट उतार"
        : "Prescription / Report transcription",
      description: ne
        ? "कागजातको फोटो वा पाठ राख्नुहोस्। शब्द जाँच्नुहोस्, त्यसपछि छलफल गर्नुहोस्।"
        : "Capture or paste a document. Check the wording, then discuss it.",
    },
    medicines: {
      title: ne ? "औषधि जानकारी" : "Medicine info",
      description: ne
        ? "लेबलको फोटो राख्नुहोस् वा नाम खोज्नुहोस्। छलफल गर्नुअघि सम्भावित पहिचान जाँच्नुहोस्।"
        : "Photograph a label or search by name. Review the possible identity before discussing it.",
    },
    history: {
      title: ne ? "विगतका कुराकानीहरू" : "Past chat records",
      description: ne
        ? "कागजात, औषधि तथा स्वास्थ्य सम्बन्धी विगतका कुराकानी खोल्नुहोस् वा जारी राख्नुहोस्।"
        : "Find and continue a document, medicine or health conversation.",
    },
    chat: {
      title: ne ? "स्वास्थ्य जिज्ञासा" : "Quick health question",
      description: ne
        ? "टाइप गरेर वा नेपालीमा बोलेर प्रश्न सोध्नुहोस् र थप प्रश्नसहित कुराकानी जारी राख्नुहोस्।"
        : "Ask by typing or Nepali voice, then continue with follow-up questions.",
    },
  };
}
