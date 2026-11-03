// external
import { useTranslation } from 'react-i18next';

// helpers
import { getAvailableLanguages, languageNames } from '../helpers/i18n';

// main component for switching the ui language
export const LanguageSwitcher = () => {
    const { i18n } = useTranslation();
    // get the list of available languages
    // Match the full tag first so zh-Hans/zh-Hant are not collapsed to zh.
    const available = getAvailableLanguages();
    const currentLanguage = available.includes(i18n.language)
        ? i18n.language
        : available.find((tag) => i18n.language?.startsWith(tag + '-'))
          || String(i18n.language || 'en').split('-')[0];

    // handle language change when user selects a new language
    const handleChangeLanguage = (event) => {
        i18n.changeLanguage(event.target.value);
    };

    return (
        <div className="language-switcher">
            {/* dropdown for selecting the ui language */}
            <select
                id="tollgate-i18n"
                aria-label="Language"
                value={currentLanguage}
                onChange={handleChangeLanguage}
                className="ghost cta small"
            >
                {/* render an option for each available language */}
                {available.map((language) => (
                    <option key={language} value={language}>
                        {languageNames[language] || language}
                    </option>
                ))}
            </select>
        </div>
    );
};

export default LanguageSwitcher; 