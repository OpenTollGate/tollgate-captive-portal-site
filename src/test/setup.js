import '@testing-library/jest-dom';

vi.mock('react-i18next', () => {
  const i18n = { language: 'en' };
  const t = (key, opts) => {
    if (typeof opts === 'object' && opts !== null) {
      return key + JSON.stringify(opts);
    }
    return key;
  };
  return {
    useTranslation: () => ({ t, i18n, ready: true }),
    Trans: ({ children }) => children,
  };
});
