import QrScanner from 'qr-scanner';
import QRCode from 'qrcode-svg';

/**
 * Opens the camera and scans a QR code. Returns a Promise that resolves with the QR code text.
 * @returns {Promise<string>} The scanned QR code text.
 */
export async function scanQr({ options = {} } = {}) {
  return new Promise(async (resolve, reject) => {
    // Create container for video and buttons
    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.top = '0';
    container.style.left = '0';
    container.style.width = '100vw';
    container.style.height = '100vh';
    container.style.zIndex = '9999';
    container.style.backgroundColor = 'black';
    container.style.overflow = 'hidden';
    document.body.appendChild(container);

    // Create fullscreen video element
    const videoElem = document.createElement('video');
    videoElem.style.position = 'absolute';
    videoElem.style.top = '0';
    videoElem.style.left = '0';
    videoElem.style.width = '100vw';
    videoElem.style.height = '100vh';
    videoElem.style.objectFit = 'cover';
    videoElem.style.zIndex = '1';
    videoElem.setAttribute('playsinline', '');
    container.appendChild(videoElem);

    // Create bottom bar for buttons (overlay)
    const buttonBar = document.createElement('div');
    buttonBar.style.position = 'absolute';
    buttonBar.style.left = '0';
    buttonBar.style.right = '0';
    buttonBar.style.bottom = '0';
    buttonBar.style.width = '100%';
    buttonBar.style.zIndex = '2';
    buttonBar.style.display = 'flex';
    buttonBar.style.justifyContent = 'center';
    buttonBar.style.gap = '1rem';
    buttonBar.style.padding = '2rem';
    container.appendChild(buttonBar);

    // Helper to create styled buttons
    function makeButton(text) {
      const btn = document.createElement('button');
      btn.style.width = 'auto';
      btn.textContent = text;
      btn.style.display = 'flex';
      btn.style.alignItems = 'center';
      btn.style.justifyContent = 'center';
      btn.style.gap = '1rem';
      // btn.style.background = 'transparent';
      btn.classList = 'ghost cta';
      return btn;
    }

    // Create buttons
    const flipButton = makeButton('Flip Camera');
    const uploadButton = makeButton('Upload from File');
    const cancelButton = makeButton('Cancel');

    // Add buttons to bar
    buttonBar.appendChild(flipButton);
    buttonBar.appendChild(uploadButton);
    buttonBar.appendChild(cancelButton);

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
      if (cameras.length <= 1) {
        flipButton.style.display = 'none';
      } else {
        flipButton.style.display = '';
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
        alert('No QR code found in the selected image.');
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
      cleanup();
      reject(err);
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