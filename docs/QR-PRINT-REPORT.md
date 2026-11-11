# QR print pagination regression (2026-11-06)

Bounded software milestone only; PR #102 must remain OPEN/DRAFT. No merge, ready transition, pins, release or hardware action authorized.

## Change and red/green evidence

Starting remote head: `9bacd9eb90ddcbba8fa35d573edad240f1b2011f`.
Quota gate exited 0. Fresh isolated checkout; parent confirmed no other source workers and local process check found no concurrent QR/test worker. Old worktrees untouched.

Before CSS changes, new tests failed at the real `pdfinfo` page-count assertion for BOTH A4 and Letter: **2 pages** each. Geometry: A4 595.92 x 842.88 pt; Letter 612 x 792 pt. Original visibility-only rules retained all hidden dashboard layout in pagination. Absolute positioning of the card did not remove those boxes.

After: **1 page** each with identical paper geometry. Unrelated boxes are removed from print layout, ancestors normalized, ancestor raw text remains hidden, and only the card becomes visible. Screen CSS and credential lifecycle code are unchanged. Card capped at 160 mm, QR remains 320 CSS px; text boxes fit inside sheet bounds. Tests inject outside/card-control raw-text sentinels and reject leaked controls. PDF raster QR decoding matches the literal escaped Unicode WPA payload (synthetic Café/Chinese SSID); no real credentials used.

## Executed commands/results

- RED: `ADMIN_TEST_PORT=15329 npm run test:admin -- admin-guest-wifi.spec.mjs --grep 'Unicode card'`: 2 failed, both page count 2 vs 1.
- GREEN: `ADMIN_TEST_PORT=15329 npm run test:admin -- admin-guest-wifi.spec.mjs`: 10/10 (including final literal Unicode assertion).
- `npm test`: 24 files, 237/237.
- `npx vitest run tests/unit/guest-wifi-qr.test.js tests/unit/guest-wifi-card.test.jsx --coverage --coverage.include=admin/src/lib/guest-wifi-qr.ts --coverage.include=admin/src/components/guest-wifi-card.tsx`: 45/45, 100% statements/branches/functions/lines both files, unchanged from prior measurement. F1/F2 regressions preserved.
- `ADMIN_TEST_PORT=15329 npm run test:admin`: 48/48 (before final stronger literal-payload assertion; focused 10/10 rerun after it).
- `npm run build`: full multi-brand portal + admin build passed; existing large-chunk warning.
- `npx tsc --noEmit -p admin/tsconfig.json`: sole known baseline TS7006 in devices.tsx:26, unrelated to this CSS/test change. Not a green typecheck.
- `git diff --check`: passed.

Changed production file is CSS; V8 does not instrument CSS, so no invented changed-line coverage percentage is claimed. Both new print-format cases execute the changed stylesheet in Chromium and measure actual PDF output. Test dependencies: Poppler `pdfinfo`, `pdftotext`, `pdftoppm`. PDFs/rasters are generated under Playwright test-results, not committed.

Fresh-context diff review found no blocking defects; suggested literal Unicode payload assertion was added and rerun. Reviewer runtime alias tier/delegation, actual family unverified: NOT cross-family evidence or independent maintainer approval.

## Limits

Chromium PDF verification is not physical paper/camera or OS join evidence. Browser mocks do not prove real rpcd ACLs. Print CSS uses modern `:has()` support. Independent maintainer review, hardware/ACL acceptance and current-head CI remain separate gates. No release readiness claim.
