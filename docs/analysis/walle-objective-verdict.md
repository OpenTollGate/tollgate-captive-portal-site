# Standing verdict — `walle.cashu.me`

**Verdict: NOT VALIDATABLE.** The design must not depend on this host.

**What this file is.** The recorded answer of the standing ralph objective
`scripts/probe-walle-objective.mjs`. It is not a one-shot finding: the host may
come up, change, or be replaced, so the answer is re-measured rather than
remembered. When a ralph turn needs the current answer it runs the probe and
appends to the verdict log; when a *decision* needs the answer it reads the most
recent entry below.

**Re-measure with:**

```
npm run probe:walle                      # human-readable verdict, exit 0
npm run probe:walle -- --json            # one JSON object
npm run probe:walle -- --write <log>     # append the record to a verdict log
```

Exit code is 0 for every measured verdict, including `NOT_VALIDATABLE`. Only a
usage error exits 2 — so a loop can tell "the answer is still no" apart from
"the probe itself is broken".

Every completed run appends one JSON line to
`docs/analysis/walle-objective-history.jsonl` (`npm run probe:walle:log`). That
file is the durable answer history: the newest line is the current verdict, and
the older ones are what it used to be.

---

## Recorded result — 2026-11-02T14:59:17Z (probe v2)

| Field | Measured |
|---|---|
| verdict | `NOT_VALIDATABLE` |
| reason | the certificate does not chain to a trust anchor |
| strict TLS | `trusted=false`, `DEPTH_ZERO_SELF_SIGNED_CERT` |
| HTTP (strict) | none — the verified connection never completed |
| presented cert subject | `TRAEFIK DEFAULT CERT` |
| presented cert issuer | `TRAEFIK DEFAULT CERT` (self-signed) |
| cert validity | 2026-11-02 → 2027-11-02 |
| cert SAN | `DNS:9a6a21a2…d24b.93216a51…6f58.traefik.default` |
| `/` (unverified pass) | `404`, `text/plain`, `404 page not found` |
| `/manifest.json` (unverified pass) | `404`, `text/plain` |

Two independent facts, and both matter:

1. **The origin has no identity.** The certificate is Traefik's built-in
   default, self-signed, issued for an internal `*.traefik.default` name. That
   is what a reverse proxy serves when it has no certificate configured for the
   requested hostname — the host is routed, the service behind it is not.
2. **The origin serves nothing.** Every path answers a plain-text Traefik 404.
   There is no wallet UI, no manifest, no redirect to one.

A browser reaching this origin would show an interstitial and then a 404. It
cannot be a PWA, cannot be an install target, and cannot be embedded.

## What the probe does, and why it has two passes

**Pass 1 (strict)** — an ordinary verified TLS connection. Only this pass can
produce `VALIDATED`, because only this pass establishes the origin's identity.
`VALIDATED` additionally requires a 2xx on `/` and a wallet-shaped body; the
architecture is then extracted from that body (title, assets, manifest, stack,
and the shell signals the verdict rests on) rather than assumed.

**Pass 2 (unverified)** — runs only when pass 1 could not establish identity. It
records the certificate the host *offers* and the bodies it *returns*, over a
handshake that established nothing. The record labels this
`evidence_source: "unverified-handshake"`, nothing in it is trusted, and no
secret is ever sent on it. Without this pass the honest answer to "what does
`walle.cashu.me` serve?" would be "unmeasurable", which is exactly the false
premise this objective exists to kill: it would let the question be re-opened
later from an assumption. With it, the answer is a measured 404 from a default
Traefik cert.

`reachable` is deliberately narrower than "something answered": it is true only
when pass 1 verified identity *and* the origin responded. A self-signed 404 is
recorded, described, and still `reachable: false`.

The probe never follows redirects. A redirect is a fact about the origin that
the record has to keep; following it would let a different origin's content be
attributed to this one. A redirect is also not a validated wallet
(`body_shape: "redirect"`, verdict `NOT_VALIDATABLE`).

## Why this is the standing result

The operator brief for the client-side Cashu wallet said the PWA would carry
"something like `walle.cashu.me` internally". That sentence was never validated
against the host it names. Per `DOSSIER-portal-stack-decision.md`, cashu.me is
not a library and cannot be the wallet engine — it is a standalone MIT PWA whose
wallet store is ~12.8k lines across 35 Pinia stores — so "embed something like
walle.cashu.me" was already the wrong shape of requirement even before the host
turned out not to answer.

## Consequence for the design

- **Do not** treat "embed a walle.cashu.me-like wallet" as a design input. It
  is not a validated capability of anything we can reach.
- The wallet layer is chosen on its own evidence
  (`DOSSIER-portal-stack-decision.md`) — a few hundred lines on
  `@cashu/cashu-ts` 2.9.0, which the portal already depends on — with the
  channel rail gated behind the CDK/Spillman condition in
  `docs/pwa-client-wallet-plan.md` §5 Option C.
- If the host later answers with a trusted certificate and a real wallet UI, the
  probe flips to `VALIDATED` and reports the architecture it measured. Re-open
  the embedding question *then*, on that record — not from the brief.
