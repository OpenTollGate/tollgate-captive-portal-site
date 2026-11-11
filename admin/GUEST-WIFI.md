# Guest Wi-Fi table cards

In authenticated Admin → WiFi, choose a guest radio, prepare a card, then print.
The QR publishes Wi-Fi credentials, not a payment token or wallet secret. Keep
printed cards under venue control and replace them when the guest key changes.
The phone may ask the guest to confirm joining. Association, DHCP and captive
portal detection are separate steps; scanning alone does not buy internet.

Only installer-owned `tollgate_2g_open` / `tollgate_5g_open` AP sections attached
to exactly one `lan` or `guest` network are accepted. Private, upstream, custom/ambiguous mappings,
WEP, enterprise and WPA3-only authentication fail closed. Open and WPA/WPA2
Personal passphrases (8–63 characters) are supported. A single authenticated
UCI section read is used; no module private key or payment configuration is read.
Cards remain in component memory only; hide or leave the page to discard them.
Save and Refresh discard the on-screen card and pending preparation; reprepare
after configuration changes. Printed cards cannot be revoked.

The `qrcode` encoder is intentional: the existing qrcode-svg encoder inserts
a UTF-8 BOM into non-ASCII payloads, breaking the exact `WIFI:` prefix in a
real decoder roundtrip. The browser test checks exact decoded text, including
Unicode and escaped punctuation, and renders a print PDF.

## Reproducing source verification

Use Node 22.17.0 and `npm ci`. Run `npm test`, `npm run build`,
`npx tsc --noEmit -p admin/tsconfig.json`, and `npm run test:admin`.
The print roundtrip requires Poppler's `pdfinfo`, `pdftotext` and `pdftoppm` on
PATH: it rasterizes the actual Chromium PDF and decodes that raster, independently
of the screen SVG. Those three print tests SKIP with an explicit reason when
Poppler is absent (no false pass); the other eight browser tests still run.
For focused helper and Preact component coverage:

```sh
npx vitest run tests/unit/guest-wifi* --coverage --coverage.include=admin/src/lib/guest-wifi-qr.ts --coverage.include=admin/src/components/guest-wifi-card.tsx
```

Component tests cover targeted section reads, missing/unsafe RPC replies,
redaction of transport errors, pending controls, retry, print, hide and radio
changes. Browser tests also check the pre-auth gate and session-expiry removal.
Disabled flags fail closed: only absent, false, zero or `"0"` are enabled.
Value boundaries are pinned in bytes: a 32-byte SSID is accepted and 33 rejected
(multibyte characters count as their UTF-8 length), a 63-character passphrase is
accepted and 64 rejected, and `psk`/`psk2`/`psk-mixed` with `tkip`,
`tkip+ccmp` or `ccmp` cipher suffixes encode as `T:WPA`.

The print stylesheet activates only while a prepared card exists
(`body:has(#guest-wifi-print-card)`); on every other page and on WiFi before a
card is prepared, Ctrl+P prints that page normally rather than a blank sheet.
Card content is the only visible thing in print media.

Preact no-ops `setState` after unmount, so the unmount cases assert the fetch
continuation never reaches the QR encoder — that is the `generation` guard's
externally observable effect. A second concurrent fetch is not user-reachable:
the prepare button is disabled while a request is in flight.

## Verification boundaries

Unit tests exercise payload and allowlist guards. Admin Playwright tests use
mock UCI data and real QR image decoding, browser print media and PDF output.
They do not prove RF association, camera recognition, DHCP or captive detection.
Router acceptance belongs in physical-router-test-automation, with exact
firmware/package hashes and source SHAs. No physical, QEMU or Android join
success is claimed by these tests. Maintainer review and lab acceptance remain
required before release.
