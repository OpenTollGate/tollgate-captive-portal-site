# Changelog

All notable changes to this project are documented here.

## [Unreleased]

### Security
- **Admin board: fail closed against a router with no root credential.** rpcd's
  login check (`rpc_login_test_password`, `session.c`) begins with
  `if (!hash || !*hash) return true;` and the distribution's `/etc/config/rpcd`
  sets the login password to `$p$root` — i.e. `getspnam("root")->sp_pwdp`. So
  while root's `/etc/shadow` hash is **unset**, `ubus session.login` returns a
  session for **any** password, including the empty string, and that session
  carries this board's ACL (`file:["exec"]`, `system:["password_set"]`,
  `tollgate wallet_drain_cashu`). A freshly deployed router that was never given
  a password was therefore unauthenticated root administration over plain HTTP
  from the guest side. Three layers now close it, and the credential STATE is
  the single predicate they all key off: `set` (a real hash) and `locked`
  (`!`/`*`, which `crypt()` can never match) are served and allowed; `empty` and
  `unknown` are not.
  - `packaging/files/etc/uci-defaults/92-tollgate-admin-setup` **does not
    configure the `:8090`/`:8443` listeners at all** while root has no usable
    credential, and removes them from a router that already served them, with
    the reason and the remedy (`passwd root`) printed to stderr.
  - `openwrt/rpcd/tollgate` refuses **every method that acts on the router**
    while the state is `empty`/`unknown` (`success:0`,
    `error:"no-admin-credential"`) and never invokes the `tollgate` CLI. The one
    exception is the new `auth_status` probe, which reports the state only —
    never a hash or a password.
  - `tollgate_acl.json` grows an `unauthenticated` group that grants a session-less
    caller **exactly** `["auth_status"]` (no write, no list), so the board can
    learn the state before it has a credential to sign in with.
  - The admin SPA asks for the state before it renders anything
    (`fetchCredentialStatus`): on `empty` it shows a refusal screen naming the
    remedy and offers **no form at all**; on `locked` it explains that no
    password can sign in; on `unknown` it warns and defers to the router-side
    refusal. `login()` and the submit button no longer accept a blank password —
    against an empty hash a blank one "succeeds", so it must never be sent.
  - CI: both packaging guards and the admin credential-guard e2e run as
    mandatory steps, so this cannot regress silently.
- **Admin board: the :8090 login is no longer a password field on a cleartext
  origin, and :8443 no longer serves a certificate nobody can validate.**
  `92-tollgate-admin-setup` pinned the board's own TLS listener to the OpenWrt
  image's certificate pair (`/etc/uhttpd.crt`, subject `CN=OpenWrt`,
  `SAN DNS:OpenWrt`) — a placeholder that satisfies every readable-and-non-empty
  check while covering neither the router's hostname nor its LAN IP — and it
  never redirected :8090 at all, so the board's login was typed over plain HTTP
  while its "secure" port answered a hard certificate error. That is the same
  defect class as the pre17 LuCI incident (module `#593`, portal `#64`), one
  surface over. Two halves, both derived, neither configured by hand:
  - the board's :8443 listener now carries the identity the **module**
    provisions for this router (`/etc/tollgate/ssl/server.{crt,key}`, written by
    `tollgate ssl apply` from `99-tollgate-setup`, whose SANs cover the
    hostname, the `<hostname>.lan` alias and the LAN IP). The image's pair stays
    only as a fallback **listener** identity, so a router that could not be
    provisioned keeps :8443 instead of losing it.
  - `uhttpd.admin.redirect_https` is a **derived** value evaluated through the
    same shared predicate as the LuCI hop (`tollgate ssl covers`, via
    `cert_covers_router`): :8090 is sent to the instance's own :8443 only while
    that listener's identity covers this router. It fails **closed** (an
    unusable CLI is "does not cover"), writes an explicit value in both
    directions so a stale `1` is repaired, and is turned back **off** if :8443
    never came up — a redirect into a dead port is a board nobody can open.
  - `packaging/tests/test-92-admin-board-tls.sh` pins all of it offline (stubbed
    `uci`/`tollgate`, 9 cases + a non-vacuity guard) and is wired into CI as a
    mandatory step. `openwrt/files/etc/config/uhttpd_admin` — the reference
    snapshot of the instance — is corrected with it: it had claimed a
    TLS-only :8090 that the script has never configured.

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
- **OpenWrt admin setup: the LuCI `:8080` → HTTPS redirect is now derived from a
  covering certificate, not from a certificate merely existing.** `uhttpd.main.redirect_https`
  is a derived value written by two scripts — this repo's `92-tollgate-admin-setup`
  and the module's `99-tollgate-setup` — and the install order differs by path
  (the module's postinst runs `90, 99, 92`, so `92` lands last there; numeric
  uci-defaults order at boot is `90, 92, 99`, so `99` lands last there). This
  script kept the older premise: a readable, non-empty cert/key pair plus a
  configured listener. That premise accepts the **OpenWrt image's placeholder
  certificate** (subject `CN=OpenWrt`, `SAN DNS:OpenWrt`, 561 bytes), which
  covers neither the router's hostname nor its LAN IP — so on a router whose TLS
  identity does not cover it, the last writer armed `307 → https://<lan-ip>/` and
  every admin login began with a hard certificate error (measured on the bench
  MT3000, pre17, 2026-09-26). Condition 1 (a listener must be configured) is kept
  from the 2026-09-21 pre13 fix; condition 2 is new: the identity must **cover**
  this router, delegated to the module's own check (`tollgate ssl covers`, so the
  shell, the Go side and a browser cannot disagree about what a usable identity
  is) and **failing closed** when that CLI is unusable. The value is still written
  explicitly in both directions, so a stale `1` from an earlier install is
  repaired rather than kept.
- **Packaging guard for that value (`packaging/tests/test-redirect-https-single-rule.sh`,
  new):** fails if either writer carries a premise of its own instead of deriving
  the value through the shared coverage check — the class of defect that produced
  both the pre13 LuCI lockout and the pre17 certificate error. It reads this
  repo's shipped script and the module's (`MODULE_SCRIPT`/`MODULE_DIR`, or a
  shallow fetch of the module repo; strict in CI), asserts the shared predicate,
  the fail-closed CLI gate, the explicit write in both directions and the absence
  of the image's fixed placeholder path, and carries a negative control (the
  superseded existence-only rule) that the same checker must reject. The
  `test-92-luci-redirect-guard.sh` harness gains the coverage cases, including the
  defect state itself (a stale `1` with a non-covering identity must be repaired
  to `0`) and the same negative control. Both are wired into CI.
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
