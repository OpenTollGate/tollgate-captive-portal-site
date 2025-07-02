// external
import React from 'react';
import { createRoot } from 'react-dom/client';
import QrScanner from 'qr-scanner';
import QRCode from 'qrcode-svg';

// internal
import { ImageIcon, FlipCameraIcon, CancelIcon } from '../components/Icon'

/**
 * Opens the camera and scans a QR code. Returns a Promise that resolves with the QR code text.
 * @returns {Promise<string>} The scanned QR code text.
 */
export async function scanQr({ options = {} } = {}, setError, i18n) {
  return new Promise(async (resolve, reject) => {
    // Create container for video and buttons
    const container = document.createElement('div');
    container.classList = 'tollgate-captive-portal-scan-qr-container'
    const overlay = document.createElement('div');
    overlay.classList = 'tollgate-captive-portal-scan-qr-overlay'
    container.appendChild(overlay);
    const overlayInner = document.createElement('div');
    overlayInner.classList = 'tollgate-captive-portal-scan-qr-overlay-inner'
    overlay.appendChild(overlayInner);
    document.body.appendChild(container);

    // Create fullscreen video element
    const videoElem = document.createElement('video');
    videoElem.classList = 'tollgate-captive-portal-scan-qr-video-element'
    container.appendChild(videoElem);

    // Create bottom bar for buttons (overlay)
    const buttonBar = document.createElement('div');
    buttonBar.classList = 'tollgate-captive-portal-scan-qr-button-bar'
    container.appendChild(buttonBar);

    // Create bottom bar for buttons (overlay)
    const buttonBarLeft = document.createElement('div');
    buttonBarLeft.classList = 'tollgate-captive-portal-scan-qr-button-bar-left'
    buttonBar.appendChild(buttonBarLeft);

    // Create buttons
    const flipButton = document.createElement('button');
    flipButton.title = i18n('qr_flip_camera');
    flipButton.classList = 'ghost cta flip-camera';
    
    const uploadButton = document.createElement('button');
    uploadButton.title = i18n('qr_upload');
    uploadButton.classList = 'ghost cta upload';

    const cancelButton = document.createElement('button');
    cancelButton.title = i18n('qr_cancel');
    cancelButton.classList = 'ghost cancel';

    // Add buttons to bar
    buttonBarLeft.appendChild(flipButton);
    createRoot(flipButton).render(React.createElement(FlipCameraIcon, null))
    buttonBarLeft.appendChild(uploadButton);
    createRoot(uploadButton).render(React.createElement(ImageIcon, null))
    buttonBar.appendChild(cancelButton);
    createRoot(cancelButton).render(React.createElement(CancelIcon, null))

    // File input for upload
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.style.display = 'none';
    document.body.appendChild(fileInput);

    // Cleanup function
    const cleanup = () => {
      videoElem.pause();
      videoElem.srcObject = null;
      if (container.parentNode) container.parentNode.removeChild(container);
      if (fileInput.parentNode) fileInput.parentNode.removeChild(fileInput);
    };

    // Cancel button
    cancelButton.onclick = () => {
      cleanup();
      reject(new Error('QR scan cancelled by user'));
    };

    // Camera management
    let cameras = [];
    let currentCameraIdx = 0;
    let qrScanner;
    let isFlipping = false;

    async function setupCameras() {
      cameras = await QrScanner.listCameras();
      if (cameras.length > 1) {
        flipButton.style.display = 'block';
      }
    }

    async function setCamera(idx) {
      if (!qrScanner || !cameras[idx]) return;
      isFlipping = true;
      await qrScanner.setCamera(cameras[idx].id);
      isFlipping = false;
    }

    flipButton.onclick = async () => {
      if (isFlipping || cameras.length <= 1) return;
      currentCameraIdx = (currentCameraIdx + 1) % cameras.length;
      await setCamera(currentCameraIdx);
    };

    // Upload from file
    uploadButton.onclick = () => {
      fileInput.value = '';
      fileInput.click();
    };

    fileInput.onchange = async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        const result = await QrScanner.scanImage(file, { returnDetailedScanResult: true });
        cleanup();
        resolve(result.data || result);
      } catch (err) {
        setError({
          status: 0,
          code: 'QR03',
          label: i18n('QR03_label'),
          message: i18n('QR03_message')
        })
        cleanup();
        reject(err);
      }
    };

    // Start scanner
    await setupCameras();
    qrScanner = new QrScanner(
      videoElem,
      result => {
        qrScanner.stop();
        cleanup();
        resolve(result.data || result);
      },
      { returnDetailedScanResult: true, ...options, preferredCamera: cameras[currentCameraIdx]?.id }
    );
    qrScanner.start().catch(err => {
      overlayInner.classList.add('error');
      overlayInner.setAttribute('data-error', i18n('QR04_message'))
      // console.log(err)
      // // cleanup();
      // // reject(err);
    });
  });
}

/**
 * Creates a QR code and returns an SVG image as a string to render in the site.
 * @param {string} text - The text to encode in the QR code.
 * @param {object} [options] - Optional QR code options.
 * @returns {string} An SVG string representing the QR code image.
 */
export function createQr(text, options = { width: 256, height: 256, margin: 2 }) {
  const qr = new QRCode({
    content: text,
    width: options.width || 256,
    height: options.height || 256,
    padding: options.margin || 2,
    ...options,
  });
  return qr.svg();
} 