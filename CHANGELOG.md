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

### Added
- **The router's own networks are operator settings: the private network's
  credentials, and which network may reach the board.** The Settings page gains
  two cards. *Private Network (management SSID)* carries `private_ssid`,
  `private_key` and `private_encryption` — the credentials the module's
  `99-tollgate-setup` minted and the encryption mode it rewrote on every full
  setup pass — and *Administration Access* carries `admin_access`
  (`both` | `br-private` | `br-mgmt` | `loopback-only`), which decides which
  network may reach the board on `:8090/:8443` and LuCI on `:8080/:443`. Both
  are the module's fields, set in `/etc/tollgate/config.json` and rendered from
  its schema; the board is a view of them, not a second store. Decision record:
  `tollgate-module-basic-go` `docs/architecture/lan-port-management-bridge-decision.md`
  (D9-D12).
  - **The passphrase is write-only in the UI too.** The schema marks it
    `secret`, so `config get` blanks it and reports `secret_set.private_key`
    instead; the card renders a password input, empty on every load — including
    after a reload — that says a value is *stored* rather than pretending the
    field is unset. The value the operator types is sent once (the module does
    not echo it either) and the field goes back to empty with the "set" label,
    so a later wholesale save cannot resend it and a page that is left open
    does not hold the management network's WPA key.
  - **The WiFi page stops being a second writer.** Editing a private radio
    there wrote one `wifi-iface` by raw `uci set`, which the module's applier
    now reverts at the next service start, and which let the 2.4 GHz and 5 GHz
    SSIDs drift apart. The edit goes through `tollgate config_set`
    (`private_ssid`, and `private_key` only when a password was typed), which is
    the one writer, applies immediately, and writes both radios. Which sections
    count as private is the module's contract (`wireless.private_radio0/1`,
    with an AP on the `private` network as the structural fallback, read from
    both the netifd `config`-nested status shape and the flat fallback), pinned
    in a shared helper with unit tests — not a string prefix at the call site.
  - **A half-applied private-radio save says so.** The passphrase is sent
    FIRST, so a value the module refuses (WPA2-PSK bounds) is refused before
    anything on the router changed; and if the SSID write is refused or fails
    after the passphrase applied, the board names the partial state — both
    radios carry the previous SSID with the NEW passphrase — instead of a bare
    "failed". The WiFi page also reads the module's `applied[]` replies now,
    so a refusal (which arrives with `success` still true) is no longer
    rendered as "saved to both private radios".
  - **A successful save says so.** The WiFi page's save message used to be
    rendered *inside* the edit form, which closes on success — so a successful
    save reported nothing at all while a failure reported in red; and the
    Settings page inferred its tone from the message prefix, so the module's
    `Set admin_access = …; runtime: 1 applied` came back as an error. Tone is
    now state on both pages, the message outlives the form, and the board
    surfaces what the module actually converged onto the router (including a
    `refused: …` scope, e.g. `br-mgmt` before the wired bridge exists).

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
