# SPIKE — Background execution for automated Cashu top-ups in the TollGate PWA

**Status:** decision-grade spike, evidence-first. Answers a single operator question: *"the PWA must make small, frequent granular purchases in the background so the user focuses on consuming internet rather than buying it — how can we achieve this?"*
**Author:** manager (Felix), 2026-10-14
**Session:** captive-portal-pwa-wallet (Signal)
**Subject:** the TollGate captive portal (React 18 + Vite 7 SPA, GPL-3.0) becoming an installable PWA carrying a client-side Cashu wallet that auto-pays BOLT11 invoices.
**Method:** primary sources only — WHATWG/W3C/WICG specs, MDN browser-compat-data, `chromium/src` on `main` (read from gitiles, base64-decoded), WebKit Bugzilla and `WebKit/standards-positions`, `webkit.org` blog, Chrome Status, Apple developer docs, IETF RFCs, Cashu NUTs. Where a thing is absent the source that says so is named. No folklore.

---

## 0. Verdict, in one screen

**Today, on the actual shipped product, the answer is: not at all — and the reason is not the OS.** The portal is served over **plain HTTP on `http://<router-lan-ip>:2051`**. Service workers, Cache API, durable IndexedDB, `beforeinstallprompt`, Periodic Background Sync, one-shot Background Sync and Web Push are **all gated on a secure context**, and Chrome's installability criteria explicitly require HTTPS (or `localhost`/loopback) rather than merely "secure context".[26][27][28] On a LAN IP over `http://`, there is **no service worker to wake**, so the question of keeping one alive is moot. **Step zero is a transport decision, not a scheduling decision.**

**Once the origin is secure-context installable, the ceiling is low and asymmetric:**

| Platform | Background autonomy achievable | Mechanism |
|---|---|---|
| **Android Chrome** (installed PWA) | **Best case: an opportunistic attempt within minutes of network returning, subject to a 3-attempt / 5-min-backoff retry budget and a 3-minute event budget. Periodic wakes are at most ≈2/day and are frequently 0.** | one-shot Background Sync (enqueued while the app was last open) + Periodic Background Sync as a best-effort backstop + Web Push if a server exists |
| **iOS Safari** (Home Screen web app) | **Without a push server: exactly zero. UNSUPPORTED.** | push event only — Periodic Background Sync and one-shot Background Sync are both absent from Safari |
| **Either, if the origin stays HTTP** | **Zero. UNSUPPORTED.** | nothing loads |

**And there is a hard structural cap that no API fixes:** a top-up is a *purchase for the address that asked for the invoice*. If the client's top-up completes **after** it roamed to another AP or rotated its MAC, the value is bought for an entitlement that no longer exists. So the correct design is **not** "retry until it succeeds" but "**attempt once, inside a bounded window, and abandon with a bounded loss when the identity changed**" — which is exactly the bound D1 already chose: at most one granule per rotation.

**Ship this combination:** (e) `last-spend` + *top-up on next open* as the guaranteed floor; (a) one-shot Background Sync plus Periodic Background Sync plus a foreground `setInterval` while the screen is on, as the opportunistic accelerant; (b) Web Push **only** if a push service is self-hosted, and never as the sole rail; (c) a native app only if Android-only autonomy ever becomes a product requirement. Anything that promises "it just keeps buying while your phone is asleep" on iOS must not be written into the ADR.

---

## 1. The test conditions this dossier is measured against

Three facts about TollGate's client-side environment decide most of the answers, so they are stated up front.

1. **Origin is plain HTTP on a LAN IP.** The portal SPA is served by nodogsplash's `uhttpd` on `:2051` as `http://<window.location.hostname>:2051`, with the TollGate API on `:2121` on the same host (project dossier §2.4/§2.2; portal source `src/helpers/tollgate.js`).
2. **The origin is per-router, and per-address.** The host is taken from the page itself. Roaming to a different venue or a different router changes the origin, which means a different service-worker registration, a different Cache, and a different IndexedDB — a different install identity in the user's home screen.
3. **The purchase is address-scoped.** Per the governing ADR and R1/R2, entitlement belongs to one address for the life of the purchase that paid for it, and refunds are not adopted because they would require exactly the durable per-address ledger the design forbids.

Consequence: this is not "a PWA that syncs a feed". It is a PWA whose *only* network op is a money-moving, address-bound, multi-step operation, running on a hostile, frequently-changing, sometimes-absent origin.

---

## 2. Q1 — Can a PWA run code while backgrounded or closed on **Android Chrome**?

### 2.1 Availability, in table form

| API | Spec status | Ships in Chrome Android today? | Fires while app is fully closed? | Gating conditions |
|---|---|---|---|---|
| **Service Worker + `fetch`** | W3C, REC-track | **Yes** | No (fetch needs a client or a functional event) | **Secure context only** — "Only secure contexts are allowed to register service workers"[26] |
| **Web Push (`push` event)** | W3C Push API | **Yes** — `PushManager` since Chrome 42, `push` event since Chrome 40[44][45] | **Yes** — this is the one rail designed to wake a closed app | Secure context, notification permission, and *user-visible* notification |
| **One-shot Background Sync (`sync`)** | WICG, "Specification being incubated in a Community Group", **not a W3C Standard**[20] | **Yes** — `SyncManager` Chrome 49, `register` Chrome 49, `sync` event Chrome 49[43][45] | **Yes** — the sync is durable; the *registration* must happen while a client is open | Secure context. **No explicit permission** — MDN: the API "does not need an explicit user permission, but issuing a background sync request may only be made while the main app is open"[6][29] |
| **Periodic Background Sync (`periodicsync`)** | WICG, **experimental**[2] | **Yes** — `PeriodicSyncManager` since Chrome 80; Chrome Status lists the feature as *Enabled by default*[42][19] | Yes, but only on the browser's schedule | Secure context **and an installed, separately-launched web app** — see §2.3 |
| **Background Fetch** | WICG | Yes, Chrome 74+[45] | Yes | `background-fetch` permission, and the browser shows user-visible progress the user can cancel[29]. Wrong tool: it is for long downloads, not a 5-second melt. |
| **Notification Triggers** (`showTrigger`) | Never standardised | **No — UNSUPPORTED.** Chrome Status: *"In developer trial (Behind a flag)"*, no milestone, Firefox and Safari `None`[21] | — | **There is therefore no web API to schedule a local notification for a future time.** This kills option (d) as literally specified in §6. |

