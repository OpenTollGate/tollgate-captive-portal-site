# Changelog

All notable changes to this project are documented here.

## [Unreleased]

### Changed
- **Brand slot:** brand ids are now treated as case-insensitive *identifiers* end to
  end. `VITE_BRAND=ACME` selects `admin/brand/Acme.json` (previously only the
  request was lowercased, so a differently-cased descriptor silently fell back to
  the default). The id alphabet is narrow (`[a-z0-9][a-z0-9._-]*`) and normalized
  to lowercase before it is used as a path component in `admin/brand/<id>.json` /
  `public/assets/brand/<id>/`, so a path-ish value can never escape the slot.
  `scripts/build-all.mjs` and `admin/vite.config.mjs` now resolve the descriptor
  through the same rule (`scripts/brand-id.mjs`) as the runtime
  (`admin/src/brand-core.ts`), so the generated PWA manifest and static favicon
  reference can never drift from the skin the app renders. Descriptor files are
  matched strictly as lowercase `*.json` (the exact set `import.meta.glob('.../*.json')`
  sees), so a `README.md` or uppercase-extension file can never become a phantom
  brand id; the build fails early on a descriptor the runtime would reject.
  ([PR #54 follow-up](https://github.com/OpenTollGate/tollgate-captive-portal-site/pull/54))

### Fixed
- **OpenWrt admin setup:** the foreign-skin cleanup in
  `92-tollgate-admin-setup` can no longer delete the active brand's own webroot
  (or `/www`) when a malformed `__FOREIGN_SKINS__` token lists it — it now skips
  the resolved `$ADMIN_HOME` and anything outside `/www/*`.
