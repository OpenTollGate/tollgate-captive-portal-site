// Characterization tests for src/helpers/qr-code.js.
//
// Three surfaces, all of them load-bearing on a captive portal served over
// plain HTTP (no secure context, so no camera):
//
//   * hasCameraSupport()  — the capability probe that decides whether a camera
//                           button is offered at all;
//   * scanQr()            — the overlay it drives, including the upload-only
//                           degradation and the file-scan resolve/reject paths;
//   * createQr()          — the invoice QR the cashu/lightning flows paint.
//
// qr-scanner is replaced with a double so no camera or worker is involved; the
// DOM the helper builds is the real thing, and every assertion below reads it
// back.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── qr-scanner double ──────────────────────────────────────────────────
// The helper imports it dynamically (`(await import('qr-scanner')).default`),
// which a module mock intercepts just like a static import.
const scannerState = {
  cameras: [{ id: 'back' }, { id: 'front' }],
  ctorThrows: false,
  startBehavior: 'resolve',
  decodeImmediately: false,
  instances: [],
  listCameras: null,
  scanImage: null,
};

vi.mock('qr-scanner', () => {
  class QrScanner {
    constructor(video, onDecode, options) {
      if (scannerState.ctorThrows) {
        // What qr-scanner does in a non-secure context.
        throw new Error('getUserMedia is not available in a non-secure context');
      }
      this.video = video;
      this.onDecode = onDecode;
      this.options = options;
      this.started = false;
      this.stopped = false;
      this.camera = options?.preferredCamera;
      scannerState.instances.push(this);
    }

    start() {
      if (scannerState.startBehavior === 'reject') {
        return Promise.reject(new Error('NotAllowedError: permission denied'));
      }
      this.started = true;
      if (scannerState.decodeImmediately) {
        this.onDecode({ data: 'cashuB-decoded-from-camera' });
      }
      return Promise.resolve();
    }

    stop() {
      this.stopped = true;
    }

    setCamera(id) {
      this.camera = id;
      return Promise.resolve();
    }

    static listCameras() {
      return scannerState.listCameras();
    }

    static scanImage(file, options) {
      return scannerState.scanImage(file, options);
    }
  }
  return { default: QrScanner };
});

const i18n = (key, fallback) => (fallback !== undefined ? fallback : `t:${key}`);

const { hasCameraSupport, scanQr, requestScanQr, createQr } = await import(
  '../../src/helpers/qr-code.js'
);

const el = (selector) => document.querySelector(selector);
const click = (node) => node.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

// scanQr() rejects on cancel. Tests that end by cancelling must mark the
// rejection as handled even when they only assert on the DOM, or vitest reports
// an unhandled rejection for a promise the test deliberately abandoned.
const startScan = (...args) => {
  const pending = scanQr(...args);
  pending.catch(() => {});
  return pending;
};

const withCamera = () => {
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: () => Promise.resolve({}) },
    configurable: true,
    writable: true,
  });
};

const withoutCamera = () => {
  Object.defineProperty(navigator, 'mediaDevices', {
    value: undefined,
    configurable: true,
    writable: true,
  });
};

// Let the helper's awaited dynamic import and promise chain run.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// scanQr() settles only on an interaction (or a scanner event), so
// "still waiting" is itself an assertion: race it against a short timer.
const outcomeWithin = async (promise, ms = 10) => {
  let outcome = 'pending';
  promise.then(
    (value) => { outcome = { resolved: value }; },
    (error) => { outcome = { rejected: String(error && error.message) }; }
  );
  await new Promise((resolve) => setTimeout(resolve, ms));
  return outcome;
};

const chooseFile = (name = 'qr.png') => {
  const fileInput = document.querySelector('input[type="file"]');
  const file = new window.File(['x'], name, { type: 'image/png' });
  Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
  fileInput.dispatchEvent(new window.Event('change'));
  return file;
};

beforeEach(() => {
  scannerState.cameras = [{ id: 'back' }, { id: 'front' }];
  scannerState.ctorThrows = false;
  scannerState.startBehavior = 'resolve';
  scannerState.decodeImmediately = false;
  scannerState.instances = [];
  scannerState.listCameras = vi.fn(async () => scannerState.cameras);
  scannerState.scanImage = vi.fn(async () => ({ data: 'cashuB-from-image' }));
  document.body.innerHTML = '';
  withoutCamera();
});

afterEach(() => {
  document.body.innerHTML = '';
  delete navigator.mediaDevices;
  vi.restoreAllMocks();
});

