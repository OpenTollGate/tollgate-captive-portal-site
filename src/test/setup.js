import '@testing-library/jest-dom';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, opts) => {
      if (typeof opts === 'object' && opts !== null) {
        return key + JSON.stringify(opts);
      }
      return key;
    },
    i18n: { language: 'en' },
    ready: true,
  }),
  Trans: ({ children }) => children,
}));
