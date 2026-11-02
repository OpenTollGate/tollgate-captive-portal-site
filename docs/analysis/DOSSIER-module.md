# DOSSIER — TollGate Go module: payment + session + incremental-billing surface

**Purpose:** fresh primary-source recon for **client-side incremental / metered payment**
(a PWA holds Cashu ecash, tops up in small amounts frequently, and the user may roam to
another AP or rotate their MAC without losing significant money).

**Method:** read-only clone, no tracked file modified, nothing pushed.
Every claim below is traceable to a command actually run against the tip.

---

## 1. Repo / tip identity

| Field | Value |
|---|---|
| Repo | `https://github.com/OpenTollGate/tollgate-module-basic-go` |
| Branch | `main` (default; `origin/HEAD -> origin/main`) |
| **Tip SHA read** | `cf7cad34677e87e775e7f16786b1bbf18c4bc8bc` |
| Commit date | `2026-10-14 12:43:17 +0200` |
| Clone | `git clone --depth 1` → `~/repos/tmbg-recon` (shallow: `git log` shows `(grafted)`) |
| `VERSION` | `v0.6.0-rc4` |
| Go toolchain used | `go1.26.0 linux/amd64` |
| Build sanity | `cd src && go vet ./...` → exit 0; `go build ./...` → exit 0 |

Commands:
```
cd ~/repos/tmbg-recon && git rev-parse HEAD            # cf7cad34677e87e775e7f16786b1bbf18c4bc8bc
cd ~/repos/tmbg-recon && git show -s --format='%H %ci' # cf7cad3... 2026-10-14 12:43:17 +0200
cd ~/repos/tmbg-recon/src && go vet ./... ; go build ./...
```

### Module layout — `src/` is a **multi-module tree**, root is a de-facto empty module

`src/go.mod` is the served binary's module; **19 `go.mod` files** exist in the tree:

```
./go.mod  ./src/go.mod  ./src/merchant/go.mod  ./src/tollwallet/go.mod  ./src/valve/go.mod
./src/lightning/go.mod  ./src/config_manager/go.mod  ./src/cli/go.mod  ./src/cmd/tollgate-cli/go.mod
./src/identity/go.mod  ./src/merchant_types/go.mod  ./src/sysexec/go.mod
./src/tollgate_protocol/go.mod  ./src/upstream_detector/go.mod
./src/upstream_session_manager/go.mod  ./src/utils/go.mod  ./src/wireless_gateway_manager/go.mod
./scripts/token-recovery/go.mod  ./research/bearer-port-demo/go.mod
```
(`find . -name go.mod -not -path './.git/*' | wc -l` → 19)

