import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyTextToClipboard } from '../../src/helpers/clipboard.js';

const invoice = 'lnbc1210n1testinvoice';
const i18n = (key) => key;
let button;

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<input value="customer text"><button>Copy</button>';
  button = document.querySelector('button');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.runAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

const clipboard = (value) => vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue(value);

// jsdom has no native clipboard property or legacy copy operation.
beforeEach(() => {
  vi.stubGlobal('navigator', Object.create(navigator, {
    clipboard: { configurable: true, get: () => undefined },
  }));
});

function legacyCopy(result = true) {
  const copy = vi.fn(() => {
    const field = document.querySelector('textarea');
    expect(field.value).toBe(invoice);
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(invoice.length);
    return result;
  });
  vi.stubGlobal('document', document);
  Object.defineProperty(document, 'execCommand', { configurable: true, value: copy });
  return copy;
}

describe('invoice copy from an HTTP captive portal', () => {
  it('copies without the Clipboard API and restores focus and selection', async () => {
    const input = document.querySelector('input');
    input.focus();
    input.setSelectionRange(2, 6);
    const copy = legacyCopy();
    await copyTextToClipboard({ currentTarget: button }, invoice, i18n);
    expect(copy).toHaveBeenCalledWith('copy');
    expect(button.textContent).toBe('clipboard_success');
    expect(document.querySelector('textarea')).toBeNull();
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([2, 6]);
    vi.runAllTimers();
    expect(button.textContent).toBe('Copy');
  });

  it('falls back when the modern API rejects access', async () => {
    clipboard({ writeText: vi.fn().mockRejectedValue(new Error('denied')) });
    const copy = legacyCopy();
    await copyTextToClipboard({ currentTarget: button }, invoice, i18n);
    expect(copy).toHaveBeenCalledOnce();
    expect(button.classList.contains('clipboard-success')).toBe(true);
  });

  it('shows failure when copying is denied and removes the temporary field', async () => {
    legacyCopy(false);
    await copyTextToClipboard({ currentTarget: button }, invoice, i18n);
    expect(button.textContent).toBe('clipboard_error');
    expect(button.classList.contains('clipboard-success')).toBe(false);
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('uses modern copying when available and retains the button across an await', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    clipboard({ writeText });
    const copy = legacyCopy();
    const icon = document.createElement('span');
    button.appendChild(icon);
    const event = { currentTarget: button, target: icon };
    const result = copyTextToClipboard(event, invoice, i18n);
    event.currentTarget = null;
    await result;
    expect(writeText).toHaveBeenCalledWith(invoice);
    expect(copy).not.toHaveBeenCalled();
    expect(button.textContent).toBe('clipboard_success');
  });
});