### 2.2 What Android does underneath, and why it caps everything

Android's own power management is the outer envelope on top of the browser's. In Doze the system "prevents apps from accessing the network and defers their jobs, syncs, and standard alarms"[36]; periodically it opens a maintenance window during which "the system runs all pending syncs, jobs, and alarms, and lets apps access the network"[36], and "over time, the system schedules maintenance windows less frequently"[36]. So even a browser that wants to fire a sync *cannot* fire it during Doze, and on a stationary, unplugged, screen-off phone the gaps grow. A "frequent" background top-up on a sleeping phone is therefore not a scheduling problem you can engineer around — it is a power-policy decision the OS owns.[36][37]

### 2.3 Periodic Background Sync: the exact rules, read out of Chromium

This is the part usually reported as folklore. The constants are in the tree, so here they are verbatim.

**Chrome will not prompt for it and will block it outright for a non-installed origin.** Chromium's permission context returns `CONTENT_SETTING_BLOCK` when the origin has no installed PWA — "if (!can_bypass_install_requirement && !IsPwaInstalled(requesting_origin)) { return CONTENT_SETTING_BLOCK; }"[16] — and it never prompts: "The user should never be prompted to authorize Periodic Background Sync"[16]. MDN agrees: "In Chrome, the permission is granted only to an installed web app that has been launched as a separate application."[1] web.dev is equally blunt: "a web app can only use periodic background sync after a person has installed it on its device, and has launched it as a distinct application."[4]

**The interval floor is twelve hours, not minutes.** From `content/public/browser/background_sync_parameters.cc` on `main`:

```
constexpr base::TimeDelta kMinPeriodicSyncEventsInterval = base::Hours(12);
constexpr base::TimeDelta kMaxSyncEventDuration       = base::Minutes(3);
constexpr base::TimeDelta kInitialRetryDelay          = base::Minutes(5);
constexpr base::TimeDelta kMinSyncRecoveryTime        = base::Minutes(6);
const int                 kMaxSyncAttempts            = 3;
```
[13]

The same constants appear as the parameter surface in the header: "The minimum time interval between first attempts of Periodic Background Sync events for a given registration" is `min_periodic_sync_events_interval`.[14] All of them are field-trial-overridable (`min_periodic_sync_events_interval_sec`, `max_sync_event_duration_sec`, `max_sync_attempts`, …)[15] — i.e. **these are Chrome's numbers, not a contract with your app, and they can change without notice.**

**The developer's `minInterval` is a request, and the browser rounds it *up* to a multiple of the effective gap.** `BackgroundSyncControllerImpl::GetNextEventDelay` computes the first-attempt delay for a PERIODIC registration as the site-engagement factor multiplied by the 12-hour interval, then:

```cpp
int site_engagement_factor =
    delegate_->GetSiteEngagementPenalty(registration.origin().GetURL());
if (!site_engagement_factor)
  return base::TimeDelta::Max();

int64_t effective_gap_ms =
    site_engagement_factor *
    parameters->min_periodic_sync_events_interval.InMilliseconds();
return ApplyMinGapForOrigin(
    SnapToMaxOriginFrequency(registration.options()->min_interval,
                             effective_gap_ms), ...);
```
[15]

Two consequences fall straight out of that code.

- **`TimeDelta::Max()` means "never".** If the engagement penalty is zero — i.e. engagement level `NONE` — the first attempt is scheduled at the maximum representable time. The event does not fire late; it does not fire.[15] web.dev states the same thing in prose: "a periodicsync event won't be fired at all unless the engagement score is greater than zero, and its value affects the frequency at which the periodicsync event fires".[4]
- **The *smallest* achievable period is `1 × 12h`, and only for the most-engaged tier.** The engagement penalty is a multiplier with only four values, and larger numbers mean *longer* gaps: `kEngagementLevelNonePenalty = 0`, `kEngagementLevelHighOrMaxPenalty = 1`, `kEngagementLevelLowOrMediumPenalty = 2`, `kEngagementLevelMinimalPenalty = 3`.[17] So an app the user touches constantly gets ≈2 fires/day; an app they touch occasionally gets one every 24h; an app they have drifted away from gets one every 36h; an app they have stopped using gets **none, ever**.[15][17]

**The engagement score is not something the app can buy.** It is "a double from 0-100" keyed by origin, raised by "the amount of active time the user spends on the site", and "After a period of inactivity the score will start to decay".[22] The Chromium design document is explicit that one of the three intended uses of the score is "Allocating resources based on the proportion of overall engagement a site has (e.g storage, background sync)".[22] The portal can inspect its own score in the field at `chrome://site-engagement/`.[4][22]

**Three more gates that matter specifically for a venue portal:**

- **Previously-connected networks only.** "The background sync activity only occurs on a network that the device has previously connected to."[4] For a captive portal this is close to fatal on a *first* visit to a venue, and it is a permission-ish signal the app cannot request. *Inference, flagged as such:* the wording implies no periodic wake on a network the device has never been on before — i.e. the roaming case the whole granularity design exists to handle is exactly the case where the backstop is least likely to fire.
- **Data Saver disables it.** The explainer: where the browser detects data-saver, "the periodicsync event SHOULD not be fired".[3]
- **It stops if the user stops using the app.** "If the person stops frequently interacting with the app, periodic background sync will stop triggering."[4] A top-up that only runs when the user is already opening the app is a top-up for a user who does not need it.

