// import i18next core and react integration
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import HttpBackend from 'i18next-http-backend';
import LanguageDetector from 'i18next-browser-languagedetector';

// list of supported languages for the app
export const supportedLanguages = ['en']; // add more as needed

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
    fallbackLng: 'en',
    // list of supported languages
    supportedLngs: supportedLanguages,
    // backend config: where to load translation files from
    backend: {
      loadPath: '/locales/{{lng}}.json',
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

// export the configured i18n instance
export default i18n; 