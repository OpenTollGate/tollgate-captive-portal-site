// Tests for src/helpers/i18n.js — the portal's i18next bootstrap (0% on the
// baseline).
//
// The module is mostly its own INITIALISATION: the plugin chain, the config it
// hands i18next, and the document-language hook. i18next itself is doubled so
// the assertions are about what this module ASKS FOR, not about i18next's
// internals — plus the three pure exports (supported list, names, RTL).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── i18next double ────────────────────────────────────────────────────
const i18nState = {
  language: 'en',
  initOptions: null,
  plugins: [],
  handlers: {},
  emit: null,
};

const fakeI18n = {
  get language() {
    return i18nState.language;
  },
  use(plugin) {
    i18nState.plugins.push(plugin);
    return this;
  },
  init(options) {
    i18nState.initOptions = options;
    i18nState.emit = (event, value) => {
      i18nState.language = value;
      const handler = i18nState.handlers[event];
      if (handler) handler(value);
    };
    return Promise.resolve();
  },
  on(event, handler) {
    i18nState.handlers[event] = handler;
    return this;
  },
};

vi.mock('i18next', () => ({ default: fakeI18n }));
vi.mock('i18next-http-backend', () => ({ default: { name: 'http-backend' } }));
vi.mock(
  'i18next-browser-languagedetector',
  () => ({ default: { name: 'language-detector' } })
);
vi.mock('react-i18next', () => ({ initReactI18next: { name: 'init-react-i18next' } }));

const portalI18n = await import('../../src/helpers/i18n.js');

// The module registers its plugin chain and its `languageChanged` handler at
// IMPORT time, so the recorded state is captured here — once — and the tests
// read that snapshot rather than a reset one.
const BOOTSTRAP = {
  plugins: [...i18nState.plugins],
  initOptions: i18nState.initOptions,
  handler: i18nState.handlers.languageChanged,
};

// Drive the document-language hook the module registered.
const emitLanguageChanged = (language) => BOOTSTRAP.handler(language);

beforeEach(() => {
  document.documentElement.lang = '';
  document.documentElement.dir = '';
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('bootstrap', () => {
  it('returns the configured instance as the default export', () => {
    expect(portalI18n.default).toBe(fakeI18n);
  });

  it('installs the http backend, the browser detector and the react bridge, in order', () => {
    expect(BOOTSTRAP.plugins.map((p) => p.name)).toEqual([
      'http-backend',
      'language-detector',
      'init-react-i18next',
    ]);
  });

  it('initialises with English fallback, the supported list and unescaped interpolation', () => {
    const options = BOOTSTRAP.initOptions;
    expect(options.fallbackLng).toBe('en');
    expect(options.supportedLngs).toEqual(portalI18n.supportedLanguages);
    expect(options.interpolation.escapeValue).toBe(false);
    expect(options.react.useSuspense).toBe(false);
    // The catalogue path is derived from the build base, not hardcoded.
    expect(options.backend.loadPath).toBe('/locales/{{lng}}.json');
  });

  it('registers a languageChanged handler', () => {
    expect(typeof BOOTSTRAP.handler).toBe('function');
  });
});

describe('supportedLanguages / languageNames', () => {
  it('lists the 14 supported languages', () => {
    expect(portalI18n.supportedLanguages).toEqual([
      'en', 'zh-Hans', 'zh-Hant', 'es', 'fr', 'ar', 'pt',
      'ru', 'id', 'de', 'ja', 'vi', 'tr', 'it',
    ]);
  });

  it('names every supported language natively', () => {
    for (const tag of portalI18n.supportedLanguages) {
      expect(portalI18n.languageNames[tag], tag).toBeTruthy();
    }
    expect(portalI18n.languageNames['zh-Hant']).toBe('繁體中文');
    expect(portalI18n.languageNames.ar).toBe('العربية');
  });

  it('getAvailableLanguages() answers the same list', () => {
    expect(portalI18n.getAvailableLanguages()).toBe(portalI18n.supportedLanguages);
  });
});

describe('isRTL', () => {
  it('is true for the RTL scripts and false otherwise', () => {
    expect(portalI18n.isRTL('ar')).toBe(true);
    expect(portalI18n.isRTL('fa')).toBe(true);
    expect(portalI18n.isRTL('he')).toBe(true);
    expect(portalI18n.isRTL('ur-PK')).toBe(true);
    expect(portalI18n.isRTL('en')).toBe(false);
    expect(portalI18n.isRTL('zh-Hant')).toBe(false);
    expect(portalI18n.isRTL(null)).toBe(false);
    expect(portalI18n.isRTL(undefined)).toBe(false);
  });
});

describe('document language hook', () => {
  it('sets lang and dir when the language changes to an RTL locale', () => {
    emitLanguageChanged('ar');
    expect(document.documentElement.lang).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');
  });

  it('switches dir back to ltr for a left-to-right locale', () => {
    emitLanguageChanged('ar');
    emitLanguageChanged('zh-Hans');
    expect(document.documentElement.lang).toBe('zh-Hans');
    expect(document.documentElement.dir).toBe('ltr');
  });

  it('falls back to the tag itself when the language is empty', () => {
    emitLanguageChanged('');
    expect(document.documentElement.lang).toBe('en');
    expect(document.documentElement.dir).toBe('ltr');
  });
});
