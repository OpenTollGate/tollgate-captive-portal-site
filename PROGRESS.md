# PROGRESS — Portal SPA + rpcd: the LuCI cross-link is a router answer

Worktree: `~/worktrees/portal-luci-link` (repo tollgate-captive-portal-site),
branch `pr/portal-luci-link` @ origin/main `4158030`. Push target: `fork`.

## Cluster 1 — delete the hardcoded admin cross-link (DONE)
- `admin/src/routes/login.tsx`: removed the `http://${window.location.hostname}:8080/`
  anchor entirely; `admin/src` now has no `:8080` url and no `location.hostname/port`.

## Cluster 2 — render the cross-link from the router answer (DONE)
- `admin/src/lib/ui-links.ts` (new, pure): parses `tollgate ui links --json`
  (`{entry_ui, links:{board,luci:{url,port,tls_port,reason}}}`); `crossLinkFor()`
  returns the router's url verbatim, refuses non-HTTPS, and always carries a reason.
- `admin/src/components/ui-cross-link.tsx` (new): anchor (`target=_blank`,
  `rel=noopener`) when the router names an HTTPS url; otherwise a plain reason
  line and NO anchor; renders nothing while the answer is in flight.
- `admin/src/lib/ubus.ts`: `fetchUiLinks()` via ubus `tollgate.ui_links`; never throws.
- `admin/src/components/layout.tsx`: header action fetches ui_links and renders it.
- `admin/src/lib/ubus.mock.ts`: `mockUiLinks()` (`?mockUiLinks=none` for the empty case).
- `admin/src/styles/admin.css`: `.header-actions`, `.ui-crosslink`, `.ui-crosslink-reason`.

## Cluster 3 — rpcd method + ACL + docs (DONE)
- `openwrt/rpcd/tollgate`: `ui_links` in `list`, `ui_links)` case runs
  `tollgate ui links --json`.
- `openwrt/rpcd/tollgate_acl.json`: `ui_links` in the authenticated `tollgate`
  read group (not unauthenticated — least privilege).
- `admin/README.md`: method table + the HTTPS-only / no-dead-button rule.

## Cluster 4 — vitest unit tests (DONE)
- `tests/unit/ui-cross-link.test.js`: 10 tests — url rendered from the router
  answer (and follows the live mapping), empty url => no anchor + reason,
  HTTPS-only, nothing derived from location, plus a source scan that fails if
  `:8080`/`location.hostname` comes back (with a self-check).

## Verified
- `npm ci` (node v22.22.1) — OK.
- `npx vitest run tests/unit/ui-cross-link.test.js` — 10 passed.
- `npx vitest run` for the touched/consumer files (ui-cross-link,
  admin-credential-guard, brand, brand-bundling) — 49 passed (4 files).
- `npx tsc -p admin/tsconfig.json` — only the pre-existing
  `admin/src/routes/devices.tsx(26,15)` implicit-any error (untouched file).
- `npm run build:admin` — OK (26 modules, 66.74 kB js).

Pushed: `d9b46d2` -> `fork/pr/portal-luci-link`.
