import { createContext, useContext, useEffect, useMemo } from 'react';
import defaultTheme from './defaultTheme';
import userTheme from '../../theme.config';

const ThemeContext = createContext(defaultTheme);

export const useTheme = () => useContext(ThemeContext);

function hexToRgb(hex) {
  if (!hex) return null;
  let match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!match) {
    match = /^#?([a-f\d])([a-f\d])([a-f\d])$/i.exec(hex);
    if (match) {
      match = [match[0], match[1] + match[1], match[2] + match[2], match[3] + match[3]];
    }
  }
  if (!match) return null;
  return `${parseInt(match[1], 16)}, ${parseInt(match[2], 16)}, ${parseInt(match[3], 16)}`;
}

function deepMerge(defaults, overrides) {
  const result = { ...defaults };
  for (const key of Object.keys(overrides)) {
    if (
      overrides[key] !== null &&
      typeof overrides[key] === 'object' &&
      !Array.isArray(overrides[key]) &&
      defaults[key] &&
      typeof defaults[key] === 'object' &&
      !Array.isArray(defaults[key])
    ) {
      result[key] = { ...defaults[key], ...overrides[key] };
    } else {
      result[key] = overrides[key];
    }
  }
  return result;
}

export function ThemeProvider({ children }) {
  const theme = useMemo(() => deepMerge(defaultTheme, userTheme), []);

  useEffect(() => {
    const root = document.documentElement;
    const { colors } = theme;

    root.style.setProperty('--color-cta', colors.cta);
    root.style.setProperty('--color-cta-transparent', colors.ctaTransparent);
    root.style.setProperty('--color-black', colors.black);
    root.style.setProperty('--color', colors.foreground);
    root.style.setProperty('--color-brand-bg', colors.background);

    const ctaRgb = hexToRgb(colors.cta);
    if (ctaRgb) {
      root.style.setProperty('--color-cta-hover', `rgba(${ctaRgb}, .25)`);
      root.style.setProperty('--color-cta-hover-border', `rgba(${ctaRgb}, .5)`);
    }

    root.style.setProperty('--color-brand-bg', colors.background);
  }, [theme]);

  return (
    <ThemeContext.Provider value={theme}>
      {children}
    </ThemeContext.Provider>
  );
}
