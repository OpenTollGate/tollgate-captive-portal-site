# Guest Wi-Fi table cards

In authenticated Admin → WiFi, choose a guest radio, prepare a card, then print.
The QR publishes Wi-Fi credentials, not a payment token or wallet secret. Keep
printed cards under venue control and replace them when the guest key changes.
The phone may ask the guest to confirm joining. Association, DHCP and captive
portal detection are separate steps; scanning alone does not buy internet.

Only installer-owned `tollgate_2g_open` / `tollgate_5g_open` AP sections attached
to `lan` or `guest` are accepted. Private, upstream, custom/ambiguous mappings,
WEP, enterprise and WPA3-only authentication fail closed. Open and WPA/WPA2
Personal passphrases (8–63 characters) are supported. A single authenticated
UCI section read is used; no module private key or payment configuration is read.
Cards remain in component memory only; hide or leave the page to discard them.
Refresh/reprepare after configuration changes; printed cards cannot be revoked.

The `qrcode` encoder is intentional: the existing qrcode-svg encoder inserts
a UTF-8 BOM into non-ASCII payloads, breaking the exact `WIFI:` prefix in a
real decoder roundtrip. The browser test checks exact decoded text, including
Unicode and escaped punctuation, and renders a print PDF.

## Verification boundaries

Unit tests exercise payload and allowlist guards. Admin Playwright tests use
mock UCI data and real QR image decoding, browser print media and PDF output.
They do not prove RF association, camera recognition, DHCP or captive detection.
Router acceptance belongs in physical-router-test-automation, with exact
firmware/package hashes and source SHAs. No physical, QEMU or Android join
success is claimed by these tests. Maintainer review and lab acceptance remain
required before release.
