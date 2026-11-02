# DOSSIER — Test rails for the TollGate captive-portal PWA (end-to-end)

Recon date: **2026-10-14 ~16:27–16:50** on cobrador (this manager host).
Mode: **READ-ONLY.** Nothing was flashed, installed, rebooted, reconfigured, or
killed. No tracked file was modified.

Rule applied throughout: only measured facts are listed. Anything not reachable is
labelled `UNREACHABLE: <reason>` — no inference from memory or skill text.

---

## 1. DQ05 reachability + resources

| item | measured value | evidence |
|---|---|---|
| ssh | **WORKS** | `ssh -o BatchMode=yes dq05 'echo DQ05_OK'` → `DQ05_OK` (rc=0) |
| address | `dq05` → `192.168.2.32` (`~/.ssh/config`; `dq05.fips` also configured) | `grep -iE '^Host \|HostName' ~/.ssh/config` |
| uptime | `up 20:33` | `uptime` |
| load average | **13.38 / 11.44 / 10.42 on nproc=4** → ~3.3× oversubscribed | `ssh dq05 uptime; nproc` |
| RAM | total 11191 MB, used 6271, free 697, **available 4920** | `free -m` |
| swap | 38362 MB total, 5484 used | `free -m` |
| disk | `/dev/sda2` 468G, **390G used, 55G free, 88%** | `df -h /` |
| /dev/kvm | `crw-rw----+ root:kvm`, **O_RDWR open SUCCEEDED** → `KVM_OPENABLE_OK (O_RDWR)` | python one-liner via ssh |
| groups | `c03rad0r` ∈ kvm(992), docker(122), libvirt(127), dialout, sudo | `id` |
| docker | present, **28.2.2 / overlay2**, active; **5 containers running** (`fips-exit-*`) | `docker info`, `docker ps` |

Other load on the box (relevant to grading any run): `qemu-system-x86` pid 685403
(RSS 1.62 GB), `bitcoind` (686 MB), `fips`, 3× `hermes`, `netsimd`.
Physical cores 4, so the emulator competes with the fleet's own agent load.

### Android emulator state: **RUNNING**
```
685403  qemu-system-x86_64-headless -avd wa-dev -no-window -no-audio -no-snapshot \
        -gpu swiftshader_indirect -no-metrics -no-boot-anim   ELAPSED 17:24:15  RSS 1.62GB
685441  crashpad_handler ...
685681  netsimd --host-dns=127.0.0.53
```
`adb devices` → `emulator-5554  device  product:sdk_gphone64_x86_64`
`emulator -accel-check` → `KVM (version 12) is installed and usable.`

AVD inventory: `wa-dev` only (`~/.android/avd/wa-dev.avd` + `wa-dev.ini`); device
`pixel_6`, target Google Play, **Android 14 (google_apis_playstore/x86_64)**, sdcard 512 MB.

**Consequence:** the emulator rail is LIVE and occupied. Do not `boot`/`teardown`/`reap`
without coordinating; guest-driving work must also be graded against load 13 on 4 cores.

---

## 2. The Android emulator rail

- `~/emulator-harness.sh` **exists on dq05**: `/home/c03rad0r/emulator-harness.sh`,
  16315 bytes, mode 775, mtime Oct 13 22:36.
- Subcommands accepted (`--help`, rc=0) — verbatim:
  `Usage: emulator-harness.sh [--dry-run] <preflight|install|create|boot|status|teardown|reap|reclaim|doctor|all>`
  `--dry-run` prints without executing; `all` = preflight+install+create+boot.
  Case-label grep confirms exactly those ten; **there is no `diag` subcommand** on this copy
  (the skill text mentions a `diag` phase — it is not in this harness).
- `~/emulator-harness.sh status` (read-only) **worked**, rc=0: listed the AVD, `adb devices`,
  and the running emulator process. Ran while the guest was live without disturbing it.
- **Repo copy: UNREACHABLE.** The skill's canonical copy is `nosms/tools/emulator/emulator-harness.sh`
  (and `tools/emulator/test_emulator_harness.sh`). Neither `~/repos/nosms` nor `~/nosms` exists on
  dq05, and no `nosms` dir exists under cobrador's `~/repos`. So the skill's instruction
  "scp the repo version over it" **cannot be executed today** — only dq05's (possibly drifted) copy
  is available.
