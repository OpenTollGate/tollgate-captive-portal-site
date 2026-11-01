# Per-uplink Internet probe

This small Linux helper supplies the interface-bound HTTP tracking method in the
TollGate-owned mwan3 integration. It uses only Go's standard library; it does not
change routes, interfaces, wireless credentials, firewall rules or service state.

```sh
/usr/libexec/tollgate/uplink-probe --interface wwan --target 1
```

The interface is restricted to `wan`, `wwan`, `wan6` or `wwan6`. Target `1` is
Google's `connectivitycheck.gstatic.com/generate_204`; target `2` is Cloudflare's
`cp.cloudflare.com/generate_204`. There are no arbitrary URL, command, device,
DNS-server or output-path flags. Both endpoints use HTTP intentionally so a
redirect or substituted login page fails the expected response check.

The helper reads only `up`, `l3_device`, address and DNS metadata from the fixed
netifd interface-status RPC. A usable source address must be available in the
selected family. Link-local IPv6 alone does not establish Internet connectivity.
For DNS and HTTP separately, every socket binds the reported device and source
address and sets mwan3's `MMX_DEFAULT` mark `0x3f00`. This mark must match the
integration's fixed `mmx_mask`; a different mwan3 profile is not supported.
Do not apply the dynamically linked mwan3 `LD_PRELOAD` wrapper to this static Go
binary; it performs those operations itself and treats binding failure as failure.

DNS uses up to two nonlocal per-interface DHCP DNS servers. Explicit
Cloudflare/Google DNS servers in the tested address family are used only when
the interface advertised no usable DNS server. Supplied but broken DHCP DNS is
a failed check; public DNS cannot conceal that failure. Each attempt has a
650 ms budget. System DNS server addresses, search suffixes, local dnsmasq,
proxy environment settings and another uplink cannot supply a silent fallback.
IPv4 and IPv6 are probed independently. Venues that block these DNS services or
both connectivity endpoints can produce a conservative failure despite other
Internet access working; no finite connectivity test proves every destination.

The entire invocation, including ubus, DNS and HTTP, has a four-second deadline.
HTTP follows no redirects, carries no authentication or cookies and accepts only
an empty `204` response. A non-204 response is `captive-or-blocked`, not proof that
a captive portal was positively identified.

Each invocation writes a small JSON result to stdout:

```json
{"ok":true,"reason":"ok"}
```

Exit `0` means the probe passed, `1` means unhealthy/unavailable and `2` means
invalid arguments. Reasons include `link-down`, `no-address`, `no-dns`,
`captive-or-blocked`, `no-http` and `unavailable`. The optional diagnostic record
at `/var/run/tollgate-uplink-probe/INTERFACE-TARGET.json` also contains the
interface, target number and Unix `checked_at`; no IP address, DNS answer,
response body or credential is persisted. Records are atomically replaced and
are not authoritative without the routing engine's current running state.

Build and test from this directory with Go 1.23 or newer:

```sh
go test -race ./...
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -trimpath -ldflags='-s -w' -o build/uplink-probe-arm64 .
```

Use the router's actual Go architecture for other targets. The arm64 binary is
appropriate for the Beryl AX's aarch64 firmware; it must not be installed on
MIPS or 32-bit ARM hardware. Run the probe as root for the socket mark/device
operations. Build artifacts under `build/` are ignored and are not source files.

Tests use local UDP DNS and HTTP servers, injected socket-control callbacks and
fixed metadata fixtures. They establish protocol/family/binding invocation,
redirect/status/body rejection, bounded timeout and no global resolver/proxy
fallback. Physical WAN failure, per-uplink public reachability and actual policy
selection must also be verified on the target router.
