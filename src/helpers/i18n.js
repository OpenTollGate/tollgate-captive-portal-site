// import i18next core and react integration
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import HttpBackend from "i18next-http-backend";
import LanguageDetector from "i18next-browser-languagedetector";

// list of supported languages for the app
export const supportedLanguages = [
  "en", "zh-Hans", "zh-Hant", "es", "fr", "ar", "pt",
  "ru", "id", "de", "ja", "vi", "tr", "it",
];

// Native language names for the picker. A reader who cannot read the current
// UI must still recognize their own language.
export const languageNames = {
  en: "English",
  "zh-Hans": "简体中文",
  "zh-Hant": "繁體中文",
  es: "Español",
  fr: "Français",
  ar: "العربية",
  pt: "Português",
  ru: "Русский",
  id: "Bahasa Indonesia",
  de: "Deutsch",
  ja: "日本語",
  vi: "Tiếng Việt",
  tr: "Türkçe",
  it: "Italiano",
};

export const rtlLanguages = new Set(["ar", "fa", "he", "ur"]);

export function isRTL(language) {
  return rtlLanguages.has(String(language || "").split("-")[0]);
}

// utility function to get available languages
export function getAvailableLanguages() {
  return supportedLanguages;
}

// initialize i18next with backend, language detection, and react integration
// this sets up translation loading, language detection, and react hooks
i18n
  // use http backend to load translation files from /locales
  .use(HttpBackend)
  // use browser language detector to auto-select language
  .use(LanguageDetector)
  // integrate with react
  .use(initReactI18next)
  .init({
    // fallback language if user's language is not available
    fallbackLng: "en",
    // list of supported languages
    supportedLngs: supportedLanguages,
    // backend config: where to load translation files from
    backend: {
      loadPath: `${import.meta.env.BASE_URL}locales/{{lng}}.json`,
    },
    // interpolation config: don't escape values (react does it)
    interpolation: {
      escapeValue: false, // react already escapes
    },
    // react-specific config
    react: {
      useSuspense: false,
    },
  });

function applyDocumentLanguage(language) {
  if (typeof document === "undefined") return;
  const tag = String(language || "en");
  document.documentElement.lang = tag;
  document.documentElement.dir = isRTL(tag) ? "rtl" : "ltr";
}

i18n.on("languageChanged", applyDocumentLanguage);
applyDocumentLanguage(i18n.language);

// export the configured i18n instance
export default i18n;