- AVD `wa-dev` `config.ini` (measured):
  ```
  hw.lcd.width=540   hw.lcd.height=1200   hw.lcd.density=240
  hw.ramSize=4096M   hw.cpu.ncore=4       vm.heapSize=512M
  hw.gpu.enabled=no  hw.gpu.mode=auto     PlayStore.enabled=no
  image.sysdir.1=system-images/android-34/google_apis_playstore/x86_64/
  ```
  → this is the **post-resolution-fix** configuration (540x1200), matching the skill's
  measured fix. `hw.gpu.enabled=no` vs `-gpu swiftshader_indirect` mismatch (skill pitfall) persists.
- Guest resolution (live): `wm size` → `Physical size: 540x1200`, `Override size: 360x800`.
- **adb availability**
  - On dq05: `/home/c03rad0r/Android/Sdk/platform-tools/adb` — live, sees `emulator-5554`.
  - On cobrador: **NOT installed** (`~/Android/Sdk/platform-tools/adb` missing; `command -v adb` empty).
  - Cross-host adb: **no `adb-tunnel*` systemd user units installed** (`systemctl --user list-units 'adb*'` → 0 units).
    The skill's socat IPv6-bridge recipe is documented but **not deployed** ⇒ cross-host adb from
    cobrador is currently unset.
- `uiautomator2`: available on dq05 in `/home/c03rad0r/wa_u2_venv` (`import uiautomator2` OK);
  not on system python.
- **`/tmp/u2_probe.py` MISSING on dq05** → the known post-reboot class: any driver that shells
  `U2_PROBE` (default `/tmp/u2_probe.py`, e.g. the WhatsApp rail) dies instantly. Reinstall from
  its repo source before use.
- Guest Chrome: **present** — `com.android.chrome` (`base.apk` + `split_config.*.apk`).
  Guest has **no curl/wget** (`adb shell which curl wget` → empty).

---

## 3. PWA-on-emulator prior art

### Present (cobrador) — the one usable harness
`/home/c08r4d0r/repos/cvm-registry/tools/pwa-emulator-test/`
| file | purpose |
|---|---|
| `run-pwa-emulator-test.sh` (81 ln, 3327 B) | orchestrator: serve repo on `:8099`, ensure u2 on emu host, boot+wait, drive, collect screenshots, teardown |
| `emu_boot_and_wait.sh` | runs ON emu host: boots headless AVD if absent, polls `sys.boot_completed` 40×10 s |
| `emu_teardown.sh` | `adb emu kill` + `adb kill-server`; explicitly never `-wipe-data` |
| `drive_pwa.py` (4230 B) | **uiautomator2** driver: clears Chrome first-run dialogs, `am force-stop com.android.chrome`, then `am start -a VIEW -d <url>`, screenshot per screen |
| `README.md` | run recipe + what was verified |

Interface: `--emu-host user@host --url-host <host serving the PWA>` plus `--avd wa-dev`,
`--port 8099`, `--out`, `--external-url`, `--keep`. It reaches the emulator **over ssh only**
(it runs `adb` on the emu host via PATH); there is **no `--adb-socket`/`ADB_SERVER_SOCKET` support**
and it does not use `adb37`.

Status assessment:
- Files intact; Deno regression test `repos/cvm-registry/tests/pwa_emulator_harness_test.ts`
  pins the uiautomator2 fix, the never-wipe teardown, and the deploy file set.
- **NOT re-run in this recon** (running it would `pip3 install` on dq05, start an HTTP server, and
  drive Chrome on the live guest — all mutating). Last verified **2026-10-09** per its README, on
  the `wa-dev` guest: 4 of 5 screens captured against real registry data; **the basket→pay
  transition was never reached, so the pay screen is unverified** and "never fabricate an invoice"
  is untested in the emulator.
- It hardcodes `c03rad0r@c03rad0r-dq05proplus.local` in its docstring — for this fleet, `--emu-host dq05` works.

### Absent / unreachable
- On dq05: **no** `pwa-emulator-test/` dir, **no** `drive_pwa.py`, **no** `run-pwa-emulator-test.sh`
  anywhere under `~/repos` or `~/worktrees` (maxdepth 5); **no `cvm-registry` repo at all**
  (`~/repos/cvm-registry` → No such file or directory). Driving the PWA therefore requires the
  cobrador-side copy to be scp'd (or cvm-registry cloned) onto dq05.
- `google-chrome` package (Linux desktop Chrome): not present on either host — expected; the rail
  uses the Android Chrome APK.
- `chromedriver`: **not found** on cobrador or dq05.
- No uiautomator2 probe helper on dq05 (`/tmp/u2_probe.py` missing, see §2).

See §7 for why the harness was not executed live.

---

## 4. Fleet routers — **ALL TollGate routers UNREACHABLE right now**

