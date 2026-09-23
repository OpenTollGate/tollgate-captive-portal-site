import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';

// LanguageSwitcher pulls in src/helpers/i18n.js, which calls the real
// react-i18next `initReactI18next` — unavailable under the global i18n mock in
// src/test/setup.js. Same stub the sibling Cashu.race.test.jsx uses.
vi.mock('../../src/components/LanguageSwitcher.jsx', () => ({
  default: () => null,
  LanguageSwitcher: () => null,
}));

const { AccessGranted } = await import('../../src/App.jsx');

/**
 * Regression: the "access purchased" duration block must render the label and
 * the value with a separator between them.
 *
 * The markup is two sibling <span>s inside
 * `.tollgate-captive-portal-access-granted-duration`:
 *
 *   <span class="...-duration-label">{t('access_duration_label')}</span>
 *   <span class="...-duration-value">{allocation}</span>
 *
 * JSX discards the whitespace/newline BETWEEN the two elements, and none of the
 * three `tollgate-captive-portal-access-granted-duration*` class names has a
 * stylesheet rule anywhere in the repo, so the two spans butt up against each
 * other and the user reads `Access purchased21.00 MiB`.
 *
 * NOTE: the global i18n mock in src/test/setup.js returns the translation key,
 * so in this environment the label span renders the literal string
 * `access_duration_label` instead of `Access purchased`. The assertion below is
 * therefore written against the DOM (label span text + value span text) so it
 * holds no matter what the translation mock returns.
 */
const DURATION_BLOCK_SELECTOR = '.tollgate-captive-portal-access-granted-duration';
const DURATION_LABEL_SELECTOR = '.tollgate-captive-portal-access-granted-duration-label';
const DURATION_VALUE_SELECTOR = '.tollgate-captive-portal-access-granted-duration-value';

describe('AccessGranted — purchased duration spacing', () => {
  it('separates the duration label from the value with a single space', () => {
    const { container } = render(<AccessGranted allocation="21.00 MiB" metric="bytes" />);

    const block = container.querySelector(DURATION_BLOCK_SELECTOR);
    expect(block, `missing ${DURATION_BLOCK_SELECTOR}`).not.toBeNull();

    const label = block.querySelector(DURATION_LABEL_SELECTOR);
    const value = block.querySelector(DURATION_VALUE_SELECTOR);
    expect(label, `missing ${DURATION_LABEL_SELECTOR}`).not.toBeNull();
    expect(value, `missing ${DURATION_VALUE_SELECTOR}`).not.toBeNull();

    // the block reads "<label> <value>" with a single separator space
    expect(block.textContent).toBe(`${label.textContent} ${value.textContent}`);
    // and the glued-together form the bug report described is gone
    expect(block.textContent).not.toBe(`${label.textContent}${value.textContent}`);
  });
});