describe('hasCameraSupport', () => {
  it('is false when navigator.mediaDevices is absent (plain-HTTP portal)', () => {
    withoutCamera();
    expect(hasCameraSupport()).toBe(false);
  });

  it('is false when mediaDevices exists but getUserMedia does not', () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {},
      configurable: true,
      writable: true,
    });
    expect(hasCameraSupport()).toBe(false);
  });

  it('is true when getUserMedia is available', () => {
    withCamera();
    expect(hasCameraSupport()).toBe(true);
  });
});

describe('createQr', () => {
  it('renders a real SVG for the payload', () => {
    const svg = createQr('lightning:lnbc1test');
    // qrcode-svg emits an XML prolog, then the root <svg> element.
    expect(svg.startsWith('<?xml')).toBe(true);
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('viewBox="0 0 256 256"');
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
    // A real encode of this payload is ~35 KB of module rects; a stub that
    // returned an empty <svg> would not reach this length.
    expect(svg.length).toBeGreaterThan(10000);
  });

  it('honours caller options over its defaults', () => {
    const withPadding = createQr('lightning:lnbc1test', { padding: 4 });
    expect(withPadding).toContain('viewBox');
    // The default padding is 0, so asking for 4 must change the geometry.
    expect(withPadding).not.toBe(createQr('lightning:lnbc1test'));
  });
});

