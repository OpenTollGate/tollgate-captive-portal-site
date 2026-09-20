# Admin board

The router admin dashboard, ported from
[`net4sats/configurationwizzard`](https://github.com/net4sats/configurationwizzard)
into this repo as a **second (Preact) app**, so the admin board and the guest
portal share one codebase and one release.

## Stack

- **Preact + TypeScript**, built with `@preact/preset-vite`.
- Served at the **root of a dedicated uhttpd instance on `:8090`** (webroot
  `/www/<brand>`; see `../openwrt/` +
  `../packaging/files/etc/uci-defaults/92-tollgate-admin-setup`). LuCI stays on
  `:8080`; the admin instance never exposes LuCI's `/www`.
- Talks to the router through **ubus** (`/ubus`) via the `tollgate` rpcd plugin
  (`../openwrt/rpcd/tollgate`), which maps 1:1 to `tollgate --json …` CLI
  commands. Auth is `session.login` with the router root password.

The React guest portal and balance page are unchanged and build separately.

## Brand

One build ships **one** skin (`src/brand.ts`), selected with `VITE_BRAND`:

| | TollGate (default) | net4sats |
|---|---|---|
| `VITE_BRAND` | `tollgate` | `net4sats` |
| webroot | `/www/tollgate` | `/www/net4sats` |
| domain | `tollgate.lan` | `net4sats.lan` |
| accent | `#FF6961` | `#111111` |

Both are served at the root of `:8090` (base `/`); the brand only selects the
webroot, manifest, and skin. Logos/icons live in `public/assets/brand/<brand>/`.

## Build

```bash
# both apps (portal+balance -> build/, admin -> build/admin/)
npm run build

# admin only
npm run build:admin
VITE_BRAND=net4sats npm run build:admin   # net4sats skin

# dev (mock ubus, no router needed)
npm run dev:admin
```

`scripts/build-all.mjs` generates a brand-correct `public/manifest.json` and
runs the portal build first (its `emptyOutDir` would otherwise wipe
`build/admin/`).

## Test

```bash
npm run test:admin   # Playwright, VITE_MOCK=true: auth gate + dashboard shell
npx tsc -p admin/tsconfig.json
```