**Pitfall confirmed in practice:** building from the repo root is a no-op —
`go build ./...` at the root prints `go: warning: "./..." matched no packages`
and exits 0. You must run Go tooling from `src/` (and the canonical gate is
`make go-battery` per `Makefile:6-7`, "src/ is a multi-module tree: `go ... ./...`
from src/ alone covers only the root module"). Expect **16** modules per `Makefile`
(19 files include the two `research/`,`scripts/` ones).

Module paths (from `go.mod` line 1 of each):
- `github.com/OpenTollGate/tollgate-module-basic-go` (root, `go 1.24.2`)
- `github.com/OpenTollGate/tollgate-module-basic-go/src` (`go 1.26.0`)
- `.../src/merchant`, `.../src/tollwallet`, `.../src/valve`, `.../src/config_manager`,
  `.../src/upstream_session_manager`, `.../src/merchant_types`, …

Serving files:
- `src/main.go` — HTTP surface on `:2121` (`apiListenAddr = ":2121"`, `src/main.go:424`).
- `src/merchant/merchant.go`, `lightning.go`, `session_ticket.go`, `owed_grant.go`,
  `receive_intent.go`, `quote_store.go` — payment/session.
- `src/valve/valve.go`, `customer_data_tracker.go`, `nds_clients.go` — enforcement/metering.
- `src/tollwallet/` — the Cashu wallet seam.

Wallet library pinned **identically in every carrier** (`AGENTS.md` rule):
`github.com/OpenTollGate/gonuts-tollgate v0.13.0` (`src/merchant/go.mod:6`,
`src/tollwallet/go.mod:6`, `src/go.mod:42` indirect).

---

## 2. Payment HTTP surface

Routes are bound in `registerAPIHandlers` (`src/main.go:1800`) and
`registerIdentityRoutes` (`src/main.go:1841`, called at `src/main.go:1831`).

> **Identity rule (applies to EVERY client-scoped route below):** the client MAC
> comes from **the socket**, resolved by `clientMACFromSocket` (`src/main.go:850`)
> = source IP → `dnsmasq` lease file `/tmp/dhcp.leases` then `/proc/net/arp`
> (`getMacAddress`, `src/main.go:934`; var seams at `src/main.go:794-797`).
> A `mac` query parameter or body field is **never** honoured: it is a *claim*.
> Single entry point `clientIdentity(w, r, bodyClaim)` (`src/main.go:928`) sets
> response headers `X-TollGate-Client-MAC` (socket-resolved) and
> `X-TollGate-Mac-Claim-Ignored` (asserted-but-ignored), consts at
> `src/main.go:894-897`, recorded by `reportClientIdentity` (`src/main.go:908`).
> Unresolvable identity ⇒ `device-unresolved` refusal (`src/main.go:812-817`,
> `isUnknownMAC` at `src/main.go:823`; sentinel `00:00:00:00:00:00`).

### 2.1 `POST /` — Cashu ecash acceptance (the money route)

| | |
|---|---|
| Method/path | `POST /` (GET `/` = advertisement) |
| Route | `src/main.go:1801-1804`: `RateLimitMiddleware(CorsMiddleware(requireStarted(HandleRoot)))` |
| Dispatch | `HandleRoot` `src/main.go:1216` → `HandleRootPost` `src/main.go:1060` |
| Request body | `text/plain` **or** `application/json` (else 415, `src/main.go:1072-1078`). Body capped 1 MiB (`http.MaxBytesReader(w, r.Body, 1<<20)`, `src/main.go:1103`). Plain text = the bare Cashu token. JSON = a **kind-21000 Nostr event** whose `payment` tag value is the token (`extractCashuToken`, `src/main.go:1045-1057`). **No `mac` field is read.** |
| Response 200 | signed **kind-1022 session event** JSON: tags `p` (customer pubkey = the MAC string), `device-identifier` = `["mac", <MAC>]`, `allotment`, `metric`, `start-time` (`createSessionEvent`, `src/merchant/merchant.go:2114`, tags at `:2136-2142`) |
| Response 400 | **kind-21023 notice event** JSON when `responseEvent.Kind == 21023` (`src/main.go:1157-1160`); codes catalogued in `docs/merchant.md:139-155` |
| Identity | **socket** (`clientIdentity(w, r, "")`, `src/main.go:1092`) — refused *before* the token is read |
| Rate limit | per-IP 10 rpm default, `TOLLGATE_RATE_LIMIT_RPM` override (`src/main.go:43-61`) |

### 2.2 `GET|POST /ln-invoice` — Lightning invoice creation + status poll

| | |
|---|---|
| Route | `src/main.go:1811-1814`: `CorsMiddleware(requireStarted(handleLNInvoiceRoute))` |
| Split | `handleLNInvoiceRoute` `src/main.go:1599` — POST gets `quoteCreateQuotaMiddleware` (`:356`, called `:1604`); GET gets **no** quota on purpose (it is the customer's poll loop, `:1601-1603`) |
| POST handler | `handleLightningInvoicePost` `src/main.go:1610` |
| POST body | `lightningInvoiceRequest` `src/main.go:1224-1234`: `amount` (uint64), `mint_url`, `mint` (fallback), `mac` (**decoded but deliberately ignored**, comment `:1228-1233`). Body capped 8 KiB (`maxLightningInvoiceBodyBytes = 8 << 10`, `src/main.go:85`). `amount` ceiling `maxLightningInvoiceSats = 1_000_000` (`src/main.go:89`, checked `:1639`) |
| POST identity | `clientIdentity(w, r, req.Mac)` `src/main.go:1653` — **socket**; body `mac` reported ignored |
| POST response | `lightningInvoiceResponse` `src/main.go:1236-1254`: `status`, `quote`, `invoice`, `mint_url`, `amount`, `expiry`, `state`, `access_granted`, `allotment`(omitempty), `metric`(omitempty), `error`, `code`, `retry_after` |
| Refusal codes | `codeQuoteRateLimited`/`quote-table-full`/`mint-busy-local`/`request-too-large`/`amount-too-large`/`access-grant-failed` (`src/main.go:94-108`) |
| GET handler | `handleLightningInvoiceGet` `src/main.go:1709`; query `quote`; identity **socket** (`clientIdentity`, `:1725`) — the MAC is an *authorisation check* (only the device that created the quote may read it, `:1719-1722`) |
| GET response | same struct; `state` forced to `ISSUED` when `SessionGranted` (`src/merchant/lightning.go:377-379`) |

### 2.3 `GET /usage` — the customer's own meter

`src/main.go:1821-1824` → `HandleUsage` `src/main.go:1189` → `Merchant.GetUsage`
(`src/merchant/merchant.go:596`). Identity from socket (`:1195`).
Answer is the **bare string** `used/allotment` (`:1212-1213`), or **`-1/-1`** when
unidentified or no session. For `bytes` it is the full session ledger
`Consumed + attachmentUsage` (`:607-616`); for `milliseconds` it is
`(now-StartTime)*1000 / Allotment` (`:618-622`).

### 2.4 `GET /balance` — JSON usage/session snapshot

`src/main.go:1816-1819` → `HandleBalance` `src/main.go:1510`. Socket identity (`:1520`).
Body `balanceResponse` `src/main.go:1256-1271`: `status`, `session_active`, `metric`,
`usage`, `allotment`, `remaining`, `start_time`, `mac`. `remaining = allotment - used`
(`:1565-1568`). `-1/-1` ⇒ `session_active:false` (`:1541-1546`).

### 2.5 `GET /session-state` — lifecycle tri-state (renewal affordance)

`src/main.go:1826-1829` → `HandleSessionState` `src/main.go:1291`. Socket identity
(`:1300`). Body `sessionStateResponse` `src/main.go:1276-1281`: `state ∈ {none,active,expired}`
(`SessionState` consts `src/merchant/merchant.go:69-81`; `GetSessionState`
`src/merchant/merchant.go:2474`). **This is what lets a portal distinguish a
first-time visitor from a customer whose session just ran out** (`:1283-1290`).

### 2.6 `GET|POST /whoami`

`src/main.go:1806-1809` → `handler` `src/main.go:1012`. Plain text `mac=<MAC>`
(from socket; answers empty mac rather than 500, `:1017-1024`). **Not** gated by
`requireStarted` on purpose (`:1798-1799`).

### 2.7 `POST /session/ticket` and `POST /session/rebind` — MAC-rotation continuity

Registered in `registerIdentityRoutes` at `src/main.go:1849-1857`, **unconditionally**
(the `/identity*` routes below them at `:1876`/`:1882` are the conditional ones).
Handlers: `HandleSessionTicket` `src/main.go:1372`, `HandleSessionRebind` `src/main.go:1423`.

- Ticket request: no body. Identity from socket via `clientMACFromSocket` (`:1378`).
  Response `sessionTicketResponse` `src/main.go:1333-1339`: `status`,`ticket`,`expires_at`,
  `code`,`error`. Refusals: `device-unresolved` (400), `no-session` (404), `ticket-unavailable` (500).
- Rebind request: `sessionRebindRequest` `src/main.go:1345-1347` = `{"ticket":"..."}`
  (8 KiB cap, `:1441`). **The target address is the socket, never a claim** (`:1341-1344`).
  Response `sessionRebindResponse` `src/main.go:1352-1358`: `status`,`mac`,`usage`,`code`,`error`.
  Refusals: `attachment-active` (**409**), `ticket-invalid` (**403** — malformed/signature/
  unknown/expired all collapse here), `rebind-failed` (500) — `src/main.go:1450-1477`.

### 2.8 Everything else

`/identity` and `/identity/reveal-seed` (`src/main.go:1876`, `:1882`) are identity
*derivation* only (npub/IPv4/MACs/BIP39 from the merchant key) and are disabled when
`identities.json` has no usable key (`src/main.go:1869-1875`). No payment role.

---

## 3. The purchase / allotment semantic — ONE-SHOT ALL-OR-NOTHING

`PurchaseSession` — `src/merchant/merchant.go:1493` (interface method
`MerchantInterface` at `src/merchant/merchant.go:353`; degraded stub
`src/merchant/merchant_degraded.go:174`; startup stub `src/startup_gate.go`).

Sequence, all `file:line`-verified:

1. `NormalizeMACAddress` + `utils.ValidateMACAddress` → `invalid-mac-address` (`:1494-1504`).
2. `m.tollwallet.DecodeToken(cashuToken)` → `payment-error-invalid-token` (`:1507-1515`).
3. **Swap-fee pre-check** `swapFeeSatsBounded` (`src/merchant/merchant.go:1842`, budgeted
   in a goroutine with `swapFeePrecheckBudget`) → `payment-error-below-swap-fee` (`:1522-1533`).
4. **NDS pre-flight** — `!m.sessionIsRenewal(mac) && !m.clientRegisteredForGate(mac)`
   → `client-not-registered` (`:1554-1561`).
5. **Concurrent-duplicate guard** `beginReceive(reference)` keyed on
   `receiveReference(token) = utils.TokenFingerprint(serialized)` → `payment-duplicate-inflight`
   (`:1573-1582`; `receiveInFlight` map `src/merchant/merchant.go:382`).
6. **Durable receive-intent journal** `beginReceiveIntent(...)` → `payment-outcome-unknown` /
   `payment-received-grant-pending` for a known reference (`:1590-1629`; `receive_intent.go`).
7. **The irreversible call**: `m.tollwallet.Receive(paymentCashuToken)` in a goroutine,
   `select` against `m.receiveTimeout` (`defaultReceiveTimeout = 30 * time.Second`,
   `src/merchant/merchant.go:221`) → on timeout `payment-outcome-unknown` (`:1631-1696`).
8. Error classification → codes (`:1697-1773`): `payment-error-token-spent`,
   `mint-rate-limited`, `payment-error-below-swap-fee`, `payment-error-keyset-expired`,
   `payment-error-mint-unreachable`, `payment-processing-failed`.
9. **`allotment, err := m.calculateAllotment(amountAfterSwap, mintURL)`** (`:1779`).
10. `m.grantSessionAccess(macAddress, allotment)` (`:1790`) — on failure
    `recordOwedGrant(...)` + `resolveReceiveIntent(..., intentStateOwed, ...)` and the
    customer gets `payment-received-grant-pending` (`:1791-1808`).
11. `m.createSessionEvent(session, macAddress)` → kind-1022 (`:1814`).

### `calculateAllotment` — the ONE allotment number, and where it comes from

`src/merchant/merchant.go:2056`:
```
steps := amountSats / mintConfig.PricePerStep        // :2074
if steps < mintConfig.MinPurchaseSteps { …error }    // :2077-2079
switch m.config.Metric {
case "milliseconds": return m.calculateAllotmentMs(steps)     // :2083 → steps * m.config.StepSize
case "bytes":        return m.calculateAllotmentBytes(steps)  // :2085 → steps * m.config.StepSize
}
```
- `mintConfig` found by `tollwallet.MintURLMatches(mint.URL, mintURL)` over
  `m.config.AcceptedMints` (`:2058-2068`); `PricePerStep == 0` is a hard error (`:2070-2072`).
- `calculateAllotmentMs` `src/merchant/merchant.go:2092`; `calculateAllotmentBytes` `:2103`.
- Config fields: `Config.Metric` (`src/config_manager/config_manager_config.go:23`),
  `Config.StepSize` (`:21`), `MintConfig.PricePerStep` (`:82`), `MintConfig.PricePerUnit`
  (`:83`), `MintConfig.MinPurchaseSteps` (`:84`).
- Shipped defaults (`src/config_manager/config_manager_config.go:424`):
  `StepSize: 22020096 // 21 MiB`, `Metric: "bytes"`. Mint defaults set
  `PricePerStep: 1`, `MinPurchaseSteps: 1` (`:305-357`).

**Unit = bytes** by default (`Allotment` is *bytes* under the `bytes` metric, and
*milliseconds* under `milliseconds` — `CustomerSession.Allotment`,
`src/merchant/merchant.go:31`). **The allotment is a single number granted once per
HTTP request; there is no partial/deferred/rolling grant.**

### The grant itself

`grantSessionAccess` `src/merchant/lightning.go:731`:
```
previousSession, hadSession := m.snapshotSession(macAddress)     // :734 (merchant.go:2518)
session, err := m.AddAllotment(macAddress, m.config.Metric, allotment)  // :736
if err := openGateForSession(macAddress, session); err != nil {
    m.restoreSession(macAddress, previousSession, hadSession)    // :742 (merchant.go:2532) — ROLLBACK
    return nil, err
}
```
`openGateForSession` `src/merchant/lightning.go:749`: `milliseconds` →
`valve.OpenGateUntil(mac, StartTime + Allotment/1000)` (`:752-755`);
`bytes` → `valve.OpenGate(mac)` (`:757-763`, auth is idempotent).

`AddAllotment` `src/merchant/merchant.go:2615` creates or **adds to** the session and
**resets `StartTime = now`** on the renewal branch (`:2644-2645`). Note the pre-existing
guard: a `milliseconds` record whose time is already spent is retired first
(`:2622-2625`, `sessionHasExpired` `:105`).

**All-or-nothing, exactly:** the token is Received once, the whole value converts to one
allotment, the whole allotment is added, and the gate is opened/armed once. There is no
"credit an account" step and no per-request partial acceptance.

---

## 4. Session state model

### Where sessions live: **process memory only** (plus the NDS client list, externally)

```go
type Merchant struct {
    customerSessions  map[string]*CustomerSession   // src/merchant/merchant.go:367
    expiredSessions   map[string]int64              // :368
    sessionMu         sync.RWMutex                  // :369
    ...
}
// initialised at src/merchant/merchant.go:549-550
customerSessions:   make(map[string]*CustomerSession),
expiredSessions:    make(map[string]int64),
```

```go
type CustomerSession struct {          // src/merchant/merchant.go:27-62
    MacAddress string
    StartTime  int64                   // Unix seconds
    Metric     string                  // "milliseconds" | "bytes"
    Allotment  uint64                  // bytes or ms
    Consumed   uint64                  // ledger carried in from left attachments (rebind)
    attachmentUsage uint64             // unexported: highest reading of CURRENT attachment
    ticketHandle    string             // unexported: session-ticket handle
    ticketExpiresAt int64              // unexported: ticket horizon
}
```
Key = MAC address, always `NormalizeMACAddress`d. A **second, parallel** in-memory map
holds the byte metering baselines:

```go
dataBaselines      = make(map[string]*DataBaseline)   // src/valve/customer_data_tracker.go:31
dataBaselinesMutex = &sync.RWMutex{}                  // :32
type DataBaseline struct { Downloaded, Uploaded uint64; Timestamp time.Time }  // :23-27
```

`expiredSessions` is a "hint, not a ledger" expiry memory: TTL 24 h
(`sessionHistoryTTL`, `src/merchant/merchant.go:95`), cap 4096
(`sessionHistoryMaxEntries`, `:99`), written by `rememberExpiredSessionLocked`
(`:165`) so `/session-state` can keep answering `expired`.

### On process restart

**Everything client-facing is lost**, and this is *documented, deliberate, and loud*:

- Session records, expiry history, ticket signing key + attachment map — all memory.
  The ticket key is drawn from `crypto/rand` at startup and written nowhere
  (`src/merchant/session_ticket.go:36-45`), so **every ticket is invalid after a restart**
  (`ErrTicketSignature` lands in the `ticket-invalid` 403 branch, `src/main.go:1461-1470`).
- The byte-baseline map is memory, so the meter restarts.
- Recovery is a **startup reconciliation that CLOSES gates**:
  `ReconcileNdsAuthorisationsOnStartup` (`src/merchant/startup_reconciliation.go:76`,
  called from `src/merchant/merchant.go:647`) enumerates NDS-authorised clients
  (`valve.AuthorisedClients`, `src/valve/nds_clients.go:173`) and, for any MAC the module
  has no session/gate record for, calls `valve.CloseGate` (`:99`). Its own log says it:
  *"a module restart loses every session (they are process-local) while NoDogSplash keeps its
  client list … The customer's remaining allotment does NOT travel across a restart
  (it lived in the process that died), so it is not silently kept: the client must buy again"*
  (`src/merchant/startup_reconciliation.go:106-108`).
- `AGENTS.md` names this explicitly as a **known gap**: *"Process-memory state is not
  authoritative. `customerSessions`, gate deauth timers, and data baselines live only in
  memory; Lightning quotes are persisted deliberately (`quote_store.go`) because payment
  recognition must survive restart. … today it is not, which is a known gap: restart loses
  session metering."*

### Durable ledger precedents that DO exist (the templates to copy)

All four are written **atomically** (temp file + `fsync` + rename + parent-dir sync) into
`filepath.Dir(configManager.ConfigFilePath)` (i.e. `/etc/tollgate`), 0600:

| Store | File | Built at | Writer |
|---|---|---|---|
| Lightning quotes | `quotes.json` | `src/merchant/merchant.go:551` (`newQuoteStore`) | `quote_store.go` (`persistedQuote` `:15-27`) |
| Owed entitlements (#403) | `owed-grants.json` | `src/merchant/merchant.go:553` | `owed_grant.go` (`persistedOwedGrant` `:52-` , `recordOwedGrant` `:188`, `loadOwedGrantsFromDisk` `:388`) |
| **Receive-intent journal (#502)** | **`receive-intents.json`** | `src/merchant/merchant.go:555` | `receive_intent.go` (`persistedReceiveIntent` `:57-68`, `beginReceiveIntent` `:161`, `reconcileReceiveIntent` `:247`) |
| Drain journal (CLI) | `wallet-drain-journal.jsonl` | `src/cli/drain_journal.go:31-40` | append-only + `fsync` per entry |

`receive-intents.json` is the closest precedent for a per-payment durable record:
states are `pending | granted | owed | abandoned` (`src/merchant/receive_intent.go:49-54`),
it stores the **serialized bearer token** so post-restart NUT-07 checkstate is possible
(`:22-31`), and its loaders are invoked at construction
(`loadLightningQuotesFromDisk`/`loadOwedGrantsFromDisk`/`loadReceiveIntentsFromDisk`,
`src/merchant/merchant.go:558-560`). Note that **none of them store a session allotment**
— the durable layer covers *money recognition*, not *entitlement*. There is **no
`allocations.json` / ledger of granted-and-consumed allotment anywhere in the tree.**

---

## 5. Incremental hooks that ALREADY exist

### 5.1 `checkDataUsage` — the 2-second sweep

`src/merchant/merchant.go:710`. Started by `StartDataUsageMonitoring`
(`src/merchant/merchant.go:644`) which arms `time.NewTicker(2 * time.Second)` (`:667`)
and calls `checkDataUsage` per tick (`:672`). Per sweep it:
1. snapshots every **bytes** session under `RLock` (`:711-718`) and runs
   `enforceBytesSession` on each (`:720-722`);
2. runs one `reconcileSweep()` (stale-binding janitor, `:730`);
3. runs `ndsClientReconcileSweep()` (`:739`) — closes NDS authorisations the module
   holds no record for.

**This is a live 0.5 Hz enforcement clock already wired end-to-end.** Anything that
wants to enforce a watermark every tick has a ticker to hang off.

### 5.2 `enforceBytesSession` — the per-session step (the watermark candidate)

`src/merchant/merchant.go:881`. Logic:
```
if !valve.HasDataBaseline(mac) { m.establishBaseline(mac); return }        // :884-887
usage, attachmentUsage, err := m.sessionBytesUsage(mac, session)          // :889
   (ErrDataBaselineMissing → establishBaseline; other err → closeUnmeterableSession)
m.noteAttachmentUsage(mac, attachmentUsage)                               // :901
if usage < session.Allotment { return }                                   // :904  ← THE COMPARISON
valve.CloseGate(mac)                                                      // :926
m.expireSessionLocked(mac)                                                // :938 (only after a CONFIRMED close)
```
`sessionBytesUsage` `src/merchant/merchant.go:955`: `session.Consumed + max(live, attachmentUsage)`.
Grace/retry machinery: `usageMonitorGraceSweeps = 30` (`:748`, ≈60 s),
`usageMonitorBaselineRetryDelay = 2s` (`:753`),
`closeUnmeterableSession` `:1018`, `closeRetryStateClause` `:866`.

**The enforcement decision is literally one comparison at `src/merchant/merchant.go:904`
(`usage < session.Allotment`).** A "paid-through watermark" gate is a different
right-hand side at exactly that line plus a different `OpenGate*` call — but see §6/§8
for what else has to change.

### 5.3 `openGateForSession` — the milliseconds timer path

`src/merchant/lightning.go:749`: `OpenGateUntil(mac, StartTime + Allotment/1000)`.
`OpenGateUntil` (`src/valve/valve.go:1034`) extends an existing timer via an epoch guard
(`expireTimedGate` `src/valve/valve.go:1009`; `markGateOpenedLocked` `:851`;
`nextGateEpochLocked` `:865`). Indefinite gates are stored as `openGates[mac] = nil`
(`src/valve/valve.go:1168`). So for `milliseconds`, **extension by a later purchase is
already supported** at the valve layer.

### 5.4 MAC-rotation identity continuity — session tickets + rebind

`POST /session/ticket` → `IssueSessionTicket` (`src/merchant/session_ticket.go:270`):
requires an existing, unexpired session (`ErrTicketNoSession`, `:290-292`); mints an
opaque 16-byte random handle (`newTicketHandle` `:217`) and records
`ticketHandle`/`ticketExpiresAt` on the session (`:300`, `:320`). TTL **12 h**
(`defaultSessionTicketTTL`, `:51`). Store capped at 4096 attachments (`:56`), swept
(`sweepLocked` `:227`).

`POST /session/rebind` → `RebindSession` (`src/merchant/session_ticket.go:376`). Its
three stated invariants:
1. **carry the meter** — `carried = session.Consumed + max(attachmentUsage, live reading)`
   ("a rotation must never be able to walk the meter backwards", `:441-453`);
2. **`StartTime` is COPIED, never recomputed** ("a rebind is not a renewal", `:455-467`);
3. **refused while the old attachment is still authenticated** — `ErrAttachmentActive`
   (`:406-421`).
Then move-before-break: record moves (`:469-470`), new baseline set (`:488-493`),
`openGateForSession` on the new address with **rollback on failure** (`:500-511`),
and only then `valve.CloseGate(previous)` (`:519`).

`ticketState` (`src/merchant/session_ticket.go:183`) holds `signer *ticketSigner`,
`attachments map[string]*sessionAttachment` (`sessionAttachment` `:103-109`), lazily
created by `ticketState()` (`:194`). Signing key is memory-only (`:111-114`).

**Read this before designing anything here:** `docs/architecture/session-ticket-decision.md`
is **`Status: Proposed (2026-09-24) — carry-over held`**, and its **Amendment R1-R6**
(`:305-395`) is the *governing* text: **R1** "the address is session-scoped … Nothing
carries across addresses: no meter ledger, no `StartTime`, no session record, no credit";
**R2** "no join, in state or in logs … No log line or log field may pair an old and a new
address"; **R3** "no automatic rotation handling". The ADR's stated reason is that **MAC
rotation between purchases is the product's privacy primitive**, and the sanctioned answer
to "roam without losing money" is *"small, granular purchases bound the loss from a
rotation mid-purchase"* plus the customer's own `GET /usage` counter as their detection
surface (`:340-346`). **The code shipped at this tip implements the ticket/rebind carry-over
the ADR holds**, so code and doctrine are currently out of step — worth confirming with the
maintainer before building on either.

### 5.5 Metered/watermark endpoint — **DOES NOT EXIST**

`grep -rn -i 'watermark|topup|top-up|recharge|voucher|credit' --include='*.go' src/`
returns no metered-top-up endpoint. The only `watermark` hits are
`quoteTableEvictionWatermark` (`src/merchant/lightning.go:67`), unrelated.
There is **no** `/topup`, `/redeem`, `/metered`, `/credit` or partial-payment route.

### 5.6 Reseller-side precedent (the closest thing to incremental payment in-tree)

`src/upstream_session_manager/` already implements **"renew before empty"**:
`UpstreamUsageTracker.checkRenewal` (`upstream_usage_tracker.go:229`) polls
`http://<gw>:2121/usage` every tick (`poll` `:112`, `fetchUpstreamUsage` `:181`),
computes `remaining := allotment - usage` and fires a renewal callback when usage crosses
the **renewal offset** (`session.go:249 HandleRenewal`, offsets
`MillisecondRenewalOffset`/`BytesRenewalOffset`, preferred increments
`PreferredSessionIncrements*`, clamped to ≤ half the allotment, `:270-287`; issue #430).
This is a *client-side* pattern that keeps a session topped up in the field — the shape
a PWA would mirror, but it lives on the router-as-buyer, not on the router-as-seller.

---

## 6. Enforcement path — the single ndsctl seam

**One process, one binary name, one seam var:**

```go
var runNdsctl = func(args ...string) (string, error) {   // src/valve/valve.go:243
    return runNdsctlCommand(args...)
}
// src/valve/valve.go:270 — the ONLY exec of ndsctl
cmd := exec.CommandContext(ctx, "ndsctl", args...)
```
(`grep -rn 'exec.Command' --include='*.go' src/ | grep -v _test` confirms the only
`ndsctl` exec in the tree is `src/valve/valve.go:270`; the only other hits are
`sysexec/runner.go:32` and unrelated OpenWrt tooling.)

Call sites (all `src/valve/*`):
| call | line | purpose |
|---|---|---|
| `runNdsctl("auth", mac)` | `src/valve/valve.go:520` | open/authorise (`authorizeMAC` `:516`, bounded retry `authMaxAttempts`) |
| `runNdsctl("deauth", mac)` | `src/valve/valve.go:612` | close (`closeGateConfirmed`; `ndsctlUnknownClient` `:587`) |
| `runNdsctl("json", mac)` | `src/valve/valve.go:1275` (`GetClientStats` `:1268`) and `:1375` (`CheckClientState` `:1369`) | meter read / read-only identity probe |
| `runNdsctl("json")` | `src/valve/nds_clients.go:95` | whole client list (`AuthorisedClients` `:173`) |

Deadline/serialisation discipline: `ndsctlTimeout = 5s` (`src/valve/valve.go:23`),
`ndsctlMutex` (serialises every invocation), stop-drain `ndsctlStopDrain = 3s` (`:99`),
typed interruption errors `ErrNdsctlTimeout`/`ErrNdsctlStopped` (`:116`,`:121`) with
`ndsctlInterruptionOf` (`:177`). Public valve API: `OpenGate` (`:1120`),
`OpenGateUntil` (`:1034`), `CloseGate` (`:1181`), `ReconcileGateClose`,
`TrackedGates` (`:1353`), `GateCloseFailures`, `Stop`/`AuthorisedClients`.

### Can enforcement gate on a "paid-through watermark" every tick?

**Structurally yes, and the seam is already there** — `checkDataUsage` runs every 2 s
(`src/merchant/merchant.go:667`), and the enforcement branch is a single comparison
(`:904`) that ends in `valve.CloseGate` (`:926`). A watermark rule replaces
`if usage < session.Allotment { return }` with `if now < session.PaidThrough { return }`
(or keeps the byte form and compares against a *granted* total that grows). No new
syscall, no new process, no new socket: it is the same `authorizeMAC`/closed-gate pair.

**But `ndsctl` gives you only two primitive states — auth/deauth — with no in-kernel
budget.** The module is *not* enforcing in the data plane: nodogsplash holds an
**authorised MAC** until the module deauthorises it, and nodogsplash's own `sessiontimeout`
is the only independent backstop. Concretely:
- `bytes` currently = *poll the counter, compare, deauth*. A watermark is the same
  poll-and-compare with a different threshold. **Cheap.**
- `milliseconds` currently = *arm a timer in the module* (`OpenGateUntil`). A watermark
  means either a much shorter timer (re-arm every granule) or moving the check into the
  2 s sweep. **Cheap.**
- **The real constraint is not ndsctl, it is that a deauth due to an exhausted watermark
  takes the customer offline while the client still holds unspent ecash** — and, per
  `AGENTS.md`/`startup_reconciliation.go`, the entitlement does not survive a process
  restart. So a metered design must decide what the watermark's expiry *means* before it
  changes the comparison at `:904`.

---

## 7. Cashu wallet internals

### Which library

**`github.com/OpenTollGate/gonuts-tollgate v0.13.0`** — the OpenTollGate fork of
`elnosh/gonuts` (upstream dead since v0.4.2, 2025). Pin is **one version across every
carrier** (`src/merchant/go.mod:6`, `src/tollwallet/go.mod:6`, `src/go.mod:42`;
`packaging/build-inputs.json` `.gonuts.version` is the single source of truth per
`AGENTS.md`, enforced by `tests/contract/check-gonuts-pin.py`).

**A second backend exists behind a build tag** — `src/tollwallet/cdk_wallet.go:1`
`//go:build cdk_wallet`, importing `github.com/cashubtc/cdk-go/bindings/cdkffi`
(CGO). The default build (`!cdk_wallet`) uses gonuts.

**The seam is `WalletPort`** (`src/tollwallet/port.go`), with three implementers:
| backend | file | kind |
|---|---|---|
| gonuts (default) | `gonuts_wallet.go` (267 L) + `tollwallet.go` (733 L) | in-process |
| cdk | `cdk_wallet.go` (478 L, `-tags cdk_wallet`) | in-process, CGO |
| sidecar | `sidecar.go` (416 L) | AF_UNIX newline-delimited JSON to a wallet daemon |

Backend selection is **data, not code**: `src/tollwallet/manifests/{gonuts,cdk,nucula}.json`
+ `wallet-policy.json`, loaded by `LoadPolicy`/`SelectBackend`
(`src/tollwallet/policy.go`), capability manifest `src/tollwallet/manifest.go`
(`StorageInfo`, `ContractInfo{NUT07,NUT09,Restore,CGO}`).

Key interface methods (`src/tollwallet/port.go`): `DecodeToken` (V3 `cashuA` / V4-CBOR
`cashuB`), `Receive`, `GetBalance`, `GetBalanceByMint`, `GetAllMintBalances`, `Send`,
`SendWithOverpayment`, `Drain`, `MeltToLightning`, `RequestMintQuote`,
`GetMintQuoteState`, `MintTokens`, `RequestMeltQuote`, `Melt`, `SwapFeeSats`,
**`CheckTokenSpent(token) (bool, error)`** (`src/tollwallet/port.go:256`), `Shutdown`.

### NUT support (actual numbers, code-level)

`ls ~/go/pkg/mod/github.com/\!open\!toll\!gate/gonuts-tollgate@v0.13.0/cashu/nuts/` →
**`nut01 nut02 nut03 nut04 nut05 nut06 nut07 nut09 nut10 nut11 nut12 nut13 nut14
nut15 nut17 nut20`** (16 packages; no nut08/nut16/nut18/nut19).
Imported by the wallet/cashu/p2pk packages (verified by grep across the fork's
`wallet/`, `cashu/`, `p2pk/`): the same set of 16.

Per-method mapping is documented in-tree at
`docs/architecture/walletport-contract.md:22-40` ("NUTs implied" column):
NUT-00 tokens (+V4), 01/02 keysets+fees, 03 swap, 04 mint quote, 05 melt,
**07 checkstate**, 08 fees, 10/11 spending conditions/P2PK, **12 DLEQ**, 13 deterministic
secrets, 14 LNURL/HTLC, 20 quote signatures, 23 (quotes in the manifest claim).

In the **TollGate** tree itself the spec-quoted NUTs are fewer — a real coverage gap:
```
$ grep -rhoE '// NUT #?[0-9]{2}' --include='*.go' src/ | sort | uniq -c
  3 // NUT #04   3 // NUT #00   2 // NUT #05   1 // NUT #03
```
and only three nut packages are imported directly from the router's own code:
```
$ grep -rhoE 'gonuts-tollgate/cashu/nuts/nut[0-9]+' --include='*.go' src/ | sort -u
gonuts-tollgate/cashu/nuts/nut04
gonuts-tollgate/cashu/nuts/nut07
gonuts-tollgate/cashu/nuts/nut10
```
(The quote-comment machinery is `specquotes.toml` + `greatspectations`; the NUT spec
clone it points at is not vendored, so `spectate coverage` cannot run offline here.)

### DLEQ / swap / mint reachability

- **DLEQ (NUT-12):** no first-party DLEQ code in the router tree
  (`grep -rn -i 'dleq' --include='*.go' src/` → **zero hits**); verification lives in the
  fork (`.../cashu/nuts/nut12/nut12.go:155` `crypto.VerifyDLEQ(e, s, A, B_, C_)`,
  `:188`, `ParseDLEQ` `:192`). The router relies on the wallet's `Receive` for it.
- **Spent-state / swap-safety is string-matched at the boundary:**
  `isAlreadySpentError` (`src/tollwallet/tollwallet.go:512`) matches `"already been spent"`
  / `"already spent"` and wraps into the sentinel `ErrTokenAlreadySpent`
  (`Receive` `src/tollwallet/tollwallet.go:293-337`). Ambiguity is a *separate* typed path:
  `client.AmbiguousOutcomeError` ⇒ `ErrOutcomeUnknown` (`:333-336`).
  `ErrCheckStateUnsupported` (`src/tollwallet/tollwallet.go:32`) covers backends with no
  NUT-07 surface.
- **NUT-07 checkstate is implemented only on the gonuts default path**
  (`TollWallet.CheckTokenSpent`, `src/tollwallet/tollwallet.go:672`, using
  `gonuts-tollgate/cashu/nuts/nut07`). The **cdk adapter refuses**
  (`cdk_wallet.go:473-477`, returns `ErrCheckStateUnsupported`) and the **sidecar
  protocol does not carry it yet** (`sidecar.go:410-415`). Verified read-only methods over
  the sidecar are whitelisted at `sidecar.go:37-45`.
  This matters for incremental payment: **the ambiguity-reconciliation path degrades on
  any non-gonuts backend.**
- **Mint reachability** is tracked by `MintHealthTracker` (`MarkUnreachable` called in
  `PurchaseSession`, `src/merchant/merchant.go:1724`) feeding
  `tracker.GetAdvertisedMintConfigs()` used by `CreateAdvertisement`
  (`src/merchant/merchant.go:1989`). Outbound budget toward each mint:
  `mintQuoteBudget` (`src/merchant/lightning.go:293-…`, env `TOLLGATE_MINT_QUOTE_RPS`,
  `TOLLGATE_MINT_QUOTE_BURST`), refusal `ErrMintBusyLocal` (`lightning.go:164-166`).
  Quote table caps: `maxActiveQuotesPerMAC = 3`, `maxActiveQuotesGlobal = 128`
  (`src/merchant/lightning.go:63-64`), eviction watermark 80% (`:67`).
- **Swap fee** is pre-checked with a deadline (`swapFeeSatsBounded`,
  `src/merchant/merchant.go:1842`); `SwapFeeSats` is *not implemented* by the cdk adapter
  (`src/tollwallet/cdk_wallet.go:144-148`) — the merchant then falls through to
  error classification.
- **Mint URL canonicalisation** is mandatory at every persistence boundary
  (`normalizeMintURL`/`tollwallet.NormalizeMintURL`, applied e.g.
  `src/merchant/lightning.go:136`).

---

## 8. Gap list — what must change for CLIENT-HELD INCREMENTAL PAYMENT

Sizes are rough order-of-magnitude engineering effort (S ≈ <1 day, M ≈ days,
L ≈ week+ with tests and a router bench pass). "Separate PR" = should land as its own
reviewable unit.

1. **A durable entitlement ledger keyed to a client, holding granted + consumed.**
   Today `CustomerSession` is memory (`src/merchant/merchant.go:367`) and the four durable
   stores (`quotes.json`, `owed-grants.json`, `receive-intents.json`, drain journal)
   cover *money*, never *allotment*. Incremental payment is unusable across a restart
   without it. Model on `receive_intent.go` (atomic temp+fsync+rename, 0600).
   **L, separate PR.** *Blocked on a product decision:* the ticket ADR's R2 forbids a
   durable per-address record (see §5.4).
2. **A top-up endpoint that ADDS to an existing entitlement instead of re-granting.**
   `AddAllotment` (`src/merchant/merchant.go:2615`) already adds, but it **resets
   `StartTime = now`** (`:2644-2645`) and `grantSessionAccess` opens/arms the gate afresh;
   nothing exposes "add N bytes to a live session without restarting its clock" over HTTP.
   Needs a new route (or a mode on `POST /`) plus an explicit non-refundable-boundary
   contract. **M, separate PR.**
3. **A "paid-through watermark" enforcement rule** replacing/parametrising the single
   comparison `if usage < session.Allotment { return }` (`src/merchant/merchant.go:904`)
   and the milliseconds timer arming (`src/merchant/lightning.go:752`). Must define what
   expiry-with-unspent-ecash means, and interact with `closeUnmeterableSession` (`:1018`)
   and the stale-binding janitor (`:1246`; cadence `defaultStaleBindingReconcileEvery = 15`
   at `:1092`, grace `defaultStaleBindingGracePasses = 2` at `:1098`).
   **M, separate PR** (the mechanism) — but see the *product* gate in
   item 1.
4. **Client-side MAC/identity continuity that survives roaming between APs.** A rebind
   only works against the *same* router (it reads `m.customerSessions[previous]`,
   `src/merchant/session_ticket.go:425`) and the ticket is signature-invalid after any
   restart (`session_ticket.go:36-45`; `src/main.go:1461-1470`). Cross-router roaming is
   **out of scope entirely** — nothing in this module federates a session to a peer
   router (the reseller path buys *upstream access*, it does not carry a customer grant).
   **L, needs its own design doc.**
5. **A stable client-side identity the module will accept.** Everything is keyed on the
   socket-resolved MAC (`src/main.go:850`, `src/merchant/merchant.go:367`). A PWA cannot
   present a MAC; any client-supplied identifier is today explicitly *ignored*
   (`src/main.go:866-897`). A metered PWA needs either (a) accept a signed, mint-independent
   client key as a session key — a security-surface change to `clientIdentity` — or
   (b) require the client to present a session ticket on every top-up. **L, separate PR,
   security review required.**
6. **Per-note amortised request budget.** Incremental = many small requests, each of
   which today costs a full `POST /` → `Receive` → mint swap. Limits that bite:
   `maxActiveQuotesPerMAC = 3` / `maxActiveQuotesGlobal = 128`
   (`src/merchant/lightning.go:63-64`), `mintQuoteBudget` RPS (`:293`), per-IP 10 rpm
   (`src/main.go:43-61`), `quoteCreateQuotaMiddleware` (`src/main.go:356`). Small granular
   payments are exactly what these were sized against. **M, separate PR** (the whole point
   of incremental payment is *not* one invoice per granule — see the Spillman note in
   `docs/architecture/session-ticket-decision.md:371-395`).
7. **`milliseconds` sessions do not participate in the byte sweep and are excluded from
   the stale-binding janitor** (comment `src/merchant/merchant.go:1209`, filter
   `:1219-1221`): their gate is bounded only by the in-process timer. A metered time
   product needs the same watchdog coverage bytes has. **S, can ride with item 3.**
8. **The `-1/-1` / `session-state` contract is the only client-visible progress signal,
   and it is process-local.** A metered PWA polling frequently needs (a) a *remaining
   budget* the server will not disown on restart and (b) an explicit "your credit ends at
   X" answer. `/balance` already returns `remaining` (`src/main.go:1565-1581`) but reads
   it from memory. **S once item 1 exists.**
9. **Test coverage for the new surface.** `grep -rn 'session/ticket|session/rebind' tests/`
   → **zero hits**: the whole ticket/rebind surface is unit-tested only. A metered flow
   needs the `tests/cloud-lab/conformance/` lane (`run-conformance.sh`,
   `test_conformance.py`) extended — that lane is where the #535/#639 double-grant
   concurrency case is proven. **M, must accompany items 2-3.**
10. **Documentation/ADR reconciliation.** The governing ADR (`session-ticket-decision.md`,
    R1-R3) currently forbids the carry-over the code implements. Any incremental design
    must either cite an accepted amendment or rest on the ADR's own sanctioned answer
    ("small, granular purchases bound the loss from a rotation mid-purchase", `:342-346`).
    **S, but a hard prerequisite for review.**

---

## 9. DO-NOT-PORT / known-broken list

1. **No `ndsctl` seam other than `src/valve/valve.go:243`/`:270`.** Do not add a second
   `exec.Command("ndsctl", …)`. Every invocation must go through `runNdsctl` so the
   `ndsctlMutex` serialisation, the 5 s `ndsctlTimeout` deadline, the stop-drain and the
   typed interruption reporting (`ndsctlInterruptionOf`, `src/valve/valve.go:177`) apply.
2. **Do not resurrect the `mac`-as-identity path.** `clientMACFromSocket`
   (`src/main.go:850`) deliberately ignores the query parameter *and* the body field;
   `clientIdentity` (`:928`) is the only entry point. The comments at
   `src/main.go:837-849` document the exact attack (a client naming another device's
   session/meter/quote) that this closed.
3. **Do not honour `00:00:00:00:00:00`.** `sentinelMACAddress` (`src/main.go:805`) is not
   an identity; it collapsed all unidentifiable clients into one shared session/meter/quote
   and charged customers for devices that did not exist.
4. **Dead code — do not port, do not "fix", do not assume it works.**
   `extendSessionEvent` (`src/merchant/merchant.go:2156`),
   `extractPaymentToken` (`:2036`), `extractDeviceIdentifier` (`:2046`),
   `extractAllotment` (`:2244`) and the type `PurchaseSessionResult` (`:1486`) have
   **zero call sites outside their own definitions** (verified by repo-wide grep — the
   only other hits are the internal call at `:2158` and the definitions themselves). They
   look like a half-removed incremental-session feature; treat as rubble, not precedent.
5. **Do not treat NUT-07 checkstate as universally available.** `CheckTokenSpent` works on
   gonuts only (`src/tollwallet/tollwallet.go:672`); the cdk adapter and the sidecar
   protocol return `ErrCheckStateUnsupported` (`cdk_wallet.go:477`, `sidecar.go:415`).
   Any reconciliation logic must degrade explicitly, not assume an answer.
6. **Do not assume `SwapFeeSats` exists on every backend** — the cdk adapter errors out
   (`src/tollwallet/cdk_wallet.go:144-148`).
7. **Do not reuse deterministic Cashu derivation ranges.** `AGENTS.md` hard rule: once
   `[counter, counter+n)` has been exposed to a mint it must never be derived again
   (error 10002 "Duplicate outputs"; incidents #257, #266, #480). Counter ranges must be
   persisted *before* the exposing network call.
8. **Do not retry an ambiguous swap/melt, and do not treat a timeout as failure.**
   `ErrOutcomeUnknown` (`src/tollwallet/tollwallet.go:335`) exists for exactly this;
   the merchant tells the customer "do not resend" and records a quotable reference
   (`src/merchant/merchant.go:1687-1695`, `:1739-1744`).
9. **Do not make a `Receive` before the local validations.** `AGENTS.md` rule #4: decode,
   spending-condition check, swap-fee pre-check and MAC/NDS pre-flight all run *before*
   `Receive` for a reason (#403, #409). Order at `src/merchant/merchant.go:1507→1554→1640`.
10. **Do not retire a session on an unconfirmed gate close.** `CloseGate`
    (`src/valve/valve.go:1181`) errors mean *the gate may still be open*;
    `expireSessionLocked`/`retireSessionOrParkForTicketLocked`
    (`src/merchant/merchant.go:119`, `:150`) must run only after a confirmed close
    (`src/merchant/merchant.go:921-939`, `closeRetryStateClause` `:866`). Retiring early
    is documented as how a customer kept free unmetered internet (C1-2b).
11. **Do not add bytes-metric state without the baseline.** `SetDataBaseline`
    (`src/valve/customer_data_tracker.go:45`) must always record *something*; a bytes
    session with no baseline is unmeterable and its gate stays open
    (`GetDataUsageSinceBaseline` `:92`, `ErrDataBaselineMissing` `:20`).
12. **Do not read `attachmentUsage` outside `sessionMu`.** `GetSession` clones *inside* the
    read lock (`src/merchant/merchant.go:2430-2446`) because the 2 s monitor writes that
    field in place, and on 32-bit mips/mipsel a torn `uint64` read is a real misread.
13. **The ticket surface is `Status: Proposed — held`.** `session_ticket.go` implements
    carry-over that `docs/architecture/session-ticket-decision.md`'s Amendment R1-R3
    forbids. Do not build a payment design on it without a maintainer decision.
14. **Do not run Go tooling from the repo root** — `go build ./...` there matches no
    packages and exits 0 (a silent green). Use `src/` or `make go-battery`
    (`Makefile:6-7`).
15. **`research/bearer-port-demo/`** is a standalone 15-test spike
    (`docs/architecture/bearer-instrument-port.md`), not part of the shipping build; its
    NUT-07/NUT-09 "rule plus test" framing is a design argument, not implemented state.

---

## Appendix — command log used for this dossier

```
git clone --depth 1 https://github.com/OpenTollGate/tollgate-module-basic-go.git ~/repos/tmbg-recon
cd ~/repos/tmbg-recon && git rev-parse HEAD && git log -1 --format='%H | %ci | %s'
cd ~/repos/tmbg-recon && find . -name go.mod -not -path './.git/*' | sort
cd ~/repos/tmbg-recon/src && go vet ./... && go build ./...
cd ~/repos/tmbg-recon && grep -n 'HandleFunc(' --include='*.go' src/
cd ~/repos/tmbg-recon && grep -rn 'exec.Command' --include='*.go' src/ | grep -v _test
cd ~/repos/tmbg-recon && grep -rn 'runNdsctl(' --include='*.go' src/valve/
cd ~/repos/tmbg-recon && grep -n 'func (m \*Merchant) PurchaseSession' -A 330 src/merchant/merchant.go
cd ~/repos/tmbg-recon && grep -n 'func (m \*Merchant) calculateAllotment' -A 50 src/merchant/merchant.go
cd ~/repos/tmbg-recon && grep -n 'func (m \*Merchant) grantSessionAccess' -A 70 src/merchant/lightning.go
cd ~/repos/tmbg-recon && grep -n 'customerSessions ' src/merchant/*.go
cd ~/repos/tmbg-recon && grep -rn 'owed-grants|receive-intents|quotes.json' --include='*.go' src/
cd ~/repos/tmbg-recon && grep -rn 'GetDataUsageSinceBaseline|SetDataBaseline|ClearDataBaseline' --include='*.go' src/
cd ~/repos/tmbg-recon && grep -rn 'extendSessionEvent|extractPaymentToken|extractDeviceIdentifier' --include='*.go' .
ls ~/go/pkg/mod/github.com/\!open\!toll\!gate/gonuts-tollgate@v0.13.0/cashu/nuts/
cd ~/repos/tmbg-recon && grep -rhoE '// NUT #?[0-9]{2}' --include='*.go' src/ | sort | uniq -c
```
Every `file:line` above was re-verified with `sed -n '<line>p' <file>` after the fact.
