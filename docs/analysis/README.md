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
