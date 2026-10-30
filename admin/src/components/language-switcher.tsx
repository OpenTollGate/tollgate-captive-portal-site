import { useEffect, useState } from 'preact/hooks';
import {
  LANGUAGE_NAMES,
  SUPPORTED_LANGUAGES,
  getLanguage,
  onLanguageChange,
  setLanguage,
} from '../lib/i18n';

export default function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const [language, setCurrent] = useState(getLanguage());

  useEffect(() => onLanguageChange(setCurrent), []);

  return (
    <label class={`lang-switcher${compact ? ' lang-switcher-compact' : ''}`}>
      <span class="sr-only">Language</span>
      <select
        aria-label="Language"
        value={language}
        onChange={(e) => setLanguage((e.target as HTMLSelectElement).value)}
      >
        {SUPPORTED_LANGUAGES.map((tag) => (
          <option key={tag} value={tag}>
            {LANGUAGE_NAMES[tag] || tag}
          </option>
        ))}
      </select>
    </label>
  );
}
