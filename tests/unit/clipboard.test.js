// Tests for src/helpers/clipboard.js — 19.76% on the baseline.
//
// Both exports are thin wrappers over the Clipboard API, which captive portals
// frequently do NOT expose (plain HTTP is not a secure context), so the
// feature-detection branch is the one that decides whether a user ever sees a
// broken paste button. The copy helper's job is UI state on the event target,
// so the assertions are on textContent/classList and on the 1 s restore timer.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { hasClipboardSupport, requestPaste, copyTextToClipboard } = await import(
  '../../src/helpers/clipboard.js'
);

const i18n = (key) => `t:${key}`;

const setClipboard = (clipboard) => {
  Object.defineProperty(navigator, 'clipboard', {
    value: clipboard,
    configurable: true,
    writable: true,
  });
};

const makeButton = (text = 'Paste') => {
  const button = document.createElement('button');
  button.textContent = text;
  return button;
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  setClipboard(undefined);
});

describe('hasClipboardSupport', () => {
  it('is true only when readText is a callable on navigator.clipboard', () => {
    setClipboard({ readText: () => Promise.resolve('x') });
    expect(hasClipboardSupport()).toBe(true);
  });

  it('is false when navigator.clipboard is absent (the plain-HTTP portal case)', () => {
    setClipboard(undefined);
    expect(hasClipboardSupport()).toBe(false);
  });

  it('is false when clipboard exists but has no readText', () => {
    setClipboard({ writeText: () => Promise.resolve() });
    expect(hasClipboardSupport()).toBe(false);
  });

  it('is false when readText is present but not a function', () => {
    setClipboard({ readText: 'soon' });
    expect(hasClipboardSupport()).toBe(false);
  });
});

describe('requestPaste', () => {
  it('returns the clipboard text on success', async () => {
    setClipboard({ readText: async () => 'cashuAeyJ0b2tlbg' });
    await expect(requestPaste(i18n)).resolves.toEqual({
      status: 1,
      value: 'cashuAeyJ0b2tlbg',
    });
  });

  it('returns an empty string rather than undefined for an empty clipboard', async () => {
    setClipboard({ readText: async () => '' });
    await expect(requestPaste(i18n)).resolves.toEqual({ status: 1, value: '' });
  });

  it('reports CB002 when the clipboard does not yield a string', async () => {
    setClipboard({ readText: async () => null });
    await expect(requestPaste(i18n)).resolves.toEqual({
      status: 0,
      code: 'CB002',
      label: 't:CB002_label',
      message: 't:CB002_message',
    });
  });

  it('reports CB001 when the user denies clipboard access', async () => {
    const denied = Object.assign(new Error('denied'), { name: 'NotAllowedError' });
    setClipboard({ readText: async () => Promise.reject(denied) });

    await expect(requestPaste(i18n)).resolves.toEqual({
      status: 0,
      code: 'CB001',
      label: 't:CB001_label',
      message: 't:CB001_message',
    });
  });

  it('reports CB002 for any other clipboard failure', async () => {
    setClipboard({ readText: async () => Promise.reject(new Error('boom')) });

    await expect(requestPaste(i18n)).resolves.toEqual({
      status: 0,
      code: 'CB002',
      label: 't:CB002_label',
      message: 't:CB002_message',
    });
  });

  it('treats a non-Error rejection as a generic failure', async () => {
    setClipboard({ readText: async () => Promise.reject('nope') });

    await expect(requestPaste(i18n)).resolves.toMatchObject({ code: 'CB002' });
  });
});

describe('copyTextToClipboard', () => {
  it('writes the text and shows the success state', async () => {
    const writeText = vi.fn(async () => {});
    setClipboard({ writeText });
    const button = makeButton('Copy');

    await copyTextToClipboard({ target: button }, 'cashuAxyz', i18n);

    expect(writeText).toHaveBeenCalledWith('cashuAxyz');
    expect(button.textContent).toBe('t:clipboard_success');
    expect(button.classList.contains('clipboard-success')).toBe(true);
    expect(button.classList.contains('clipboard-copying')).toBe(false);
  });

  it('restores the original label after the 1 s feedback window', async () => {
    vi.useFakeTimers();
    setClipboard({ writeText: async () => {} });
    const button = makeButton('Copy');

    await copyTextToClipboard({ target: button }, 'x', i18n);
    expect(button.textContent).toBe('t:clipboard_success');

    vi.advanceTimersByTime(1000);
    expect(button.textContent).toBe('Copy');
    expect(button.classList.contains('clipboard-success')).toBe(false);
  });

  it('shows the copying state while the write is in flight', async () => {
    let release;
    const writeText = vi.fn(() => new Promise((resolve) => { release = resolve; }));
    setClipboard({ writeText });
    const button = makeButton('Copy');

    const pending = copyTextToClipboard({ target: button }, 'x', i18n);

    // Synchronously after the call the button is mid-copy.
    expect(button.textContent).toBe('t:clipboard_copying');
    expect(button.classList.contains('clipboard-copying')).toBe(true);

    release();
    await pending;
    expect(button.classList.contains('clipboard-copying')).toBe(false);
  });

  it('shows the error label and restores it when the write fails', async () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    setClipboard({ writeText: async () => Promise.reject(new Error('nope')) });
    const button = makeButton('Copy');

    await copyTextToClipboard({ target: button }, 'x', i18n);

    expect(error).toHaveBeenCalled();
    expect(button.textContent).toBe('t:clipboard_error');
    expect(button.classList.contains('clipboard-copying')).toBe(false);

    vi.advanceTimersByTime(1000);
    expect(button.textContent).toBe('Copy');
  });
});
