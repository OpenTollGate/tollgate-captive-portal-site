// Characterization tests for the admin board's translation layer
// (admin/src/lib/i18n.ts).
//
// The module is a DOM bridge plus a pure normalizer. Both halves are pinned
// here: the normalizer because it decides which catalogue is used for a
// browser's language tag, and the DOM bridge because "translate in place,
// losslessly, without re-translating what was already painted" is the only
// thing keeping a language switch from eating the page's own text.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'tollgate_admin_lang';

// The module reads localStorage at import time, so each test file gets one
// import and the helpers below reset state through the public API.
const i18n = await import('../../admin/src/lib/i18n.ts');

const {
  SUPPORTED_LANGUAGES,
  LANGUAGE_NAMES,
  normalizeLanguage,
  getLanguage,
  setLanguage,
  isRTL,
  t,
  onLanguageChange,
  applyTranslations,
  startTranslationObserver,
} = i18n;

afterEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  document.documentElement.lang = '';
  document.documentElement.dir = '';
  setLanguage('en');
  vi.restoreAllMocks();
});

describe('locale tables', () => {
  it('lists exactly the 14 shipped locales', () => {
    expect([...SUPPORTED_LANGUAGES]).toEqual([
      'en', 'zh-Hans', 'zh-Hant', 'es', 'fr', 'ar', 'pt',
      'ru', 'id', 'de', 'ja', 'vi', 'tr', 'it',
    ]);
  });

  it('names every supported language in its own script', () => {
    for (const tag of SUPPORTED_LANGUAGES) {
      expect(LANGUAGE_NAMES[tag], tag).toBeTruthy();
    }
    expect(LANGUAGE_NAMES['zh-Hans']).toBe('简体中文');
  });
});

describe('normalizeLanguage', () => {
  it('accepts an exact supported tag in any case', () => {
    expect(normalizeLanguage('de')).toBe('de');
    expect(normalizeLanguage('ZH-hans')).toBe('zh-Hans');
    expect(normalizeLanguage('FR')).toBe('fr');
  });

  it('falls back to English for an empty or missing tag', () => {
    expect(normalizeLanguage('')).toBe('en');
    expect(normalizeLanguage(null)).toBe('en');
    expect(normalizeLanguage(undefined)).toBe('en');
    expect(normalizeLanguage('   ')).toBe('en');
  });

  it('maps Simplified/Traditional Chinese variants onto the two zh catalogues', () => {
    expect(normalizeLanguage('zh-CN')).toBe('zh-Hans');
    expect(normalizeLanguage('zh-SG')).toBe('zh-Hans');
    expect(normalizeLanguage('zh-TW')).toBe('zh-Hant');
    expect(normalizeLanguage('zh-HK')).toBe('zh-Hant');
  });

  it('reduces a regional tag to its supported base language', () => {
    expect(normalizeLanguage('pt-BR')).toBe('pt');
    expect(normalizeLanguage('es-419')).toBe('es');
    expect(normalizeLanguage('it-CH')).toBe('it');
  });

  it('returns English for a language the board does not ship', () => {
    expect(normalizeLanguage('ko')).toBe('en');
    expect(normalizeLanguage('xx-YY')).toBe('en');
  });
});

describe('setLanguage / getLanguage / t', () => {
  beforeEach(() => {
    // Silence the mutation observer the module may still hold from an earlier
    // test's startTranslationObserver(), so a stale observer cannot translate
    // fixtures this test owns.
    document.body.innerHTML = '';
  });

  it('translates a known English source through the active catalogue', () => {
    setLanguage('en');
    expect(getLanguage()).toBe('en');
    // The English catalogue maps every source onto itself.
    expect(t('Config')).toBe('Config');
  });

  it('switches to a catalogue and returns its translation', () => {
    setLanguage('de');
    expect(getLanguage()).toBe('de');
    // 'Config' is 'Konfiguration' in the German catalogue (admin/src/locales/de.json)
    expect(t('Config')).toBe('Konfiguration');
  });

  it('returns the source string unchanged when the catalogue lacks it', () => {
    setLanguage('de');
    expect(t('a string no catalogue carries')).toBe('a string no catalogue carries');
  });

  it('normalizes what it stores and persists it', () => {
    setLanguage('zh-CN');
    expect(getLanguage()).toBe('zh-Hans');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('zh-Hans');
  });

  it('sets the document language and direction on switch', () => {
    setLanguage('ar');
    expect(document.documentElement.lang).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');
    setLanguage('de');
    expect(document.documentElement.dir).toBe('ltr');
  });

  it('survives a localStorage that throws on write', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => setLanguage('fr')).not.toThrow();
    expect(getLanguage()).toBe('fr');
  });
});

