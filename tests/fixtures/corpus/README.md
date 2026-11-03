# Token conformance corpus fixtures

Canonical Cashu token fixtures vendored from the TollGate protocol
repo's conformance corpus
([OpenTollGate/tollgate `corpus/`](https://github.com/OpenTollGate/tollgate/tree/main/corpus),
v1, pull #30 @ `5368dd8`).

They pin the interop surface the portal decoder must handle — the
shapes from the v0.6.0 browser e-cash incident (portal#82,
PRTA#247, tmbg#952) and the known-good reference tokens minted by
cdk-cli 0.18.1 against a V2-keyset fakewallet:

| File | Shape | Expected portal verdict |
|---|---|---|
| `v4_v2_kg181.cashu` | known-good V4, V2 keyset, cdk 0.18.1 | accept |
| `v3_v2_kg181.cashu` | known-good V3, V2 keyset, cdk 0.18.1 (short id spelling) | accept |
| `v3_v2_full66.cashu` | V3 with the full 66-hex keyset-id spelling (wallet-side: Nutshell/cashu-ts) | accept |
| `v3_v2_valid.cashu` | V3 valid (proofs spent at capture mint) | accept (decode) |
| `v4_v2_valid.cashu` | V4 valid, 8-byte keyset-id prefix | accept (decode) |
| `v3_v2_truncated_id.cashu` | V3 with the native 16-hex short keyset-id spelling (the CU109 incident shape) | accept |
| `v3_v2_hex_c.cashu` | V3 whose C bytes are not a point (v0 corpus regen artifact; CU102 class) | accept decode, defer C verdict to the backend |

The portal is a *submitting* consumer: its decoder validates shape and
unit, then the merchant re-decodes and validates authoritatively on
POST / (HTTP-01). Spending-state and C-point verdicts live server-side
by design — which is exactly why the submit-path test pins that a
decode-passing token actually reaches `POST /` as a raw text/plain
body.

Resync when the corpus revs:

```sh
cp /path/to/tollgate/corpus/tokens/*.cashu tests/fixtures/corpus/
```
