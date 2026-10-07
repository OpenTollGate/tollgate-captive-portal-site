# Admin board

The TollGate router admin dashboard, a **Preact + TypeScript app** living in
this repo as a second app alongside the React guest portal and balance page, so
the admin board and the guest portal share one codebase and one release.

## Stack

- **Preact + TypeScript**, built with `@preact/preset-vite`.
- Served at the **root of a dedicated uhttpd instance on `:8090`** (webroot
  `/www/<brand>`; see `../openwrt/` +
  `../packaging/files/etc/uci-defaults/92-tollgate-admin-setup`). LuCI stays on
  `:8080`; the admin instance never exposes LuCI's `/www`.
- Talks to the router through **ubus** (`/ubus`) via the `tollgate` rpcd plugin
  (`../openwrt/rpcd/tollgate`), which maps 1:1 to `tollgate --json …` CLI
  commands. Auth is `session.login` with the router root password.

The `tollgate` plugin maps each ubus method 1:1 to a tollgate CLI subcommand.
Besides the pre-auth `auth_status` probe (granted to the `unauthenticated` ACL
group), these reads exist: `config_schema`, `config_get`, `wallet_balance`,
`wallet_info`, `status`, `health`, `ui_links`, `upstream_scan`,
`upstream_list`.

### The cross-link to LuCI is a router answer

The header's link to the *other* admin UI (LuCI) comes from the `ui_links`
ubus method, on top of the tollgate CLI's `ui links` subcommand (JSON output).
It is never a constant and never the browser's own hostname plus a guessed
port: whether LuCI answers 8080/443 or 8090/8443 depends on the live mapping,
and an operator can flip it by setting `entry_ui` (see
`docs/architecture/default-ui-and-entry-port-decision.md`, D5/D6).

The board renders an anchor only when the router names an **HTTPS** url; when
the url is empty it renders **no button at all** and shows the router's
`reason` instead — a link that answers "connection refused" is exactly what D5
forbids. `ui_links` is in the authenticated `tollgate` read group, so the
cross-link appears once signed in.

The React guest portal and balance page are unchanged and build separately.

## Brand

One build ships **one** skin. Branding is resolved from the **brand slot**
(`brand/*.json` descriptors + `public/assets/brand/<id>/` logos) at build time
by `src/brand.ts` via `VITE_BRAND` — see `brand/README.md`. This repo ships the
generic default (`tollgate`); a distribution operator adds its own descriptor
and asset slot without forking the code:

| | Default |
|---|---|
| `VITE_BRAND` | `tollgate` |
| webroot | `/www/tollgate` |
| domain | `tollgate.lan` |
| accent | `#FF6961` |

Served at the root of `:8090` (base `/`); the brand selects webroot, manifest,
and skin. Logos/icons live in `public/assets/brand/<id>/`.

## Build

```bash
# both apps (portal+balance -> build/, admin -> build/admin/)
npm run build

# admin only
npm run build:admin
VITE_BRAND=tollgate npm run build:admin   # any bundled descriptor id

# dev (mock ubus, no router needed)
npm run dev:admin
```

`scripts/build-all.mjs` generates a brand-correct `admin/public/manifest.json`
and runs the portal build first (its `emptyOutDir` would otherwise wipe
`build/admin/`).

## Test

```bash
npm run test:admin   # Playwright, VITE_MOCK=true: auth gate + dashboard shell
npx tsc -p admin/tsconfig.json
```
