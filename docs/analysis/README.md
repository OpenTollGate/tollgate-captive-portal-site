# Working analysis dossiers for the PWA client-wallet ADR delta

These files are the **cited working dossiers** behind
[`docs/architecture/pwa-client-wallet-adr-delta.md`](../architecture/pwa-client-wallet-adr-delta.md),
the authoritative ADR delta for the PWA client-side Cashu wallet workstream. They are
reproduced here verbatim so that every `[D:…]` / `[SB §…]` citation in the delta resolves
for a reader of the PR; before they were added, those citations pointed at material that
existed only on one operator's machine.

**These are working documents, not polished documentation.** They are evidence-first recon
notes produced by delegated agents under a read-only rule, and they are published here
**as written** — no editorial pass, no retcon of anything a later measurement corrected (a
dossier's occasional overstatement is deliberately left visible, and the delta's own
`§9 Corrections` and `§5.6.4` corrections are where the record is brought up to date).

**They were produced at specific pinned SHAs, and their conclusions are only valid for
those tips.** Each dossier names its pins in its own header or §1; the load-bearing ones
are: `OpenTollGate/tollgate-captive-portal-site` @ `c2ddba1218a653c0ef09d7857495e580d8865aff`,
`OpenTollGate/tollgate-module-basic-go` @ `cf7cad34677e87e775e7f16786b1bbf18c4bc8bc`,
`cashubtc/cashu.me` @ `e21f5fab875b67de0fc5367a79710054d2c1f80f`,
`cashubtc/cashu-ts` @ `145d2426d5071f2c321a6ec1171a5ce1c1ea0466` (dev, `5.0.0-rc.11`) and
`cashubtc/coco` @ `03d5896caf39625aa70d57d1a5ad404a66bf7e16`. Re-verify against the tip
before acting on any of them; several of their open questions are carried forward as open
questions in the delta's `§11`.

**They carry explicit uncertainty labels, and those labels are the point.** Anything the
analysis could not confirm is marked rather than omitted: `UNMEASURED`, `[unverified]`,
`UNVERIFIED`, `UNREACHABLE: <reason>`, `must-verify-on-device`, and ranked
`spec / ships in browser X / UNSUPPORTED` tags. **A claim in these files that carries one of
those labels is not a fact and must not be quoted as one.** Where a dossier and the ADR
delta disagree, the delta — and above all its closing **APPENDIX — Operator decision log** —
is authoritative.

| File | What it is |
|---|---|
| `SPIKE-secure-context.md` | The secure-context measurement (no SW / no install / no `crypto.subtle` on a plain-HTTP LAN origin) and the workaround space. |
| `SPIKE-background-execution.md` | What background autonomy is actually available (Background Sync, Periodic Background Sync, Web Push) and where it is blocked. |
| `SPIKE-secret-storage.md` | Device-local / file-system secret storage options, ranked, with the eviction semantics of each. |
| `DOSSIER-portal-stack-decision.md` | React + `cashu-ts` vs React + `coco` vs a Vue/Quasar port — the measured trade. |
| `DOSSIER-module.md` | The Go module's payment / session / incremental-billing surface. |
| `DOSSIER-portal.md` | The portal SPA: PWA, persistence, payment state, build+test harness. |
| `DOSSIER-wallet-libs.md` | Cashu wallet libraries for an embedded, auto-paying PWA wallet. |
| `DOSSIER-test-rails.md` | Available test rails (host, emulator, serial-attached router) and exactly which are reachable. |
| `DOSSIER-vendor-origin-and-selfsigned.md` | The **vendor-origin** dossier: whether a self-signed credential can produce a PWA (it cannot — secure context YES, service worker NO, measured after a real interstitial click-through), the per-platform trust stores, the public-CA-for-a-LAN-IP dead end, and the **Local Network Access** finding that is the real crux of an `https` PWA calling the router's `http://<gw>:2121`. Cited from the delta as `[D:origin §N]` (see delta `§3.6`, `§3.4 (d)`, `§11(1)`). Its raw tool output is reproduced beside it as **`EVIDENCE-vendor-origin-and-selfsigned.md`** — the verbatim rig transcript (§E1–§E7) behind every `[measured]` claim in the dossier and in the delta's `§3.6`, shipped here so a **reviewer can check those claims directly** rather than take them on trust. |

**Note on the rig description in this dossier and in its evidence file.**
`DOSSIER-vendor-origin-and-selfsigned.md` §0.2 exists so
that every `[measured]` number in it is reproducible, and it therefore names the test rig's addresses
— a private LAN `192.168.2.20`, the loopback control, and a **global IPv6 address on the authoring
host** used deliberately to create a genuine public→private address-space transition on one box. It
also uses `~/…` and `~/.cache/…` paths. **The same addresses appear in
`EVIDENCE-vendor-origin-and-selfsigned.md`, which is the verbatim transcript of that rig and is
published here for exactly the same reason** — it is the raw output a reviewer needs to check the
delta's `[measured]` claims, and it is not independently redacted. **These are bench addresses and
local paths, not credentials** — no key, token, seed, mnemonic or password appears in either file
(the estate's Caddy `CF_API_TOKEN` appears only as an **env-var reference**, `${env.CF_API_TOKEN}`),
and the scan covers both files. Treated as
publication-safe working documents, consistent with the other dossiers in this directory, which
likewise publish LAN addresses and absolute host paths. The `23.182.128.*` / `66.92.204.38`
addresses in the evidence file are **public service endpoints of the sites that were measured**
(e.g. the live `orangesync.tech` probes in §E5), not of this estate's private infrastructure. The
IPs are **not** locations of any private
key; do not treat a copied rig table as an inventory of running services.
