# PROGRESS — 92-tollgate-admin-setup mode-aware (branch pr/portal-entry-ui-mapping)

Own log, one line per cluster. Overwrites the stale PROGRESS.md from a dead run.
Push target: `fork`. No PR. Lane: packaging/ only (no admin/src, no tests/unit, no rpcd).

## Protocol pinned with the module half (read from the sibling's PROGRESS.md + spec D1-D4)
- entry_ui read from /etc/tollgate/config.json (flat field) via jq; board|luci; default board.
- entry pair = 8080(HTTP)+443(TLS); secondary pair = 8090+8443. Sets never change, meaning does.
- board: uhttpd.admin (this repo's section) = entry pair; uhttpd.main (module's) = secondary.
- luci: today's mapping (admin 8090+8443, main 8080+443).
- D4 marker: ${TOLLGATE_ENTRY_UI_MARKER:-/etc/tollgate/entry-ui-mapping}, content = resolved
  value, existence = "mode-aware 92 installed". 99 honours board only with it.

## Log
- [C0] recon: spec D2/D3/D7 + 7 invariants + slice row 2; 92 (383 lines); both 92 test harnesses.
- [C0] first commit: PROGRESS.md (4a61589) pushed to fork.
- [C1] RED tests written + pushed: lib-92-sandbox.sh (whole-script sandbox), test-92-entry-ui-mapping.sh,
  test-92-nodogsplash-pre-auth-guard.sh. RED evidence: mapping a/d/f FAIL + resolver sentinel drift;
  guard 5 failed / 1 passed (control passes).
- [C2] (next) rewrite 92: mode-aware mapping, resolver, D4 marker, TLS follows the 443 owner,
  delete the pre-auth ADD block -> remove all four admin ports instead.
- [C3] (next) extend test-92-admin-board-tls.sh for the mode split; run every touched packaging test;
  add both new tests to .github/workflows/ci.yml; REPORT.md; final push.
