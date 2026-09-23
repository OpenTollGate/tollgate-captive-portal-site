# Changelog

All notable changes to this project are documented here.

## [Unreleased]

### Added
- **Cashu mint auto-select:** the purchase page now derives the mint from the
  pasted e-cash note and selects the matching access option, instead of making
  the user pick the mint by hand (the note states which mint issued it, and the
  allocation/price is mint-dependent, so a hand-picked mint showed the wrong
  price). New helpers in `src/helpers/cashu.js`: `mintUrlFromToken` (uses the
  keyset-agnostic `getTokenMetadata` decoder, the `#CU102` fix, with
  `getDecodedToken` as fallback; null on anything undecodable or ambiguous),
  `normalizeMintUrl` (scheme/trailing-slash/case/default-port insensitive) and
  `findMintOption`. Partial input stays silent, a note from a mint the router
  does not accept clears the selection and shows the translated
  `unsupported_mint_notice` naming that mint, and a manual click still wins
  until the note itself changes.

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

### Tests
- **Packaging guard harness:** `tests/packaging/foreign-skins-guard.sh` extracts the
  `__FOREIGN_SKINS__` cleanup loop from `92-tollgate-admin-setup` verbatim, runs it with
  stubbed `uci`/`rm`, and asserts what it tried to delete (11 cases: real foreign skin is
  removed; own webroot, trailing-slash variants, `/www`, paths outside `/www`, bare tokens,
  the unsubstituted placeholder and the active `uhttpd.admin` section are all spared).
  Wired into CI as a step of the unit-test job.
  ([PR #54 follow-up](https://github.com/OpenTollGate/tollgate-captive-portal-site/pull/54))

### Fixed
- **Runtime brand slot (release blocker):** `admin/src/brand.ts` loaded the slot
  with `import.meta.glob('../../brand/*.json')`. A relative glob is resolved
  against the *importing module*, so the pattern pointed at `<repo>/brand/` — a
  directory that does not exist — and the descriptor set was always empty. Every
  build shipped a slot that could not resolve: the admin bundle threw
  `brand slot is broken: no descriptor for the default brand "tollgate"` on
  import, so a distribution build shipped a branded PWA manifest and favicon with
  a UI that could not start. The pattern now resolves to `admin/brand/*.json`,
  and `tests/unit/brand-bundling.test.js` pins the contract (the bundled id set
  must equal the slot contents) so the failure cannot come back silently.
  Found by building a distribution overlay (descriptor + assets dropped into the
  slot, `VITE_BRAND=<id>`) and mechanically verifying the artifact.
  ([PR #54 follow-up](https://github.com/OpenTollGate/tollgate-captive-portal-site/pull/54))
- **OpenWrt admin setup:** the foreign-skin cleanup in
  `92-tollgate-admin-setup` can no longer delete the active brand's own webroot
  (or `/www`) when a malformed `__FOREIGN_SKINS__` token lists it — it now skips
  the resolved `$ADMIN_HOME` and anything outside `/www/*`. The guard also
  normalizes trailing slashes off a token's webroot (so `/www/tollgate/` cannot
  slip past the `$ADMIN_HOME` check) and refuses to `uci delete` the active
  `admin` uhttpd section.