describe('scanQr without a camera (upload-only degradation)', () => {
  it('hides the video and flip button and names the reason', async () => {
    const pending = startScan({}, i18n);
    await flush();

    expect(el('.tollgate-captive-portal-scan-qr-container')).toBeTruthy();
    expect(el('video').style.display).toBe('none');
    expect(el('.flip-camera').style.display).toBe('none');
    const inner = el('.tollgate-captive-portal-scan-qr-overlay-inner');
    expect(inner.classList.contains('error')).toBe(true);
    expect(inner.getAttribute('data-error')).toBe('t:qr_camera_unavailable');
    // With no camera API it must not even construct a scanner.
    expect(scannerState.instances).toHaveLength(0);
    expect(scannerState.listCameras).not.toHaveBeenCalled();

    expect(await outcomeWithin(pending)).toBe('pending');
  });

  it('still offers upload, and a chosen image resolves the scan', async () => {
    const pending = startScan({}, i18n);
    await flush();

    const fileInput = document.querySelector('input[type="file"]');
    expect(fileInput).toBeTruthy();
    expect(fileInput.accept).toBe('image/*');

    const file = chooseFile();

    await expect(pending).resolves.toEqual({ status: 1, value: 'cashuB-from-image' });
    expect(scannerState.scanImage).toHaveBeenCalledWith(file, {
      returnDetailedScanResult: true,
    });
    // The overlay is torn down on success.
    expect(el('.tollgate-captive-portal-scan-qr-container')).toBeNull();
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it('resolves QR003 when the image holds no readable code', async () => {
    scannerState.scanImage = vi.fn(async () => { throw new Error('no qr code found'); });
    const pending = startScan({}, i18n);
    await flush();
    chooseFile('blank.png');

    await expect(pending).resolves.toEqual({
      status: 0,
      code: 'QR003',
      label: 't:QR003_label',
      message: 't:QR003_message',
    });
    expect(el('.tollgate-captive-portal-scan-qr-container')).toBeNull();
  });

  it('ignores a change event with no file selected', async () => {
    const pending = startScan({}, i18n);
    await flush();

    const fileInput = document.querySelector('input[type="file"]');
    Object.defineProperty(fileInput, 'files', { value: [], configurable: true });
    fileInput.dispatchEvent(new window.Event('change'));
    await flush();

    expect(scannerState.scanImage).not.toHaveBeenCalled();
    expect(document.querySelector('input[type="file"]')).toBeTruthy();
    expect(await outcomeWithin(pending)).toBe('pending');
  });

  it('the upload button clears the picker before opening it', async () => {
    const pending = startScan({}, i18n);
    await flush();

    const fileInput = document.querySelector('input[type="file"]');
    const clickSpy = vi.spyOn(fileInput, 'click').mockImplementation(() => {});
    click(el('.upload'));
    // jsdom only allows programmatic file-input values of '', so a re-arm is
    // observable exactly as "still empty" plus "click was forwarded".
    expect(fileInput.value).toBe('');
    expect(clickSpy).toHaveBeenCalledTimes(1);
    click(el('.cancel'));
    await expect(pending).rejects.toThrow('QR scan cancelled by user');
  });
});

describe('scanQr cancellation', () => {
  it('rejects with the cancel sentinel and removes the overlay', async () => {
    const pending = startScan({}, i18n);
    await flush();

    click(el('.cancel'));
    await expect(pending).rejects.toThrow('QR scan cancelled by user');
    expect(el('.tollgate-captive-portal-scan-qr-container')).toBeNull();
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });
});

describe('scanQr with a camera', () => {
  it('starts a scanner on the preferred camera and resolves on decode', async () => {
    withCamera();
    scannerState.decodeImmediately = true;
    const pending = startScan({}, i18n);
    await flush();

    expect(scannerState.instances).toHaveLength(1);
    const scanner = scannerState.instances[0];
    expect(scanner.options.returnDetailedScanResult).toBe(true);
    expect(scanner.options.preferredCamera).toBe('back');
    expect(scanner.stopped).toBe(true);
    await expect(pending).resolves.toEqual({
      status: 1,
      value: 'cashuB-decoded-from-camera',
    });
    expect(el('.tollgate-captive-portal-scan-qr-container')).toBeNull();
  });

  it('passes caller options through to the scanner', async () => {
    withCamera();
    const pending = startScan({ options: { maxScansPerSecond: 3 } }, i18n);
    await flush();
    expect(scannerState.instances[0].options.maxScansPerSecond).toBe(3);
    click(el('.cancel'));
    await pending.catch(() => {});
  });

  it('shows the flip button when more than one camera exists', async () => {
    withCamera();
    const pending = startScan({}, i18n);
    await flush();
    expect(el('.flip-camera').style.display).toBe('block');
    click(el('.cancel'));
    await pending.catch(() => {});
  });

  it('leaves the flip button hidden with a single camera', async () => {
    withCamera();
    scannerState.cameras = [{ id: 'only' }];
    const pending = startScan({}, i18n);
    await flush();
    expect(el('.flip-camera').style.display).toBe('');
    // ...and clicking it does nothing rather than throwing.
    click(el('.flip-camera'));
    await flush();
    expect(scannerState.instances[0].camera).toBe('only');
    expect(await outcomeWithin(pending)).toBe('pending');
  });

  it('flip cycles through the available cameras', async () => {
    withCamera();
    const pending = startScan({}, i18n);
    await flush();
    const scanner = scannerState.instances[0];
    expect(scanner.camera).toBe('back');

    click(el('.flip-camera'));
    await flush();
    expect(scanner.camera).toBe('front');

    click(el('.flip-camera'));
    await flush();
    expect(scanner.camera).toBe('back');

    expect(await outcomeWithin(pending)).toBe('pending');
    click(el('.cancel'));
  });

  it('degrades to upload-only when the camera will not start', async () => {
    withCamera();
    scannerState.startBehavior = 'reject';
    const pending = startScan({}, i18n);
    await flush();
    await flush();

    // The refusal is a rejection the helper catches itself; it must not surface
    // as an unhandled promise on the caller's side.
    expect(el('video').style.display).toBe('none');
    expect(el('.flip-camera').style.display).toBe('none');
    expect(el('.tollgate-captive-portal-scan-qr-overlay-inner').getAttribute('data-error'))
      .toBe('t:qr_camera_unavailable');
    expect(await outcomeWithin(pending)).toBe('pending');
    click(el('.cancel'));
  });

  it('degrades to upload-only when the scanner constructor throws', async () => {
    withCamera();
    scannerState.ctorThrows = true;
    const pending = startScan({}, i18n);
    await flush();
    await flush();

    expect(el('video').style.display).toBe('none');
    expect(el('.flip-camera').style.display).toBe('none');
    expect(el('.tollgate-captive-portal-scan-qr-overlay-inner').getAttribute('data-error'))
      .toBe('t:qr_camera_unavailable');
    expect(await outcomeWithin(pending)).toBe('pending');
    click(el('.cancel'));
  });
});

describe('requestScanQr', () => {
  it('returns the scanned value', async () => {
    const pending = requestScanQr(i18n);
    await flush();
    chooseFile();
    await expect(pending).resolves.toEqual({ status: 1, value: 'cashuB-from-image' });
  });

  it('returns QR002 when the scan produced no string', async () => {
    scannerState.scanImage = vi.fn(async () => ({ data: '' }));
    const pending = requestScanQr(i18n);
    await flush();
    chooseFile();
    await expect(pending).resolves.toEqual({
      status: 0,
      code: 'QR002',
      label: 't:QR002_label',
      message: 't:QR002_message',
    });
  });

  it('maps a user cancellation to a silent code 0', async () => {
    const pending = requestScanQr(i18n);
    await flush();
    click(el('.cancel'));
    await expect(pending).resolves.toEqual({ status: 0, code: 0 });
  });
});