**And there is a global-throttle cap on top of the per-origin one.** Chromium's `MaybeApplyBrowserWakeupCountLimit` refuses to schedule a periodic first attempt sooner than `min_periodic_sync_events_interval` after the *last browser wakeup of any origin*: `time_since_last_browser_wakeup >= parameters_->min_periodic_sync_events_interval` is required before the requested delay is honoured.[18] With a 12h constant that is a second 12-hour gate, this time shared across every site on the device.

**Minimum interval assumption in the spec vs shipped reality.** The WICG explainer notes that "Android and iOS impose a minimum interval of 15 and 10 minutes, respectively" for repeated OS-level tasks, but immediately rejects that as the bar for the web: "For installed web apps, however, this interval is too small. This is because firing the event in the browser from an installed web app puts a higher strain on the system and is more resource intensive."[3] The spec itself only requires that the effective interval be "the minimum periodic sync interval for any origin + some user agent defined amount for the origin", with a note that the UA-defined amount "could be based off the amount of engagement the user has with the origin".[2] **Do not build against 15 minutes. The shipped Chrome floor is 12 hours, and the shipped Chrome norm for a low-engagement origin is never.**[13][15][17]

### 2.4 One-shot Background Sync: the rail that actually works, and its budget

One-shot sync is the better fit for a top-up, because it fires "as soon as network connectivity is available" rather than on a 12-hour clock, and it needs **no user permission at all**.[5][29] The spec: "If the page (or worker) that registered the event is running, the user agent will fire the sync event as soon as network connectivity is available. Otherwise, the user agent should run the event at the soonest convenience. If a sync event fails, the user agent may decide to retry it at a time of its choosing."[5]

Its budget, from the same Chromium constants[13] and the controller's delay maths:

- **At most 3 attempts**, then the registration is dropped. `registration.set_max_attempts(permission_statuses.second == PermissionStatus::GRANTED ? max_sync_attempts_with_notification_permission : max_sync_attempts)`[18], both defaulting to `kMaxSyncAttempts = 3`.[13]
- **Retry backoff is `initial_retry_delay × retry_delay_factor^(attempts−1)`** = `5 min × 3^(n−1)`, i.e. **5 min, then 15 min**, then out.[15][13]
- **A single event may run for at most 3 minutes**, enforced as `StartRequestWithCustomTimeout(..., parameters_->max_sync_event_duration, ServiceWorkerVersion::CONTINUE_ON_TIMEOUT)`.[18][13] `CONTINUE_ON_TIMEOUT` is the important word: **the browser does not kill your promise, it gives up waiting and lets the worker be torn down** — which is why §4 exists.
- **The registration must be created while a client is open** — "issuing a background sync request may only be made while the main app is open".[29] You get *durability of the attempt*, not *freedom to schedule it*.
- **`lastChance` tells you it is over.** "The `lastChance` attribute is true if the user agent will not make further attempts to try this sync after the current attempt."[5] This is the platform's own signal that you must now surface something to the user — and the spec's example is literally to show a notification in that case.[5]
- **A UA may impose a *stricter* time limit on the last attempt.** "A user agent MAY impose a time limit on the lifetime extension and execution time of a SyncEvent which is stricter than the time limit imposed for ExtendableEvents in general. In particular an event for which lastChance is true MAY have a significantly shortened time limit."[5] **Do not plan the final attempt as a full 3 minutes.**
- **The retry policy is a UA heuristic, not a promise.** "If a sync event fails, the user agent may decide to retry it at a time of its choosing" [5] — the `May` in that sentence is the reason §2.4's Chromium constants must be read as a *budget you might get*, not a delivery guarantee.

### 2.5 What actually kills background work on Android Chrome — the checklist

