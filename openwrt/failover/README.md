# Owner Internet failover adapter

This is a fixed Ethernet-first, venue-Wi-Fi-backup profile for the reviewed
OpenWrt mwan3 2.12 engine. It is separate from TollGate's experimental multi-WAN
objective renderer, which is not a running failover controller.

Install `tollgate-failover` as `/usr/libexec/tollgate/failover` (0755). The parent
package/deployment installs the signed mwan3 dependencies, the bound Go probe at
`/usr/libexec/tollgate/uplink-probe` and the reviewed tracker extension produced
by `packaging/patch-mwan3-track.py`. The controller requires the exact extension
marker; a package upgrade without that integration becomes unsupported instead
of falling back to ping.

Before installing mwan3 for the first time, preserve the original router files,
verify there is no existing policy-routing owner, and place `mwan3.disabled` at
`/etc/config/mwan3`. Stop/disable any package-started mwan3 service before the
first enable. Stock mwan3 has no global disable option and can start general
hooks even when an empty profile defines no interfaces. Do not overwrite an
existing foreign configuration to satisfy this prerequisite.

The only accepted commands are `status`, `enable` and `disable`. The authenticated
RPC layer, not this script, supplies the browser's access control. All results
are JSON; read `success`, not process exit status. An action lock prevents duplicate
mutations. No caller-controlled file, shell fragment, interface or probe target
is accepted.

## Applied policy and health

The enabled profile contains WAN/WWAN IPv4 members with priorities 10/20, a
separate IPv6 WAN6-primary policy when that existing netifd interface is present,
and catch-all rules for both families. IPv6 Wi-Fi backup is deliberately unsupported:
router-bound probe success alone does not verify guest source-prefix routing across
providers, and this adapter does not enable NAT6 or modify the firewall. Even an
existing WWAN6 interface is not enrolled or assigned metrics. Its metadata remains
unavailable with an explicit unsupported reason. IPv6 is either healthy WAN6 or
blocked while IPv4 can use Wi-Fi. It creates no DHCPv6 interface. Each policy
has `last_resort unreachable`, so unverified IPv6 does not bypass the owner policy.
Health uses the bound DNS/HTTP method, two fixed target identifiers, reliability
one, count one, interval five seconds, three down/three up checks and initial
offline state. Probe duration adds to detection time; these numbers are not a
promise of an exact fifteen-second transition.

`status` reads official `ubus mwan3 status` interface/policy results and verifies
that the applied mangle catch-all selects the expected policy. It does not infer
effective routing from main-table metrics. A missing catch-all, unreadable engine,
unexpected weighted result or unsupported integration reports active `unknown`.
An empty or absent RPC policy reports `none` only when the independently read
kernel policy chain contains exactly the owned unreachable mark action, with no
other action. This handles stock rpcd omitting unquoted `unreachable` comments
without turning a missing policy into a false success. Otherwise it is unknown. IPv4 and IPv6 are independent.
Health is `online`, `offline`, `checking` or `unavailable`, with a bounded reason.
Link state is read separately from netifd and is `null` when not reported. This
avoids reporting a failed status read as a disconnected cable.

NoDogSplash marks must be disjoint from mwan3's `0x3f00` mask. Enabled bonding,
active PBR intent, unsaved network edits, foreign low routing tables/rules, profile
hash drift or overlapping packet-mark assignments block mutation. The rule/table
check also runs before disable because stock mwan3 stop flushes tables 1–250 and
rules 1000–3999; pre-existing routing owners must not be erased by cleanup.

## Persistence, failures and recovery

The first enable preserves the exact original network file under the root-only
`/etc/tollgate/failover/network.before`, mode 0600, with its SHA-256. This is an
audit-only backup. The controller never writes, commits or restores any netifd
network setting, even during a partial failure. It never reloads netifd or brings
interfaces down.

Enable requires existing distinct numeric WAN/WWAN main-route metrics (unset is
zero). Equal or invalid values produce clear LuCI guidance before applying the
profile. Those values need not prefer Ethernet: mwan3's own member priorities
10/20 select Ethernet first independently. This avoids pretending a saved UCI
metric changed the live netifd cache or introducing a disruptive network reload.

Disable verifies ownership, stops/disables only mwan3, and writes the owned
disabled profile. Ordinary routing then follows the unchanged network setup,
including any operator changes made while failover was enabled. An operator's
metric edit does not need to equal 10/20 and is never overwritten. Edits to the
generated mwan3 profile still require review rather than being erased.

The ownership guard recognizes only verified native IPv6 reject-only netifd
rules outside mwan3's cleanup range: a per-device `failed_policy` at priority
4200000000 plus its verified kernel ifindex, and the delegated-prefix
`unreachable` guard at exact priority 4200000000 on an existing device. Both word and numeric action formats from `ip-full -N` are recognized
(`failed_policy`/12, `unreachable`/7; owned mwan3 blackhole is 6). The exact
priority/mark pair remains checked. No lookup, mark, goto or extra selector is
allowed on native reject guards. Routing ownership reads use numeric ip-full output so a table-name alias cannot
hide a protected low table. Other foreign policy rules and low routing tables
remain blockers. This does not qualify physical IPv6
delegation or guest behavior, which still need hardware acceptance.

Before a mutation, a durable pending receipt is written. Partial failures return
`success:false`, retain the receipt and current configured/running facts, and do
not automatically repeat or promise rollback. A stopped controller with an enabled
profile is not reported as a successful idempotent enable. Inspect the state and
use an explicit disable/review workflow; incomplete backups, uncommitted UCI state or conflicting external edits require operator recovery. A pending
receipt is also visible through the status error field.

No action explicitly reloads firewall/netifd or restarts TollGate/NoDogSplash.
Changing uplinks can interrupt existing connections because the external address
changes; this is not MPTCP and does not preserve arbitrary TCP sessions.

## Tests

Run `python3 packaging/tests/test-failover-controller.py` from the repository root.
The harness executes this driver against temporary files and stubbed commands,
covering ownership, profiles, per-family applied policies, unknown reads, mark/
route conflicts, unchanged network bytes/metrics through complete and partial cycles, no network restore,
partial failures, duplicate locks and unsupported tracker upgrades. It makes no
real router or host routing changes. Physical carrier loss, WAN Internet outage
with carrier present, venue captive login, IPv6 delegation and recovery remain
hardware acceptance checks for the deployment owner.


## Contribution and hardware acceptance scope

This is an opt-in integration candidate. The portal package does not yet install
mwan3, compile/install this architecture-specific probe, or replace the tracker.
Without that integration the admin reports the capability as unavailable and
leaves enablement disabled. The instructions above describe the explicit
installation boundary; merging these source files does not activate failover on
existing routers. Package ownership and a firmware-upgrade migration need
maintainer review before enabling this in a managed release.

A limited GL-MT3000/OpenWrt 25.12.6 check verified real Ethernet selection with
Wi-Fi healthy in standby. A temporary WAN-only public-traffic block kept carrier
up, triggered Wi-Fi fallback with working router internet, and removal restored
Ethernet priority. The temporary rules and independent timed cleanup guard were
removed. Ordinary configuration/guest-portal hashes and TollGate/NoDogSplash
process IDs were preserved. The phone-sized admin displayed the final Ethernet
selection and Wi-Fi readiness correctly.

This local outage simulation does not qualify physical unplug/replug, an
externally induced ISP outage, IPv6 delegation, real venue login, client
throughput, guest billing or uninterrupted existing sessions.
