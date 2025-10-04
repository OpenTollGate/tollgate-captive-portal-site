// external
import { useTranslation } from 'react-i18next';

// helpers
import { getAvailableLanguages } from '../helpers/i18n';

// main component for switching the ui language
export const LanguageSwitcher = () => {
    const { i18n } = useTranslation();
    // get the list of available languages
    const availableLanguages = getAvailableLanguages();
    // get the current language code (e.g. 'en', 'de')
    const currentLanguage = i18n.language.split('-')[0];

    // handle language change when user selects a new language
    const handleChangeLanguage = (event) => {
        i18n.changeLanguage(event.target.value);
    };

    return (
        <div className="language-switcher">
            {/* dropdown for selecting the ui language */}
            <select
                id="tollgate-i18n"
                value={currentLanguage}
                onChange={handleChangeLanguage}
                className="ghost cta small"
            >
                {/* render an option for each available language */}
                {availableLanguages.map((language) => (
                    <option key={language} value={language}>
                        {language}
                    </option>
                ))}
            </select>
        </div>
    );
};

export default LanguageSwitcher; 