// Admin-board translation layer.
//
// The admin SPA predates i18n and its strings are written inline. This module
// keeps the existing code readable while giving the board a complete language
// picker: it translates text nodes and the few user-facing attributes against
// catalogues keyed by the English source string. New code should still use
// t("English source") explicitly; the DOM pass is the compatibility bridge for
// the strings that have not been moved yet.

type LocaleMap = Record<string, string>;

const modules = import.meta.glob('../locales/*.json', { eager: true }) as Record<
  string,
  { default: LocaleMap } | LocaleMap
>;

export const SUPPORTED_LANGUAGES = [
  'en', 'zh-Hans', 'zh-Hant', 'es', 'fr', 'ar', 'pt',
  'ru', 'id', 'de', 'ja', 'vi', 'tr', 'it',
] as const;

export type Language = (typeof SUPPORTED_LANGUAGES)[number];

export const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  'zh-Hans': '简体中文',
  'zh-Hant': '繁體中文',
  es: 'Español',
  fr: 'Français',
  ar: 'العربية',
  pt: 'Português',
  ru: 'Русский',
  id: 'Bahasa Indonesia',
  de: 'Deutsch',
  ja: '日本語',
  vi: 'Tiếng Việt',
  tr: 'Türkçe',
  it: 'Italiano',
};

const RTL = new Set(['ar', 'fa', 'he', 'ur']);
const STORAGE_KEY = 'tollgate_admin_lang';

const catalogues: Record<string, LocaleMap> = {};
for (const [path, mod] of Object.entries(modules)) {
  const tag = path.split('/').pop()!.replace(/\.json$/i, '');
  catalogues[tag] = (mod as { default?: LocaleMap }).default ?? (mod as LocaleMap);
}

export function normalizeLanguage(input: string | null | undefined): string {
  const raw = String(input || '').trim();
  if (!raw) return 'en';
  const exact = SUPPORTED_LANGUAGES.find((l) => l.toLowerCase() === raw.toLowerCase());
  if (exact) return exact;
  const lower = raw.toLowerCase();
  if (lower.startsWith('zh-cn') || lower.startsWith('zh-sg') || lower.startsWith('zh-hans')) return 'zh-Hans';
  if (lower.startsWith('zh-tw') || lower.startsWith('zh-hk') || lower.startsWith('zh-hant')) return 'zh-Hant';
  const base = lower.split('-')[0];
  return SUPPORTED_LANGUAGES.find((l) => l === base) || 'en';
}

function detectLanguage(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return normalizeLanguage(saved);
  } catch {
    // localStorage can be disabled; browser detection still works.
  }
  const candidates = typeof navigator !== 'undefined'
    ? [...(navigator.languages || []), navigator.language]
    : [];
  for (const candidate of candidates) {
    const normalized = normalizeLanguage(candidate);
    if (normalized !== 'en' || String(candidate || '').toLowerCase().startsWith('en')) {
      return normalized;
    }
  }
  return 'en';
}

let currentLanguage = detectLanguage();
const listeners = new Set<(language: string) => void>();

export function getLanguage(): string {
  return currentLanguage;
}

export function isRTL(language = currentLanguage): boolean {
  return RTL.has(String(language || '').split('-')[0]);
}

export function t(source: string): string {
  return catalogues[currentLanguage]?.[source] ?? source;
}

export function setLanguage(language: string): void {
  const next = normalizeLanguage(language);
  currentLanguage = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Best effort persistence only.
  }
  applyDocumentLanguage();
  if (typeof document !== 'undefined') applyTranslations(document.body);
  listeners.forEach((fn) => fn(next));
}

export function onLanguageChange(fn: (language: string) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function applyDocumentLanguage(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = currentLanguage;
  document.documentElement.dir = isRTL() ? 'rtl' : 'ltr';
}

// ─── DOM translation bridge ──────────────────────────────────────────
//
// WeakMaps keep the original English text, so switching back to English (or to
// another locale) is lossless even after a string has been painted. A dynamic
// update is detected by comparing the node's current value with the value we
// last painted; that becomes the new source string.
const textSources = new WeakMap<Text, string>();
const textPainted = new WeakMap<Text, string>();
const attrSources = new WeakMap<Element, Map<string, string>>();
const attrPainted = new WeakMap<Element, Map<string, string>>();

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'CODE', 'PRE', 'TEXTAREA']);
const ATTRS = ['placeholder', 'title', 'aria-label'];

function translateValue(value: string, map: LocaleMap): string {
  const trimmed = value.trim();
  if (!trimmed) return value;
  const translated = map[trimmed] ?? map[trimmed.replace(/\s+/g, ' ')];
  if (!translated) return value;
  const leading = value.match(/^\s*/)?.[0] ?? '';
  const trailing = value.match(/\s*$/)?.[0] ?? '';
  return leading + translated + trailing;
}

function translateTextNode(node: Text, map: LocaleMap): void {
  const parent = node.parentElement;
  if (!parent || SKIP_TAGS.has(parent.tagName)) return;
  const value = node.nodeValue ?? '';
  const painted = textPainted.get(node);
  if (textSources.get(node) === undefined || (painted !== undefined && value !== painted)) {
    textSources.set(node, value);
  }
  const source = textSources.get(node) ?? value;
  const next = translateValue(source, map);
  if (value === next) {
    textPainted.set(node, next);
    return;
  }
  node.nodeValue = next;
  textPainted.set(node, next);
}

function translateAttributes(el: Element, map: LocaleMap): void {
  let sources = attrSources.get(el);
  let painted = attrPainted.get(el);
  if (!sources) {
    sources = new Map();
    attrSources.set(el, sources);
  }
  if (!painted) {
    painted = new Map();
    attrPainted.set(el, painted);
  }
  for (const attr of ATTRS) {
    const value = el.getAttribute(attr);
    if (value == null) continue;
    if (sources.get(attr) === undefined || value !== painted.get(attr)) {
      sources.set(attr, value);
    }
    const source = sources.get(attr) ?? value;
    const next = translateValue(source, map);
    if (value !== next) el.setAttribute(attr, next);
    painted.set(attr, next);
  }
}

export function applyTranslations(root: ParentNode = document.body): void {
  const map = catalogues[currentLanguage] ?? {};
  applyDocumentLanguage();
  if (root instanceof Element) translateAttributes(root, map);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    translateTextNode(node as Text, map);
    node = walker.nextNode();
  }
  const elements = (root as ParentNode).querySelectorAll?.('*') ?? [];
  elements.forEach((el) => translateAttributes(el, map));
}

let observer: MutationObserver | null = null;

export function startTranslationObserver(): () => void {
  if (typeof document === 'undefined') return () => {};
  applyTranslations(document.body);
  if (observer) return () => {};
  observer = new MutationObserver((mutations) => {
    const map = catalogues[currentLanguage] ?? {};
    for (const mutation of mutations) {
      if (mutation.type === 'characterData' && mutation.target instanceof Text) {
        translateTextNode(mutation.target, map);
      } else if (mutation.type === 'attributes' && mutation.target instanceof Element) {
        translateAttributes(mutation.target, map);
      } else if (mutation.type === 'childList') {
        mutation.addedNodes.forEach((added) => {
          if (added instanceof Text) {
            translateTextNode(added, map);
          } else if (added instanceof Element) {
            translateAttributes(added, map);
            applyTranslations(added);
          }
        });
      }
    }
  });
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ATTRS,
  });
  return () => {
    observer?.disconnect();
    observer = null;
  };
}

applyDocumentLanguage();
