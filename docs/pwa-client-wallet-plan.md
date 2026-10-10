# PWA + client-side Cashu wallet — implementation plan

**Status:** Proposed (2026-10-10). Documentation only — **do not implement until
after the current release** (`v0.6.0-rc1`), per operator instruction. This file
records the gap analysis and the agreed direction so the work can start from a
fixed baseline.

**Related:** `OpenTollGate/tollgate-module-basic-go`
`docs/architecture/session-ticket-decision.md` (the session-ticket ADR and its
R1–R6 amendment). That document already frames "small frequent granular
payments" and names **Spillman Cashu channels** (`cdk-spilman`, `MONAD`) as the
intended payment rail. This plan is subordinate to it.

---

## 1. Motivation

A client-side wallet that keeps ecash locally and pays the tollgate in small,
frequent amounts would (a) bound the loss if the tollgate disconnects, and (b)
avoid buying a large chunk of internet up front. This document assesses turning
the captive portal into a Progressive Web App carrying such a wallet.

## 2. Current state (portal `main`, as measured)

| Area | State | Evidence |
|---|---|---|
| Framework | React 18 + Vite 7 SPA | `package.json` |
| Installable | `public/manifest.json` (`display: standalone`) linked from `index.html` | but no icons beyond a favicon |
| Service worker | **none** | no `workbox` / `vite-plugin-pwa` / `navigator.serviceWorker` |
| Offline / persistence | **none** | no `localStorage` / `sessionStorage` / IndexedDB |
| Cashu library | `@cashu/cashu-ts` **2.9.0** already a dependency | `package.json` |
| Cashu usage | **decode-only** (`getTokenMetadata` / `getDecodedToken`); no `CashuWallet` / `CashuMint`, no mint calls, no proof store | `src/helpers/cashu.js` |
| Balance | `BalancePage` derives a balance **from a supplied token**, not from a stored wallet | `src/helpers/balance.js`, `src/components/BalancePage.jsx` |
| Payment | **one-shot**: a signed Nostr **kind-21000** event carrying the whole token is POSTed to `http://<gateway>:2121/`; the merchant redeems the entire token via a swap and auths the MAC in nodogsplash until a timestamp (`price_per_step` × `step_size`) | `src/helpers/cashu.js`; module `src/merchant/merchant.go` |
| Lightning | portal lane historically a placeholder; module `main` now has `POST /ln-invoice` | `src/helpers/lightning.js` (verify the shipped bundle drives the real lane) |
| Router API | `GET /balance`, `/usage`, `/session-state`, `POST /ln-invoice`, session tickets exist on module `main` | module `src/main.go` |

## 3. Goal / non-goals

**Goal:** an installable, offline-capable portal shell plus a UX that makes
small, frequent purchases natural and bounds loss on disconnect.

**Non-goals (explicitly rejected here, per the ADR):**
- a router-side per-address record of owed value (ADR **R2/R6**);
- ecash refunds (ADR "Refunds considered and not adopted");
- automatic MAC-rotation handling (ADR **R3**).

## 4. Gap analysis

| Proposed capability | Gap today | Effort |
|---|---|---|
| PWA app shell (offline UI, install) | no service worker, no caching strategy | **Low** — add `vite-plugin-pwa` (or a hand-written SW) + manifest icons |
| Client-held ecash balance | no `CashuWallet`, no persisted proofs | **Medium** — wallet + IndexedDB store + NUT-09 restore |
| Frequent small payments to the gate | backend accepts a full token per kind-21000 event; per-step `ln-invoice` path only | **High** — needs a channel/streaming rail (see below) |
| Loss-bounded on disconnect | no mechanism | the channel close is the mechanism (ADR) |

## 5. Design options

**Option A — PWA shell only (near-term, low risk).**
Ship the service worker + offline app shell on the existing per-purchase token
flow. No protocol change, no funds held client-side. Makes the portal feel like
an app and survives flaky connectivity for the UI. **Recommended first step.**

**Option B — `cashu-ts` wallet as a UX layer (medium).**
Instantiate `CashuWallet`/`CashuMint`, persist proofs in IndexedDB, allow
hold/restore and per-step buys. This is a **UX** improvement, not the
loss-bounding mechanism: a bearer wallet in a browser over a captive HTTP
network is a theft/durability target (XSS, shared device, storage eviction), so
it must not be presented as "your money is safe here".

**Option C — Spillman channels (the real rail, per the ADR).**
One funding transaction carries unlimited signed balance updates, so small,
frequent payments stop costing a mint round-trip each; closing the channel
returns the client's change to the client's own outputs at the mint, so the
router never holds owed value. This is the architecturally correct answer to
"buy only what is needed; lose little on disconnect."
**Gate (from the ADR): the wallet must run on CDK and a channel-capable client
wallet must exist.** Track it; do not bolt a bespoke drip protocol on in the
meantime.

## 6. Phased plan (execution begins after the release)

1. **PWA shell** — `vite-plugin-pwa`, manifest icons, offline splash/balance.
   Portal-only; no protocol change. Verify offline reload on a phone.
2. **Client wallet (Option B)** — `cashu-ts` `CashuWallet` + IndexedDB; restore
   on load; show held balance distinctly from session allowance; keep all
   router interactions on the existing socket-resolved identity.
3. **Channel rail (Option C)** — align with the module ADR; implement channel
   open/update/close against `cdk-spilman`, with the ADR's R4–R6 constraints
   (one channel per purchase/address; MAC-blind journal; never resume across
   rotation).

## 7. Constraints (must hold for every phase)

- ADR **R1**: entitlement is session-scoped; nothing carries across addresses.
- ADR **R2/R6**: never create or log a record naming two customer addresses; no
  durable per-address owed-value store.
- ADR **R3**: no auto-rebind without an explicit customer action and disclosure.
- The portal must never treat a `403` / unknown-ticket as "no session".
- The router's socket-resolved buyer identity is unchanged by any client wallet.

## 8. Risks

- Browser-stored ecash theft/durability; mitigate by framing the wallet as
  convenience, not custody, and by preferring channels (whose close returns change).
- Service-worker caching of a captive-portal app can serve a stale shell across
  releases — version the SW and force an update on `splash.html`.
- IndexedDB eviction on constrained mobile browsers — design for zero client
  balance as a valid state.

## 9. Open questions

- Is a client-held balance desirable at all before channels land, given it is
  explicitly *not* the loss-bounding mechanism?
- Where do SW updates get versioned relative to the feed's portal pin?
- Confirm the shipped bundle currently drives the real Lightning lane.
