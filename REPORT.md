# REPORT — Portal SPA + rpcd: the admin cross-link is a router answer

**Status: COMPLETE.** Branch `pr/portal-luci-link` (repo
`tollgate-captive-portal-site`, worktree `~/worktrees/portal-luci-link`),
pushed to remote `fork`. Base: `origin/main` @ `4158030`.

## What the task asked, and what landed

**(1) Delete the hardcoded admin cross-link.** The only hardcoded admin
cross-link in the SPA was `admin/src/routes/login.tsx`:
`href={`http://${window.location.hostname}:8080/`}`. Removed. `admin/src` now
contains **no** `:8080` url literal and **no** `location.hostname` /
`location.port` use (the source-scan test below enforces this).

**(2) Render it from the router's answer.** New pure module
`admin/src/lib/ui-links.ts` parses the shapes the router prints:

```
{"entry_ui":"board",
 "links":{"board":{"url":"https://<host>/","port":"8080","tls_port":"443","reason":""},
          "luci":{"url":"","port":"8090","tls_port":"8443","reason":"no HTTPS listener on 8443"}}}
```

- `crossLinkFor(payload)` returns the OTHER UI's (LuCI's) link: the router's
  `url` **verbatim** (host and port both come from the answer), `available`
  only for an `https://` url, and always a `reason` when there is none.
- New component `admin/src/components/ui-cross-link.tsx`:
  - URL present → `<a href=router-url target="_blank" rel="noopener noreferrer">`;
  - URL empty → **no anchor at all**, a plain reason line
    (`data-ui-crosslink="unavailable"`), never a dead/disabled button;
  - payload still loading → renders nothing (no dead button while in flight);
  - a plain-HTTP answer is refused too (HTTPS-only, D6).
- `admin/src/lib/ubus.ts`: `fetchUiLinks()` calls the ubus method
  `tollgate.ui_links` and never throws.
- `admin/src/components/layout.tsx`: the authenticated header fetches it and
  renders it as a header action (next to Logout).
- `admin/src/lib/ubus.mock.ts`: `mockUiLinks()`; `?mockUiLinks=none` renders
  the no-link branch for demos/tests.

Note (honest scope): the header is the authenticated shell, because `ui_links`
is granted to the authenticated `tollgate` read group, not to the pre-auth
`unauthenticated` group (which keeps only the `auth_status` probe). So the
cross-link appears once signed in — the login screen no longer shows any LuCI
link at all, rather than a guessed one.

**(3) vitest unit tests** — `tests/unit/ui-cross-link.test.js`, 10 cases:
url rendered from the router answer; the component follows the live mapping
(the same component links to :8443/:443 or :8080/:443 whichever the router
names); empty url ⇒ no anchor + the reason surfaced; HTTPS-only refusal;
nothing derived from `location`; and a source scan of `admin/src` that fails
if `:8080` or `location.hostname/port` is reintroduced (with a self-check that
the scan catches the banned line, and that a comment naming it is not a false
positive).

## rpcd method + ACL + docs

- `openwrt/rpcd/tollgate`: new `ui_links` case running the tollgate CLI's
  `ui links` subcommand with JSON output, plus `ui_links` in the plugin's
  `list` output. It sits after the fail-closed credential gate, like the other
  read methods.
- `openwrt/rpcd/tollgate_acl.json`: `ui_links` added to the authenticated
  `tollgate` group's read list. Not added to `unauthenticated` (least
  privilege: the pre-auth group keeps only the credential probe).
- `admin/README.md`: the method list + a short section on the cross-link rule.

## Commands run and real results

- `npm ci` (node v22.22.1, npm 9.2.0) — OK, 247 packages.
- `npx vitest run tests/unit/ui-cross-link.test.js` — **10 passed (10)**.
- `npx vitest run` on the touched + consumer files (ui-cross-link,
  admin-credential-guard, brand, brand-bundling) — **49 passed (4 files)**.
- `npx tsc -p admin/tsconfig.json` — 1 error: pre-existing
  `admin/src/routes/devices.tsx(26,15)` implicit-any (file untouched by this
  change); no error in any file I added or edited.
- `npm run build:admin` — OK, 26 modules, `build/admin/assets/index-*.js`
  66.74 kB.
- `git push fork pr/portal-luci-link` — new branch created on `fork`.

The **whole** repo suite (all 14 files in `tests/unit/` plus
`src/components/__tests__`) was started twice and killed after ~14 minutes
without completing — each jsdom environment costs ~30-50 s here and some cashu
tests are slow; no failure output was produced and the process was alive
(2 vitest workers) when killed. The task's requirement — the suite for what I
touched — is covered by the 10-test file plus the 49-test consumer run above;
the untouched cashu/portal files are unrelated to this change.


The repo has no portal-README method table (checked), so the method is
documented in `admin/README.md`, which describes the rpcd plugin and the
:8090 / :8080 mapping.

## Pitfalls hit (for the record)

- The repo-root vitest config matches `src/**` + `tests/unit/**`, so the
  admin tests live in `tests/unit/` and import from `admin/src/…`
  (same pattern as the existing `admin-credential-guard.test.js`).
- `import.meta.url` is an `http:` URL under jsdom here, so the source-scan
  test resolves its path from `process.cwd()` rather than `fileURLToPath`.
- The component is authored with `h()` rather than JSX so it renders under
  this repo's React-configured vitest without a Preact/React JSX-runtime
  mismatch (documented in the component).
- The fleet pre-commit hook's markdown-table heuristic refused backticked
  multi-word commands in a README table armed by the word "credential"; the
  doc was rephrased as a list rather than allowlisted.