`ping`, `fping`, `nmap`, `nc` are **all MISSING on cobrador** (`ping_rc=127`), so reachability was
probed with bash `/dev/tcp` (TCP connect), which is also what the routers' ICMP-drop behaviour
requires.

Exact command (run identically on cobrador and on dq05):
```bash
for tgt in 192.168.1.1 192.168.8.1 192.168.10.1 192.168.2.1; do
  for port in 22 80 2121 2050; do
    timeout 4 bash -c "echo > /dev/tcp/$tgt/$port" 2>/dev/null \
      && echo "OPEN  $tgt:$port" || echo "closed/unreach $tgt:$port"
  done
done
```

| target | cobrador | dq05 | interpretation |
|---|---|---|---|
| 192.168.1.1 (GL-MT6000 Flint 2 / MT3000 bench, TollGate) | 22/80/**2121**/**2050** all closed | same | **UNREACHABLE: no route** |
| 192.168.8.1 (secondary router LAN) | all closed | all closed | **UNREACHABLE: no route** |
| 192.168.10.1 | all closed | all closed | **UNREACHABLE: no route** |
| 192.168.2.1 (the *local* LAN's own gateway — **not** a TollGate box) | **:80 OPEN**, 22/2121/2050 closed | **:80 OPEN**, same | reachable plain home router; no TollGate API, no nodogsplash |

Routing evidence that this is a topology fact, not a router fault:
- cobrador interfaces: `wlp59s0 192.168.2.20/24`, `enx6c6e0750cd79 192.168.2.13/24`,
  `enx00e04c36043e 192.168.2.12/24`; `enp0s31f6` DOWN; default via `192.168.2.1`.
- dq05 interfaces: `enp1s0 192.168.2.38/24`, `wlp2s0 192.168.2.32/24`; default via `192.168.2.1`.
- dq05: `ip route get 192.168.1.1` → `192.168.1.1 via 192.168.2.1 dev enp1s0 src 192.168.2.38`
  (i.e. it would be routed *through the home gateway*, which has no such network).

**Therefore, for every router: TollGate version, portal served, whether `:2121` answers, and LAN
uplink state are all `UNREACHABLE: no route to 192.168.1.0/24` — not measured, not inferred.**
No install/flash/reboot/reconfigure was attempted (read-only rule).

The documented bench topology (from skill text only, *not* verified today) is: router LAN
`192.168.1.1/24`, GL-MT3000 OpenWrt 25.12.5 aarch64, `root` with empty password, nodogsplash
`:2050`, TollGate API `:2121`, portal Playwright base `http://192.168.1.1:8080`. Today no physical
segment carries that LAN.

---

## 5. Existing e2e / property harnesses for the portal

### `~/src/physical-router-test-automation` — the canonical kit (also on dq05 at `~/physical-router-test-automation`)
- `tests/browser/*.spec.mjs` — ~40 Playwright specs. Directly portal-relevant:
  `tollgate-portal-lightning.spec.mjs`, `tollgate-portal-assets.spec.mjs`, `captive_portal.spec.mjs`,
  `degraded_portal.spec.mjs`, `portal-fixes-e2e.spec.mjs`, `net4sats-captive-portal.spec.mjs`,
  `happy-path.spec.mjs`, `net4sats-full-e2e-smoke.spec.mjs`, `portal-tab-copy.spec.mjs`,
  `glinet-flash.spec.mjs`, `cudy_wr3000.spec.mjs`, `tollgate-installer-mt6000.spec.mjs`.
- `Makefile` targets: `test-playwright`, `test-captive-portal`, `test-captive-portal-happy`,
  `test-cashu-payment`, `test-configwizzard-e2e`, `record-portal` (video, desktop+mobile),
  **`bench-tests`** ("Offline negative-control suite … hermetic: never the production lock …
  **no router**"), `install-path-e2e` (LOCKED bench; real flash), `second-purchase-e2e`.
- **Local router-free lab (most relevant):** `LOCAL-VM-TESTING.md` + `scripts/virtual-lab.py`
  (`start-poc` / `stop-poc`), `scripts/run-local-tests.sh`, `scripts/deploy-local-vm.sh` —
  runs TollGate E2E against a **local OpenWrt 24.10.1 QEMU VM + Debian client VM**, with
  `scripts/offline/` for offline install and a **CDK fakewallet mint** at `/opt/cdk-mintd/cdk-mintd`
  (no Lightning needed). Needs `qemu-system-x86`, `qemu-utils`, `sshpass`, `curl`, python venv.
- Container/netns harnesses: `lib/clients/container.py`, `tests/fips-exit-e2e/docker-compose.yml`,
  `scripts/hwsim-netns-poc.py`, `tests/api/test_virtual_wifi_hwsim_netns.py`.
- `deployment-kit/scripts/hot-deploy-portal.sh` — push a portal bundle onto a live router.
- `scripts/offline/`: `00b-verify-router-cred.sh`, `install-router.sh`, `install-offline.sh`
  (the skill's numbered 00–06 offline sequence is not present in this checkout in that form).

### Portal site's own suites
`~/repos/tollgate-captive-portal-site` (and dq05's copy on `main` @ `4158030`): `playwright.config.js`,
`playwright.portal2.config.js`, `playwright.qr-http.config.js`, `vitest.config.js`, `tests/`, `admin/`,
`openwrt/`, `packaging/` — a self-contained portal UI suite that needs no router.

### `deploy-portal-e2e-v4.sh` / `-v5.sh` + the no-router Alpine harness — **UNREACHABLE: not present**
- Documented in skill `tollgate-development` §13/§14 and
  `references/router-deploy-and-e2e-testing.md`: v4 = one self-contained ssh per stage;
  v5 = BusyBox-proofing (`wc -c` not `stat`, applet probe, `TG_*` markers, reuse of
  hash-verified remote copy), **plus a no-router Alpine harness** (`rm -f /bin/stat /usr/bin/stat`
  + stand-in `apk` + `ssh` PATH shim) that reproduced v4's failure and proved v5's fail-closed gates.
- The script lives on fork branch `host-alpha5-apk`. That branch is **not checked out locally**
  and no `deploy-portal-e2e*` file exists under `~/repos` or `~/worktrees` (maxdepth 4) → cannot be
  executed or inspected today.
- Purchase-flow references (skill `physical-router-testing`): `references/router-purchase-e2e.md`,
  `references/cashu-payment-session-flip-proof.md`, `references/wanless-offline-bundle*.md`,
  and kit `testnut-purchase-e2e.*` specs — reference-level knowledge; the spec files were not
  located on disk in this pass.

### Host capability for the router-free rails (cobrador)
| capability | state |
|---|---|
| `/dev/kvm` | **openable OK** (`COBRADOR_KVM_OPENABLE_OK`), `kvm_intel` loaded — contrary to older assumptions, this laptop **can** run hardware-accelerated QEMU VMs |
| `qemu-system-x86_64` | **present** (`/usr/bin/qemu-system-x86_64`) |
| CDK mint binary | **present** (`/opt/cdk-mintd/cdk-mintd`) |
| `docker` | **MISSING** on cobrador → container harnesses cannot run here |
| Playwright | **not installed** (`src/physical-router-test-automation/node_modules/@playwright` absent) |

---

## 6. Recommended test matrix

### (a) TODAY, zero hardware setup
1. **Portal site suite, host-mode** — `tollgate-captive-portal-site`: `npm ci`, vite dev/preview,
   then its own Playwright + Vitest suites. No router, no emulator, no container.
2. **New: stub-API PWA e2e (see the first test to build below).**
3. **Kit's local QEMU OpenWrt lab** — `python3 scripts/virtual-lab.py start-poc --host localhost`
   + `./scripts/run-local-tests.sh …`. Cobrador already has qemu + `/opt/cdk-mintd/cdk-mintd`;
   needs `qemu-utils`, `sshpass`, and `./scripts/setup-python.sh`. This is "a router, without a router".
4. **Kit `bench-tests`** — hermetic negative-control suite, explicitly no router.
5. **cvm-registry PWA property tests** — `tests/pwa_emulator_harness_test.ts` (harness shape) and
   `tests/*pwa_installable*` (installability/console PWA contracts), Deno, no hardware.
6. Caveat to design around, not a blocker: a **captive portal PWA must work over plain HTTP on a
   non-secure origin** — service-worker registration and install prompts behave differently there.
   Every router-free test must therefore exercise the **http** path, not just `localhost`.

### (b) Needs DQ05's emulator
Real Android Chrome/PWA-on-a-phone behaviour: Android service-worker install + "Add to Home
screen"/WebAPK flow, standalone-window launch, touch/IME input, and the portal rendered at phone
resolution. Path: push the cobrador-side `tools/pwa-emulator-test/` to dq05 (or clone cvm-registry
there) and drive the **already-running** `wa-dev` guest — after coordinating with whoever holds it
and after load has fallen (skill gate: 1-min load < ~4; today it is 13).

### (c) Needs a physical router
nodogsplash captive-portal **interception** (DNS/HTTP redirect, `trustedmac`), the real
**Cashu payment → `session_active` false→true** session flip, `:2121`/`:2050` on real OpenWrt, and
flash/offline-install paths. **Blocked today**: no route to `192.168.1.0/24` from cobrador or dq05
(§4). Nothing was attempted against the hardware.

### Single most valuable first test to build
**A hermetic, router-free "portal PWA over captive-portal HTTP" e2e.**
Concretely, in the kit: a small fixture that serves `tollgate-captive-portal-site` on a plain-HTTP
origin plus a **stub TollGate API on `:2121`** (and a stub mint), then a Playwright **mobile-chrome**
project that asserts the properties the whole project turns on:
1. the document loads over `http://` with no mixed-content/SW abort;
2. `manifest.webmanifest` is linked, fetchable and valid (name/start_url/display/icons);
3. a **service worker registers and reaches `activated`** on that non-secure origin;
4. the balance/venue render happens from the stub API, not from hardcoded markup;
5. a **Cashu token paste/spend** against the stub mint produces a payment request and a rendered
   QR/invoice, and the success transition flips the session state;
6. a negative control: with the stub API detached, the portal shows the *degraded* surface rather
   than fabricating an invoice (directly targets the one unverified screen in §3).

Why this one: it runs on cobrador with qemu/docker absent, it needs no router and no emulator, it
covers exactly the client-side PWA path this project rewrites, and it is the gate the emulator rail
(§b) and the router rail (§c) then inherit verbatim — the same assertions can be re-pointed at
`http://wa-dev:8099` and `http://192.168.1.1:8080` by changing only the base URL.

---

## 7. Blockers hit in this recon (exact commands + errors)

1. **`ping` missing on cobrador** — every target returned `ping_rc=127`:
   `ping -c1 -W1 192.168.1.1` → `bash: ping: command not found`. `fping`, `nmap`, `nc` also
   `MISSING`. Workaround: `bash -c "echo > /dev/tcp/$tgt/$port"`.
2. **`docker` missing on cobrador** —
   `timeout 20 docker info --format ...` → `timeout: failed to run command 'docker': No such file or directory`.
   Container-based harnesses cannot run on the manager host.
3. **Playwright not installed locally** —
   `ls src/physical-router-test-automation/node_modules/@playwright` → `No such file or directory`.
   Browser suites need `make setup` (~large npm install) before any run.
4. **`ssh dq05 'bash -s' <<'EOS'` heredoc silently did not reach the remote shell** — bash reported
   `EOS: command not found` and the inner commands executed against **cobrador's** filesystem
   (tell-tale: `timeout: failed to run command '/home/c08r4d0r/emulator-harness.sh': No such file`).
   Workaround that worked: `write_file` locally → `scp` to dq05 → `ssh dq05 'bash /path/script'`.
   Use scp'd scripts for anything multi-line on dq05.
5. **dq05 full-tree `find` times out** on a 390 GB / 88 %-full disk with load 13 —
   `find /home/c03rad0r …` exceeded a 200 s budget. Every dq05 search had to be depth-bounded.
6. **DQ05 resource contention** — load average 11–13 on 4 cores, 88 % disk used, available RAM
   4920 MB with the 1.62 GB guest already resident. Any guest-driving run must be graded against
   that (the skill's precondition is host 1-min load < ~4).
7. **`/tmp/u2_probe.py` missing on dq05** —
   `ls -l /tmp/u2_probe.py` → `No such file or directory`. Known post-reboot class; the WhatsApp
   driver would die instantly. Reinstall from repo source before any run that shells `U2_PROBE`.
8. **Canonical emulator-harness repo copy absent** — `ls -d ~/repos/nosms` on dq05 →
   `No such file or directory` (same on cobrador). Only dq05's possibly-drifted
   `~/emulator-harness.sh` is usable; the skill's "scp the repo copy over it" step is not executable.
9. **`deploy-portal-e2e-v4/v5.sh` absent** — no such file under `~/repos` / `~/worktrees` on either
   host (fork branch `host-alpha5-apk` not checked out). Its no-router Alpine harness knowledge
   survives only in skill references.
10. **No router reachability at all** — §4. This is not a fault to fix in this task; the physical
    rail needs a segment carrying `192.168.1.0/24` (or an SSH uplink) before anything can be measured.

### Read-only compliance note
Nothing was flashed/installed/rebooted/reconfigured; no process was killed; no tracked file was
modified (`git -C ~/repos/cvm-registry status --porcelain` → clean). The emulator was deliberately
**not** driven. To probe dq05 I did `scp` three small read-only scripts into
`/home/c03rad0r/` (`_probe_ro.sh`, `_p2.sh`, `_p3.sh`) and ran them; they are new files in the home
directory, not part of any repo, and were removed after the run.