describe('isRTL', () => {
  it('is true for the right-to-left languages only', () => {
    expect(isRTL('ar')).toBe(true);
    expect(isRTL('fa')).toBe(true);
    expect(isRTL('ar-EG')).toBe(true);
    expect(isRTL('de')).toBe(false);
    expect(isRTL('zh-Hant')).toBe(false);
    expect(isRTL('')).toBe(false);
  });
});

describe('onLanguageChange', () => {
  it('notifies subscribers and can be unsubscribed', () => {
    const seen = [];
    const off = onLanguageChange((lang) => seen.push(lang));
    setLanguage('es');
    expect(seen).toEqual(['es']);

    off();
    setLanguage('it');
    expect(seen).toEqual(['es']);
  });
});

describe('applyTranslations DOM bridge', () => {
  it('translates text nodes in place, preserving surrounding whitespace', () => {
    setLanguage('de');
    document.body.innerHTML = '<p>  Config  </p>';
    applyTranslations(document.body);
    const p = document.querySelector('p');
    expect(p.textContent).toBe('  Konfiguration  ');
  });

  it('restores the English source when switching back', () => {
    setLanguage('de');
    document.body.innerHTML = '<p>Config</p>';
    applyTranslations(document.body);
    expect(document.querySelector('p').textContent).toBe('Konfiguration');

    setLanguage('en');
    expect(document.querySelector('p').textContent).toBe('Config');
  });

  it('translates the user-facing attributes it owns', () => {
    setLanguage('de');
    document.body.innerHTML = '<input placeholder="Config" title="Config" aria-label="Config">';
    applyTranslations(document.body);
    const input = document.querySelector('input');
    expect(input.getAttribute('placeholder')).toBe('Konfiguration');
    expect(input.getAttribute('title')).toBe('Konfiguration');
    expect(input.getAttribute('aria-label')).toBe('Konfiguration');
  });

  it('never rewrites code, pre, script, style or textarea content', () => {
    setLanguage('de');
    document.body.innerHTML =
      '<code>Config</code><pre>Config</pre><textarea>Config</textarea>' +
      '<script type="text/plain">Config</script><style>/* Config */</style>';
    applyTranslations(document.body);
    expect(document.querySelector('code').textContent).toBe('Config');
    expect(document.querySelector('pre').textContent).toBe('Config');
    expect(document.querySelector('textarea').textContent).toBe('Config');
    expect(document.querySelector('script').textContent).toBe('Config');
  });

  it('leaves an unknown string alone and collapses whitespace when matching', () => {
    setLanguage('de');
    document.body.innerHTML = '<p>not a catalogued string</p>';
    applyTranslations(document.body);
    expect(document.querySelector('p').textContent).toBe('not a catalogued string');
  });

  it('picks up a text change made after the first paint', () => {
    setLanguage('de');
    document.body.innerHTML = '<p>Config</p>';
    applyTranslations(document.body);
    const p = document.querySelector('p');
    expect(p.textContent).toBe('Konfiguration');

    // The app re-rendered the node with a new English source; the bridge must
    // treat that as the new source rather than as a translation to keep.
    p.firstChild.nodeValue = 'Balance';
    applyTranslations(document.body);
    expect(p.textContent).toBe('Gleichgewicht');
  });

  it('does not translate the same node twice into nonsense', () => {
    setLanguage('de');
    document.body.innerHTML = '<p>Config</p>';
    applyTranslations(document.body);
    applyTranslations(document.body);
    applyTranslations(document.body);
    expect(document.querySelector('p').textContent).toBe('Konfiguration');
  });

  it('translates an attribute element that is the root of the walk', () => {
    setLanguage('de');
    const input = document.createElement('input');
    input.setAttribute('placeholder', 'Config');
    applyTranslations(input);
    expect(input.getAttribute('placeholder')).toBe('Konfiguration');
  });
});

describe('startTranslationObserver', () => {
  it('translates nodes added after it starts, and stops on unsubscribe', async () => {
    setLanguage('de');
    const stop = startTranslationObserver();

    const p = document.createElement('p');
    p.textContent = 'Config';
    document.body.appendChild(p);
    await Promise.resolve();
    await Promise.resolve();
    expect(p.textContent).toBe('Konfiguration');

    // A second start while one is live is a no-op returning its own stopper.
    const stopAgain = startTranslationObserver();
    expect(() => stopAgain()).not.toThrow();

    stop();
    const q = document.createElement('p');
    q.textContent = 'Config';
    document.body.appendChild(q);
    await Promise.resolve();
    await Promise.resolve();
    expect(q.textContent).toBe('Config');
  });
});
