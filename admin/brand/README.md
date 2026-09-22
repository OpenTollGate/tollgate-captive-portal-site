# Brand-descriptor slot

This repository is the *protocol* side of the TollGate admin UI (GPL-3.0). It
ships exactly **one** brand descriptor — the generic TollGate default — and
contains no vendor branding.

A distribution operator onboards **without forking this repo** by supplying its
own descriptor and logo assets at build time, from its own distribution
repository. Branding is config (env/assets), not a tree.

## Build-time contract

1. Drop `brand/<id>.json` — a full `BrandDescriptor` for that id — into this
   directory (or into a build overlay that provides it).
2. Add the logo/icon files under `public/assets/brand/<id>/`.
3. Build with `VITE_BRAND=<id>`.

The logo/icon paths are a *convention* derived from the id, so an overlay only
has to get its files into the slot; the descriptor itself carries no asset
paths:

```
public/assets/brand/<id>/logo-colour.png
public/assets/brand/<id>/logo-white.png
public/assets/brand/<id>/icon-colour.png
public/assets/brand/<id>/icon-white.png
```

`VITE_BRAND` is matched **case-insensitively** and an id is a narrow identifier
(`[a-z0-9][a-z0-9._-]*`): the id is normalized to lowercase before it is used as a
path component (`admin/brand/<id>.json`, `public/assets/brand/<id>/`), so
`VITE_BRAND=ACME` selects `brand/Acme.json`, and a path-ish value such as
`../../etc/passwd` is rejected (falls back — loudly — to the generic default).
An unknown id also falls back to the generic default, loudly.

## Descriptor fields

All fields are required and must be non-empty strings (see
`src/brand-core.ts`, which validates and resolves the slot):

| field | purpose |
|---|---|
| `id` | Brand id; must equal the descriptor file name (case-insensitively) and match the identifier alphabet `[a-z0-9][a-z0-9._-]*`. |
| `name` | Human-readable product name (window title, logo alt text). |
| `domain` | Gateway hostname shown in the UI. |
| `tagline` | One-line descriptor. |
| `poweredBy` | Attribution line in the footer. |
| `website` | Operator website URL. |
| `version` | Version string shown in the UI. |
| `themeColor` | PWA `theme_color` and `<meta name="theme-color">`. |
| `sessionKey` | `localStorage` key for the session token. |
| `sessionUser` | `localStorage` key for the session user. |

## GPL note

Env/assets/config only. Proprietary code diffs shipped in a branded build would
trigger GPL source disclosure, so all rendering logic stays generic here and in
the overlay.

This file deliberately never references any company name.
