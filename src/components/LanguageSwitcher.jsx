import { useTranslation } from 'react-i18next';
import { getAvailableLanguages } from '../helpers/i18n';

export const LanguageSwitcher = () => {
    const { i18n } = useTranslation();
    const availableLanguages = getAvailableLanguages();
    const currentLanguage = i18n.language.split('-')[0];

    const handleChangeLanguage = (event) => {
        i18n.changeLanguage(event.target.value);
    };

    return (
        <div className="language-switcher">
            <select
                id="tollgate-i18n"
                value={currentLanguage}
                onChange={handleChangeLanguage}
                className="ghost cta small"
            >
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