1. **No secure context** → no service worker exists at all.[26] *(This is TollGate's current state.)*
2. **Not installed / never launched standalone** → Periodic Background Sync is `CONTENT_SETTING_BLOCK`, not merely low-priority.[16][1][4]
3. **Engagement decayed to `NONE`** → periodic first attempt is scheduled at `TimeDelta::Max()`, i.e. never.[15] Engagement decays with inactivity[22] and only the user's attention refills it.[22]
4. **Never previously connected to this network** → PBS activity does not occur.[4]
5. **Data Saver on** → PBS should not fire.[3]
6. **Device in Doze** → network blocked, syncs and alarms deferred to a maintenance window that gets further apart over time.[36]
7. **Attempt budget exhausted** → 3 attempts, 5/15-minute backoff, then the registration is gone.[13][15][18]
8. **Event ran past 3 minutes** → browser stops waiting and tears the worker down (`CONTINUE_ON_TIMEOUT`).[18][13]
9. **The origin changed** (roamed to a different router) → different origin, different registration, different storage; all of the above state simply does not exist for the new venue.

---

## 3. Q2 — The same question for **iOS Safari**

### 3.1 What Safari has

**Web Push, for Home Screen web apps only, since iOS/iPadOS 16.4.** The WebKit announcement: "Now with iOS and iPadOS 16.4, we are adding support for Web Push to Home Screen web apps."[9] The install condition is explicit — the developer "can create a manifest file (with its display member set to standalone or fullscreen ) and serve it along with their website. If they do, that site becomes a Home Screen web app."[9] MDN's compat data records the same gating in its note on `safari_ios` for `PushManager`: *"Notifications are supported in web apps saved to the home screen."*[44] This is *not* a tab-level capability; Safari-the-browser cannot receive web push on iOS.

Two further conditions the PWA must satisfy:

- **Permission requires a user gesture.** "A web app that has been added to the Home Screen can request permission to receive push notifications as long as that request is in response to direct user interaction — such as tapping on a 'subscribe' button provided by the web app."[9] Apple's own documentation repeats it: "Provide a method for the user to grant permission with a gesture, such as clicking or tapping a button. When the user completes the gesture, call the push subscription method immediately from the gesture's event handler code."[10]
- **iOS pivots on APNs.** "Web Push on iOS and iPadOS uses the same Apple Push Notification service that powers native push on all Apple devices. You do not need to be a member of the Apple Developer Program to use it. Just be sure to allow URLs from *.push.apple.com if you are in control of your server push endpoints."[9] Apple's server guidance: allow `https://*.push.apple.com`, use VAPID for identification, and send via RFC 8030.[10][34][35]

### 3.2 What Safari does **not** have — stated as negatives, with sources

- **Periodic Background Sync — UNSUPPORTED.** MDN browser-compat-data for `api.PeriodicSyncManager`: `"safari": {"version_added": false}`, with `safari_ios: "mirror"`.[42] MDN's own feature page carries the *"Limited availability / not Baseline / Experimental"* banner and the note "Check the Browser compatibility table carefully before using this in production."[1]
- **One-shot Background Sync — UNSUPPORTED.** BCD for `api.SyncManager`: `"safari": {"version_added": false, "impl_url": "https://webkit.org/b/182565"}`.[43] That bug is **still open**: filed 2018-02-07, "Feature: Add support for the ServiceWorkerRegistration's SyncManager interface".[7]
- **And WebKit has not been silent about why.** Apple's `standards-positions` issue #14 ("Web Background Synchronization"), filed 2022-06-29 and **still open**, carries the objections: *"we generally have power and security concerns about invisible background script execution by a site that the user isn't currently visiting (potentially even if the browser is not running / not frontmost)"*; *"Adding `concerns: power` as generally having activity running in the background is not great for battery life"*; and *"Adding `concerns: privacy` as this would allow a website to monitor you switching IP addresses."*[8] The exchange makes clear that "installed to the home screen" does not unlock trust: *"I might add a game to my homescreen to make it easier to get to. Doesn't mean I trust the code."*[8] **Treat Background Sync on iOS as unimplemented and unwanted, not merely unfinished.**
- **`notificationclick` on iOS — reported UNSUPPORTED.** MDN BCD for `api.ServiceWorkerGlobalScope.notificationclick_event` gives `"safari_ios": {"version_added": false}` while macOS Safari is `16`.[45] This is surprising and load-bearing for §6 option (d), so it is flagged as **must-verify-on-device** rather than treated as settled; the BCD entry is the source that says so.[45]
- **Silent push — impossible by policy, with a penalty.** Apple: "Safari doesn't support invisible push notifications. Present push notifications to the user immediately after your service worker receives them. If you don't, Safari revokes the push notification permission for your site."[10] WebKit's declarative-push post explains the enforcement and confirms the penalty box applies to *any* failure to display, including network and device conditions not the author's fault: "if an event handler doesn't show the user visible notification for any reason we revoke its push subscription".[11] **On iOS every background wake costs the user a notification, every time.**
- **No service worker at all without an install.** So on iOS the *only* background wake source is a push event, and push itself requires the install.[9][44]
- **7-day storage cap, with an installed-app carve-out.** ITP deletes "all of a website's script-writable storage after seven days of Safari use without user interaction on the site", and the affected list explicitly includes "Service Worker registrations and cache" plus IndexedDB and LocalStorage.[12] Critically for us, WebKit carves out installed apps: "Web applications added to the home screen are not part of Safari and thus have their own counter of days of use… We do not expect the first-party in such a web application to have its website data deleted."[12] **So the wallet's IndexedDB — i.e. the bearer ecash — survives on an installed iOS web app as long as the app is used, and does *not* survive reliably as a Safari tab.** For a bearer-value wallet that is a first-order design constraint, and it argues for the install being mandatory, not a nicety.

### 3.3 Declarative Web Push — the one genuinely new iOS capability, and what it does not buy us

Shipped 2025-03-27[11]. Its purpose is to let a push render a notification **without** running service-worker JavaScript, so the notification can no longer be lost to a worker that failed to start: "Declarative Web Push allows web developers to request a Web Push subscription and display user visible notifications without requiring an installed service worker… there is no penalty for service workers failing to display a notification; the declarative push message itself is used as a fallback in case the optional JavaScript processing step fails."[11]

This is a real robustness gain for *notifications*. **It is not a gain in background autonomy for us, and must not be sold as one:** the declarative path exists precisely to *avoid* running your code, and the non-declarative path's whole problem is that it runs code so briefly and so conditionally. Neither variant turns iOS into a place where a multi-step Cashu melt can be driven to completion unattended.

### 3.4 iOS, honestly

> On iOS today, a PWA can be woken in the background **exactly once per push message, only if it is installed to the Home Screen, only if the user granted notification permission from a tap, and only if it displays a notification every single time — with permission permanently revoked if it ever fails to.** There is no periodic wake, no background sync, no local timed notification, and no silent wake. **A background Cashu top-up driven by a push notification is therefore technically constructible on iOS and architecturally unacceptable**, because it converts "buy internet silently" into "buzz the user's phone every time you buy internet".

---

## 4. Q3 — The service worker is killed anyway: the crash-safe architecture

### 4.1 The lifetime facts, and a caveat about which ones are documented

- **The spec permits termination at any time.** "A user agent may terminate service workers at any time it: Has no event to handle. Detects abnormal operation: such as infinite loops and tasks exceeding imposed time limits (if any) while handling the events."[25] And the lifetime is bound to *events*, not to the page's references: "The lifetime of a service worker is tied to the execution lifetime of events and not references held by service worker clients to the ServiceWorker object."[25] There is no "keep the service worker alive" switch; `waitUntil()` only extends a *specific* event.
- **There is no spec-mandated termination timer**; the timeout is a UA "optional user agent imposed delay" after which the event's `timed out flag` is set.[24][25] MDN's companion overview states the practical consequence for the *document*: "Usually, websites are very dependent on both reliable network connectivity **and on the user having their pages open in a browser**."[24]
- **Chrome's concrete numbers are documented for *extension* service workers**, and are the clearest public statement of its idle policy: "Normally, Chrome terminates a service worker when one of the following conditions is met: After 30 seconds of inactivity. When a single request, such as an event or API call, takes longer than 5 minutes to process. When a fetch() response takes more than 30 seconds to arrive."[23] Treat 30 s / 5 min / 30 s as the *shape* of Chrome's idle policy for web service workers too. **[unverified]** — no equally explicit published constant exists for web service workers, so the design must not depend on any particular one.
- **The design rule Chrome states for its own workers applies verbatim to ours:** "Any global variables you set will be lost if the service worker shuts down. Instead of using global variables, save values to storage."[23]
- **For background-sync events specifically, our own effective ceiling is 3 minutes**, enforced with `CONTINUE_ON_TIMEOUT`.[13][18]
- **Chrome keeps the browser process alive for one-shot sync but explicitly not for periodic sync** — `CreateBackgroundSyncEventKeepAlive` returns `nullptr` unless `registration_info.sync_type == BackgroundSyncType::ONE_SHOT`.[18] Another reason one-shot is the primary rail and PBS is only a backstop.

### 4.2 Therefore: the melt must be **resumable**, not atomic

A `mint quote → swap → melt → verify` sequence cannot be made atomic in a 3-minute, arbitrarily-terminable, sometimes-never-restarted context. The only correct shape is a **durable intent journal plus a per-step idempotent resume check**, and Cashu's own NUTs already give us the state primitives:

- **The melt quote is an addressable, pollable object.** NUT-05 defines `GET /v1/melt/quote/{method}/{quote_id}` returning the quote's `state`, an enum of `"UNPAID"`, `"PENDING"`, `"PAID"`, plus an `expiry`.[30] **The quote id is the resume token.** Persist it *before* sending the melt.
- **Ask for asynchronous execution, because synchronous melt blocks.** NUT-05 warns in bold: "For methods that involve external payments (like Lightning), a synchronous call will block until the payment either succeeds or fails. This can take a long time. Make sure to use no (or a very long) timeout when making this call!"[30] That is precisely the call shape a 3-minute background budget cannot afford. With `prefer_async: true` the mint "responds immediately with a 200 OK status and the quote state set to `PENDING`", and "The wallet can then poll the quote state endpoint or subscribe to websocket notifications to monitor payment progress."[30] **This is the single most important architectural fit in the whole document: async melt converts a blocking, un-resumable operation into a two-phase one that survives an arbitrary kill between the phases.**
- **Never re-send proofs on the basis of local state.** NUT-07: "A proof is `PENDING` if it is being processed in a transaction (in an ongoing payment). A `PENDING` proof cannot be used in another transaction until it is `live` again."[32] So a blind retry after a crash is not merely wasteful — it is a way to lose the proofs *and* the quote. The resume path is always **poll first**.
- **Resume the mint side too.** NUT-04's mint quote carries `amount_paid` and `amount_issued` and warns wallets "**MUST NOT** decrease locally stored `amount_paid` or `amount_issued` values based on stale responses".[31] NUT-09 exists for exactly the interrupted-response case: recovering blind signatures "for a backup recovery of a lost wallet… or for recovering the response of an interrupted [operation]".[33]

### 4.3 The persistence contract (what makes a background melt safe)

The contract is small, and every item is there to make a kill at any instant recoverable:

1. **Write intent before acting.** Journal `{granule_id, router_origin, invoice, mint_url, melt_quote_id}` to durable storage **before** the melt POST. Without the quote id, an interrupted melt is unrecoverable from the client side.
2. **One granule, one journal entry, one address.** Because entitlement is address-scoped, a journal entry is only valid for the origin/address it was created for. Storing the origin with the intent is what later lets the app *abandon* rather than *mis-apply* it.
3. **Phase order: quote → persist → async melt → poll → persist outcome.** Never a single blocking call.
4. **Resume is poll-only.** On any wake, first `GET` the melt quote and reconcile. Only if the mint reports `UNPAID` and the entitlement is still for the *current* address may the app proceed.
5. **Every write is idempotent and keyed on the quote id.** Multiple wakes, overlapping sync/PBS/push events, and a foreground tab can all race; the journal must make a duplicate attempt a no-op rather than a second spend.
6. **Storage must be durable and origin-scoped.** IndexedDB (not memory, per Chrome's own warning that globals die)[23]; and on iOS, the ITP carve-out for installed web apps is what keeps it alive.[12] Use a Web Lock to serialise a wake against a foreground tab.
7. **Bounded abandonment.** If the address/entitlement changed, mark the intent `abandoned_rotated` and stop. Do **not** retry: retrying a melt whose invoice belonged to a dead address burns value to buy entitlement for an address that no longer exists. The loss is capped at one granule — which is exactly D1's promise, and it is *preserved only if the code refuses to retry across a rotation*.
8. **Expose `lastChance`.** When the platform says the attempt budget is gone, the app must be able to say so visibly ("top-up incomplete; tap to retry") rather than fail silently.[5]

**What this buys:** the background top-up is *interruptible at any step without loss beyond one granule*, and is *resumable at the next wake*. **What it does not buy:** it does not create wakes. Recovery and autonomy are separate problems, and only §2 and §3 create wakes.

---

## 5. Q4 — A captive portal is a hostile environment, and the honest failure model

### 5.1 The deadlock, stated plainly

The operator's framing is right and it should be answered head-on: *does a background top-up even make sense when the network you are buying access to is the one that is gone?*

It makes sense only if you separate two networks that are usually conflated:

- **The venue leg** (client → router → WAN) — this is what the granule buys. It is the leg that is *gone* when entitlement lapses, that *drops* when the phone sleeps or roams, and that is *scoped to one address*.
- **The payment leg** (client → Cashu mint) — this is what actually needs to be reachable at the moment of top-up, and it is *not* the venue. It is an internet service.

The deadlock is that the payment leg normally rides *through* the venue leg. If the client has no entitlement, it typically has no path to the mint, so it cannot pay. TollGate's own behaviour makes this visible: the module advertises `kind:21023 no-reachable-mints` when there is no uplink, i.e. **mint reachability is already treated as a payment precondition** (project dossier, module side). **[unverified]** whether the portal's nodogsplash pre-auth allow-list currently permits mint traffic through the walled garden. That is a policy question owned by the module/portal, not something the PWA can solve, and it is the difference between "background top-up is possible after a lapse" and "background top-up can only ever pre-empt a lapse". **This should be resolved before any implementation card, because if mint traffic is not pre-auth reachable, every background top-up must happen while entitlement is still live, which changes the scheduler's job entirely.**

### 5.2 Four independent failure modes, and what each one costs

| Failure | What breaks | Recoverable? | Mitigation |
|---|---|---|---|
| **Phone sleeps / Doze** | No network, no wake during Doze; maintenance windows widen over time.[36] | Yes, on the next window | Bounded-granule loss bound; don't try to beat Doze |
| **Entitlement lapses before the melt lands** | The invoice was for address A; the melt completes after A died | **No** — value burned | Attempt *before* exhaustion; abandon, never retry across the boundary |
| **Roam to another AP / MAC rotation (D1)** | Different origin or different address; the pending melt is now worthless | **No** — capped at one granule | Store the origin with the intent; refuse to apply a stale melt |
| **Origin unreachable because the portal is the origin** | The PWA's own code, manifest, service worker and storage live on a host that may be at a *different LAN IP* after roaming | Partly | This is why the wake source must not live on the router |

### 5.3 Where the wake-up source should live — and the dependency it creates

The origin problem is the sharpest structural point in the whole assessment. The portal origin is `http://<router-lan-ip>:2051`, taken from `window.location.hostname` (project dossier §2.2). Three consequences follow:

1. **A service worker registration is per-origin.** Roaming to a different router gives a different origin, hence a different registration, a different Cache, a different IndexedDB, and a different home-screen identity. "Buy again at the new address" (D1) is therefore not just a policy choice — **it is what the platform forces.**
2. **A LAN IP cannot be a stable push endpoint.** The push subscription is bound to the origin; a push service would have to be told which of N router origins to route to.
3. **An on-router wake source is unavailable by construction.** Waking a PWA requires the *browser* on the client device to be scheduled — the router cannot reach into the browser's scheduler. "Push server? the router?" is answered: **the router can be the publisher, but only a hosted push service (FCM on Android, APNs on iOS) can be the waker.**[9][34]

So the three candidate wake sources rank as follows:

- **Push service (FCM / APNs via a server)** — the only source that wakes a *closed* app on both platforms.[9][44] But it introduces a permanent, always-online third party in the money path, and on iOS it mandates a visible notification per wake.[10][11] A sovereign/tollgate product should treat this as a **downgradeable optional dependency**, never a hard one.
- **The router** — can originate the *event* (e.g. "balance low") but cannot deliver it as a wake. It can serve the invoice and the balance; that is all.
- **Local notification** — **UNSUPPORTED as a wake source.** Notification Triggers is behind a flag with no milestone.[21] There is no web API to schedule a future local notification. The web platform has no "remind me in 20 minutes" primitive.

**The honest conclusion on dependency:** the sovereign answer and the autonomous answer are in tension, and the resolution is *layering*, not a choice — the app must deliver full value with **zero** push infrastructure and degrade only in *latency*, not in *correctness*, when push is absent.

### 5.4 And the hostile-environment bonus: the venue can see the payment leg

Not a blocker, but worth writing down because it is a privacy consequence of D1's rotation primitive: the Background Sync spec itself notes that "Fetch requests within the onsync event while in the background may reveal something about the client's navigation history to passive eavesdroppers… the client might visit https://example.com, which registers a sync event, but doesn't fire until after the user has navigated away from the page and changed networks."[5] For a top-up that fires after the user leaves, the mint's hostname is visible to the *new* network.

---

## 6. Q5 — The five alternatives, ranked for **this** product

Ranking axes: **Reliability** (does it actually run when we need it), **Autonomy** (does the user have to do anything), **Friction** (cost imposed on the user), and **Sovereignty** (does it add a third party). Ranking is for TollGate specifically, on **Android Chrome** and **iOS Safari**, installed-PWA assumed and origin assumed secure-context.

| # | Option | Reliability | Autonomy | Friction | Sovereignty | Verdict |
|---|---|---|---|---|---|---|
| **e** | **`last-spend` + top-up on next open** | **Very high** — no scheduler involved | None (user opens the app anyway) | Low but *the user does interact* | Clean | **Ship as the floor.** The only mechanism that works on both platforms, needs no permission, no push, and no install. |
| **a** | **Foreground/installed app + `setInterval` while screen is on** | High while foregrounded, and only then | Partial — works while the user is *looking at it* | Low | Clean | **Ship as the accelerant inside a session.** Screen Wake Lock is available to Home Screen web apps since iOS 16.4[9] and on Chrome, so a visible "buying internet" screen can be kept awake while it works. |
| **d** | **Local notification prompt → user taps** | **UNSUPPORTED as specified** — no way to schedule a local notification[21]; and `notificationclick` is BCD-absent on iOS[45] | None — it's a manual tap anyway | Medium: an interruption | Clean | **Do not ship as a wake source.** Keep the *idea* as an in-app banner on next open, which is option (e). Verify the iOS `notificationclick` claim on-device before relying on taps even in the push case.[45] |
| **b** | **Web Push from a small push service** | High on Android (wakes a closed app)[44]; **push-only on iOS = the only wake source there**[9] | **Full** | **High and unavoidable on iOS** — a visible notification per wake, on pain of revocation[10][11] | **Breaks it** — an always-online third party in the payment path | **Ship only as optional, self-hosted, additive.** Never the sole rail. |
| **c** | **Native Android/iOS app instead of a PWA** | **Android: high** (WorkManager periodic + FCM, Doze-aware). **iOS: still discretionary** — `BGTaskScheduler` "give your app a way to run code even when the app is suspended"[38] but the system decides *when*, and the task may simply not run | Full on Android | High: two codebases, app stores, signing, updates | Mixed | **Not now.** It is the only path to real Android autonomy, but it abandons the single-codebase PWA premise, and on iOS it does **not** solve the problem either. Revisit only if Android background autonomy becomes a stated requirement. |

**Also worth knowing, in case it ever comes up:** an Android **Trusted Web Activity** (a PWA in a Play Store shell) changes distribution, not scheduling — it is still the same browser scheduler underneath.[41] And shipping a webview wrapper to the App Store runs straight into App Store Review Guideline **4.2 Minimum Functionality**: *"Your app should include features, content, and UI that elevate it beyond a repackaged website."*[40] The one genuinely native iOS wake primitive for *Wi-Fi* — `NEHotspotHelper`, which can run custom authentication for hotspots — is a Network Extension capability with an entitlement, and Apple's docs record it as available only to `iOS: 9.0.0 - 26.0.0`, i.e. **removed in iOS 26**.[39] **Do not plan an iOS native path around it.**

### 6.1 What I would ship

**One architecture, three layers, each independently useful, in this order of construction:**

1. **Layer 0 (mandatory, platform-neutral): the resumable journal + `last-spend` + top-up on open.** This is §4.3 plus option (e). It is the correctness floor: it guarantees that any top-up that was started is either completed or abandoned with a bounded, honest loss, and that opening the app once always repairs the balance. **Everything else is an optimisation on top of this, and the product must be useful with only this.**
2. **Layer 1 (mandatory, best-effort): opportunistic background attempts on Android.** Register a **one-shot Background Sync** while the app is open, *before* the balance runs low — because registration requires an open client[29] — and treat Periodic Background Sync purely as a backstop. Design the handler for a **3-minute budget**, `prefer_async: true`, and a **3-attempt / 5-min-backoff** envelope.[13][30][15] Also run the existing-time foreground loop with a Screen Wake Lock while the UI is open.[9]
3. **Layer 2 (optional, must be removable): self-hosted Web Push.** Only if the operator wants to spend an always-online server for latency. It must be additive and switchable off without changing Layers 0 or 1, and on iOS the product must be explicitly honest that enabling it means a notification per top-up.[10][11]

**Explicitly not shipped:** anything relying on Notification Triggers, on iOS background sync, on a router-side waker, or on a native app.

---

## 7. Q6 — Concrete recommendation: the maximum realistic autonomy, and what the ADR may and may not claim

### 7.1 The realistic ceiling

**Android Chrome, installed, engaged, secure-context origin:**

> A top-up attempt begins **within minutes of connectivity returning**, *if* a one-shot sync was enqueued the last time the app was open and the attempt budget has not been consumed. Absolute bounds: at most **3 attempts** at 5 min and 15 min backoff, each with a **3-minute** execution ceiling.[13][15][18] When there is no enqueued sync, the fallback is a Periodic Background Sync wake, which is **at best one every 12 hours** and is **frequently never** for an origin whose engagement has decayed.[13][15][4] On a sleeping phone, Android Doze blocks the network and defers syncs to increasingly sparse maintenance windows regardless of what the browser wanted.[36]

**iOS Safari, installed, no push server:**

> **Zero background autonomy. UNSUPPORTED.** Every top-up happens in the foreground. Periodic Background Sync is `version_added: false` in BCD[42]; one-shot Background Sync likewise[43]; WebKit's standards-position is open with stated power and privacy objections[8]; and the only wake source is a push event, which requires an install, a user gesture to subscribe, and a visible notification on every wake, with subscription revocation if it is ever missed.[9][10][11]

**Both platforms, origin left on plain HTTP:**

> **Zero.** No service worker, no install, no background of any kind.[26][27][28]

### 7.2 What the ADR MUST promise

- **Crash-safety and resumability**: "a top-up interrupted at any step — including by service-worker termination — is recoverable, and the client never double-spends or re-uses a `PENDING` proof."
- **Bounded loss**: "if the client rotates address or origin mid-flight, the in-flight granule is abandoned, not retried; per-rotation loss is at most one granule." *(This is D1, made mechanically enforceable by storing the origin with the intent.)*
- **Async two-phase melt**: "melt requests use `prefer_async: true` and are reconciled by polling the melt quote; no blocking synchronous melt is issued from a background context."
- **Degradation, not failure**: "with background execution and push both unavailable, all value is still delivered on the next foreground open."
- **Pre-auth reachability assumption declared**: whatever §5.1 resolves to, the ADR must state it as an assumption, because the design's honesty depends on it.
- **Installed-app storage on iOS**: "on iOS, the wallet requires the Home Screen install, because that is the only configuration in which ITP does not delete service-worker registrations and script-writable storage after seven days of non-use."[12]

### 7.3 What the ADR must **NOT** claim

1. ❌ "The PWA tops up in the background while the phone is asleep." — Android Doze blocks network and defers syncs[36]; iOS has no non-push wake.[42][43][8]
2. ❌ "iOS supports this." — with no push server, iOS background autonomy is zero.[42][43]
3. ❌ "Top-ups happen every N minutes/hours." — the developer's `minInterval` is a *request*, rounded up; the shipped floor is 12 h and the engagement multiplier can make it never.[2][13][15][17]
4. ❌ "We schedule a local reminder notification." — Notification Triggers is behind a flag with no milestone; **UNSUPPORTED**.[21]
5. ❌ "The app stays alive in the background." — "A user agent may terminate service workers at any time it: Has no event to handle."[25] Only `waitUntil()` and a bounded budget exist.
6. ❌ "Background sync guarantees delivery." — one-shot sync retries are UA-heuristic and capped at 3 attempts[5][13]; the spec's own example falls back to telling the user.[5]
7. ❌ "The purchase survives a roam." — entitlement is address-scoped by R1; the design's promise is a *bound on the loss*, not continuity.
8. ❌ "It works today." — it does not, until the portal is a secure context and installable.[26][27][28]

### 7.4 Ordered next steps

1. **Transport decision first** (already flagged in the portal dossier as the gating item): make `http://<lan-ip>:2051` into a secure-context, installable origin, with a captive-portal-detection-compatible certificate story. Nothing in this document is reachable before that.
2. **Resolve the pre-auth mint-reachability question** (§5.1) with the module owner: can the client reach the mint while unauthenticated? This determines whether the background top-up is *pre-emptive* or *restorative*, which changes the entire scheduler design.
3. **Then** build Layer 0 (journal + top-up on open), prove crash-safety with injected kills at every step, and only then add Layer 1.
4. **Instrument the field reality** with `chrome://site-engagement/` and Chrome DevTools' Background Services panel, before writing any claim about wake frequency into user-facing docs.[4][22]

### 7.5 What would falsify this assessment (verify on real devices before shipping)

- The iOS `notificationclick` absence (BCD `safari_ios: false`)[45] — if taps *do* reach the service worker from a Home Screen web app push, option (d) is stronger than ranked here.
- The actual web-service-worker idle timer on Chrome Android (no published constant; the 30 s figure is documented for *extensions*).[23]
- Whether PBS ever fires for a venue-portal origin at all, given the "previously connected network" gate[4] and the first-visit case.
- Whether real-world engagement penalty observed on-device matches the four-tier multiplier read from `background_sync_delegate_impl.h`.[17]

## Sources

[1] https://developer.mozilla.org/en-US/docs/Web/API/Web_Periodic_Background_Synchronization_API — MDN — Web Periodic Background Synchronization API
[2] https://wicg.github.io/periodic-background-sync — WICG spec — Web Periodic Background Synchronization
[3] https://github.com/WICG/background-sync/blob/main/explainers/periodicsync-explainer.md — WICG — Periodic Background Sync explainer
[4] https://web.dev/articles/periodic-background-sync — web.dev — Richer offline experiences with the Periodic Background Sync API
[5] https://wicg.github.io/background-sync/spec — WICG spec — Web Background Synchronization (one-shot)
[6] https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API — MDN — Background Synchronization API
[7] https://bugs.webkit.org/show_bug.cgi?id=182565 — WebKit Bugzilla 182565 — SyncManager (Background Sync), open since 2018
[8] https://github.com/WebKit/standards-positions/issues/14 — WebKit standards-positions #14 — Web Background Synchronization (open)
[9] https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados — WebKit blog — Web Push for Web Apps on iOS and iPadOS (16.4)
[10] https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers — Apple — Sending web push notifications in web apps and browsers
[11] https://webkit.org/blog/16535/meet-declarative-web-push — WebKit blog — Meet Declarative Web Push (2025-03-27)
[12] https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more — WebKit blog — Full Third-Party Cookie Blocking and More (ITP 7-day script-writable storage cap)
[13] https://chromium.googlesource.com/chromium/src/+/main/content/public/browser/background_sync_parameters.cc — Chromium source — content/public/browser/background_sync_parameters.cc
[14] https://chromium.googlesource.com/chromium/src/+/main/content/public/browser/background_sync_parameters.h — Chromium source — content/public/browser/background_sync_parameters.h
[15] https://chromium.googlesource.com/chromium/src/+/main/components/background_sync/background_sync_controller_impl.cc — Chromium source — components/background_sync/background_sync_controller_impl.cc (GetNextEventDelay)
[16] https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/background_sync/periodic_background_sync_permission_context.cc — Chromium source — periodic_background_sync_permission_context.cc
[17] https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/background_sync/background_sync_delegate_impl.h — Chromium source — background_sync_delegate_impl.h (site-engagement penalty)
[18] https://chromium.googlesource.com/chromium/src/+/main/content/browser/background_sync/background_sync_manager.cc — Chromium source — content/browser/background_sync/background_sync_manager.cc
[19] https://chromestatus.com/feature/5689383275462656 — Chrome Status — Periodic Background Sync (enabled by default)
[20] https://chromestatus.com/feature/6170807885627392 — Chrome Status — Background Sync API (enabled by default)
[21] https://chromestatus.com/feature/5133150283890688 — Chrome Status — Notification Triggers (developer trial / behind a flag)
[22] https://www.chromium.org/developers/design-documents/site-engagement — Chromium — Site Engagement design document
[23] https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle — Chrome for Developers — Extension service worker lifecycle (30s idle / 5min request / 30s fetch terminations)
[24] https://web.dev/articles/service-worker-lifecycle — web.dev — The service worker lifecycle
[25] https://w3c.github.io/ServiceWorker — W3C — Service Workers spec §2.1.1 Lifetime
[26] https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts — MDN — Secure contexts
[27] https://web.dev/articles/install-criteria — web.dev — What does it take to be installable?
[28] https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable — MDN — Making PWAs installable
[29] https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation — MDN — Offline and background operation
[30] https://github.com/cashubtc/nuts/blob/main/05.md — Cashu NUT-05 — Melting tokens
[31] https://github.com/cashubtc/nuts/blob/main/04.md — Cashu NUT-04 — Mint tokens
[32] https://github.com/cashubtc/nuts/blob/main/07.md — Cashu NUT-07 — Token state check
[33] https://github.com/cashubtc/nuts/blob/main/09.md — Cashu NUT-09 — Restore signatures
[34] https://www.rfc-editor.org/rfc/rfc8030.txt — RFC 8030 — HTTP Web Push
[35] https://www.rfc-editor.org/rfc/rfc8292.txt — RFC 8292 — VAPID
[36] https://developer.android.com/training/monitoring-device-state/doze-standby — Android — Optimize for Doze and App Standby
[37] https://developer.android.com/about/versions/oreo/background — Android — Background execution limits (Oreo)
[38] https://developer.apple.com/documentation/backgroundtasks/bgtaskscheduler.md — Apple — BGTaskScheduler
[39] https://developer.apple.com/documentation/networkextension/nehotspothelper.md — Apple — NEHotspotHelper
[40] https://developer.apple.com/app-store/review/guidelines — Apple — App Store Review Guidelines §4.2 Minimum Functionality
[41] https://developer.chrome.com/docs/android/trusted-web-activity — Chrome for Developers — Trusted Web Activity
[42] https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/PeriodicSyncManager.json — MDN browser-compat-data — PeriodicSyncManager
[43] https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/SyncManager.json — MDN browser-compat-data — SyncManager
[44] https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/PushManager.json — MDN browser-compat-data — PushManager
[45] https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/ServiceWorkerGlobalScope.json — MDN browser-compat-data — ServiceWorkerGlobalScope events
