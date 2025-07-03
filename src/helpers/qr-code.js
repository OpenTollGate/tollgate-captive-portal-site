// external
import React from 'react';
import { createRoot } from 'react-dom/client';
import QrScanner from 'qr-scanner';
import QRCode from 'qrcode-svg';

// internal
import { ImageIcon, FlipCameraIcon, CancelIcon } from '../components/Icon'

// request a qr code scan from the user, using camera or file upload
export const requestScanQr = async (i18n) => {
  try {
    // call the scanQr function and handle the result
    const response = await scanQr({}, i18n);
    if (response.status && 'object' === typeof response && 'string' === typeof response.value) {
      // successful scan, return the value
      return {
        status: 1,
        value: response.value ||  ''
      }
    } else {
      // failed scan, return error object
      return {
        status: 0,
        code: 'QR002',
        label: i18n('QR002_label'),
        message: i18n('QR002_message')
      }
    }
  } catch (err) {
    // handle user cancellation or other errors
    if (!(err && err.message && err.message.includes('cancelled by user'))) {
      return {
        status: 0,
        code: 'QR002',
        label: i18n('QR002_label'),
        message: i18n('QR002_message')
      }
    } else {
      // user cancelled, return code 0 (no error shown)
      return {
        status: 0,
        code: 0
      }
    }
  }
}

// opens the camera and scans a qr code. returns a promise that resolves with the qr code text.
export async function scanQr({ options = {} } = {}, i18n) {
  return new Promise(async (resolve, reject) => {
    // create container for video and buttons
    const container = document.createElement('div');
    container.classList = 'tollgate-captive-portal-scan-qr-container'
    const overlay = document.createElement('div');
    overlay.classList = 'tollgate-captive-portal-scan-qr-overlay'
    container.appendChild(overlay);
    const overlayInner = document.createElement('div');
    overlayInner.classList = 'tollgate-captive-portal-scan-qr-overlay-inner'
    overlay.appendChild(overlayInner);
    document.body.appendChild(container);

    // create fullscreen video element for camera preview
    const videoElem = document.createElement('video');
    videoElem.classList = 'tollgate-captive-portal-scan-qr-video-element'
    container.appendChild(videoElem);

    // create bottom bar for buttons (overlay)
    const buttonBar = document.createElement('div');
    buttonBar.classList = 'tollgate-captive-portal-scan-qr-button-bar'
    container.appendChild(buttonBar);

    // create left side of button bar for camera/file controls
    const buttonBarLeft = document.createElement('div');
    buttonBarLeft.classList = 'tollgate-captive-portal-scan-qr-button-bar-left'
    buttonBar.appendChild(buttonBarLeft);

    // create camera flip button
    const flipButton = document.createElement('button');
    flipButton.title = i18n('qr_flip_camera');
    flipButton.classList = 'ghost cta flip-camera';
    
    // create upload from file button
    const uploadButton = document.createElement('button');
    uploadButton.title = i18n('qr_upload');
    uploadButton.classList = 'ghost cta upload';

    // create cancel button
    const cancelButton = document.createElement('button');
    cancelButton.title = i18n('qr_cancel');
    cancelButton.classList = 'ghost cancel';

    // add buttons to bar and render icons
    buttonBarLeft.appendChild(flipButton);
    createRoot(flipButton).render(React.createElement(FlipCameraIcon, null))
    buttonBarLeft.appendChild(uploadButton);
    createRoot(uploadButton).render(React.createElement(ImageIcon, null))
    buttonBar.appendChild(cancelButton);
    createRoot(cancelButton).render(React.createElement(CancelIcon, null))

    // create hidden file input for image upload
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.style.display = 'none';
    document.body.appendChild(fileInput);

    // cleanup function to remove all elements and stop video
    const cleanup = () => {
      videoElem.pause();
      videoElem.srcObject = null;
      if (container.parentNode) container.parentNode.removeChild(container);
      if (fileInput.parentNode) fileInput.parentNode.removeChild(fileInput);
    };

    // cancel button handler
    cancelButton.onclick = () => {
      cleanup();
      reject(new Error('QR scan cancelled by user'));
    };

    // camera management
    let cameras = [];
    let currentCameraIdx = 0;
    let qrScanner;
    let isFlipping = false;

    // get available cameras and show flip button if more than one
    async function setupCameras() {
      cameras = await QrScanner.listCameras();
      if (cameras.length > 1) {
        flipButton.style.display = 'block';
      }
    }

    // switch to a different camera
    async function setCamera(idx) {
      if (!qrScanner || !cameras[idx]) return;
      isFlipping = true;
      await qrScanner.setCamera(cameras[idx].id);
      isFlipping = false;
    }

    // flip camera button handler
    flipButton.onclick = async () => {
      if (isFlipping || cameras.length <= 1) return;
      currentCameraIdx = (currentCameraIdx + 1) % cameras.length;
      await setCamera(currentCameraIdx);
    };

    // upload from file button handler
    uploadButton.onclick = () => {
      fileInput.value = '';
      fileInput.click();
    };

    // handle file input change (user selects an image)
    fileInput.onchange = async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        // try to scan qr code from the image file
        const result = await QrScanner.scanImage(file, { returnDetailedScanResult: true });
        cleanup();
        resolve({
          status: 1,
          value: result.data || result
        });
      } catch (err) {
        // failed to find qr code in image
        cleanup();
        resolve({
          status: 0,
          code: 'QR003',
          label: i18n('QR003_label'),
          message: i18n('QR003_message')
        })
      }
    };

    // start camera and qr scanner
    await setupCameras();
    qrScanner = new QrScanner(
      videoElem,
      result => {
        // qr code found, stop scanner and cleanup
        qrScanner.stop();
        cleanup();
        resolve({
          status: 1,
          value: result.data || result
        });
      },
      { returnDetailedScanResult: true, ...options, preferredCamera: cameras[currentCameraIdx]?.id }
    );
    qrScanner.start().catch(err => {
      // failed to start camera or scanner
      overlayInner.classList.add('error');
      overlayInner.setAttribute('data-error', i18n('QR004_message'))
    });
  });
}

// creates a qr code and returns an svg image as a string to render in the site.
export function createQr(text, options = {}) {
  // create a new qr code svg with the given text and options
  const qr = new QRCode({
    content: text,
    container: "svg-viewbox",
    padding: 0,
    ...options,
  });
  // return the svg markup as a string
  return qr.svg();
} 