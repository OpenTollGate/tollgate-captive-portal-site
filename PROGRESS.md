# PROGRESS — 92-tollgate-admin-setup mode-aware (branch pr/portal-entry-ui-mapping)

Own log, one line per cluster. Push target: `fork`. No PR.
Lane: packaging/, openwrt/files/, .github/workflows/, CHANGELOG.md. No admin/src,
no tests/unit, no openwrt/rpcd.

## Protocol (agreed with the module half; spec D1-D4)
- entry_ui from /etc/tollgate/config.json (flat field) via jq; board|luci; default board.
- entry pair = 8080(HTTP)+443(TLS); secondary pair = 8090+8443. Sets never change.
- board: uhttpd.admin (this repo) = entry pair; uhttpd.main (module) = secondary.
- luci: today's mapping (admin 8090+8443, main 8080+443).
- D4 marker: ${TOLLGATE_ENTRY_UI_MARKER:-/etc/tollgate/entry-ui-mapping}, content =
  resolved value, existence = "mode-aware 92 installed"; NOT written by the refusal path.

## Log
- [C0] recon: spec D2/D3/D7 + 7 invariants + slice row 2; 92 (383 lines); 3 test harnesses.
- [C0] 4a61589 pushed: PROGRESS.md.
- [C1] d96481a pushed: RED tests (lib-92-sandbox.sh + mapping + pre-auth guard). RED proven.
- [C2] 92 rewritten (P1-P10): mapping cluster + entry_ui_resolved, mode-aware listener/strip,
  D4 marker, pre-auth ADD block deleted -> all four admin ports REMOVED, fail-open probes
  follow the owned port. Three existing harnesses extended (mapping vars), ci.yml step added,
  CHANGELOG + uhttpd_admin reference snapshot updated.
- [C2] GREEN: mapping 10/0, guard 6/0, credential 8/0, luci-guard 9/0, single-rule rc=0,
  board-TLS 12/0 (incl. the new board-mode cases).
- [C3] (final) full-suite re-run against the frozen tree, REPORT.md, final push.
