#!/bin/sh
# Offline test (invariant 5 / D7): NO admin port is in nodogsplash's pre-auth
# allow list on ANY path of packaging/files/etc/uci-defaults/92-tollgate-admin-setup,
# in EITHER mapping mode.
#
# Why this repo needs its own copy of the guard: the module's
# tests/packaging/admin-board-not-guest-reachable_test.sh covers the module half,
# but 92 is a GITIGNORED BUILD PRODUCT in the module tree — the copy that ships
# is this repo's. And 92 is exactly the writer that runs where the module's 99
# does not: 99's nodogsplash reconciliation belongs to its FULL setup pass
# (first boot / setup-version change), which an apk upgrade SKIPS. So a router
# upgraded from a build whose 92 wrote `allow tcp port 8090` keeps that entry
# unless 92 itself takes it out. The pre-auth list must never be the first hole
# (the packet-filter drop is the second layer, not the first).
#
# The legacy defect, read from portal origin/main:
#     for port in 8090 8443; do
#         uci add_list nodogsplash.@nodogsplash[0].users_to_router="allow tcp port $port"
#     done
# Under the mapping decision those ports are, in one mode or the other, LuCI's
# or the board's admin login — so the block is deleted AND every admin port is
# removed from the list, on every path.
#
# Shape: whole-script sandbox (see lib-92-sandbox.sh). Nothing outside a private
# temp dir is read or written; no root, no network. The shipped script is never
# executed (only a rewritten copy is) and is parsed with `sh -n` first.
#
# Usage: sh packaging/tests/test-92-nodogsplash-pre-auth-guard.sh [path-to-script]
# Exits non-zero if any case fails.

set -u

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SCRIPT=${1:-"$HERE/../files/etc/uci-defaults/92-tollgate-admin-setup"}

if [ ! -f "$SCRIPT" ]; then
    echo "FAIL: shipped script not found: $SCRIPT" >&2
    exit 2
fi
if ! sh -n "$SCRIPT"; then
    echo "FAIL: sh -n rejected $SCRIPT" >&2
    exit 2
fi

TMP=$(mktemp -d "${TMPDIR:-/tmp}/tg-92-nodogsplash.XXXXXX") || exit 2
trap 'rm -rf "$TMP"' EXIT INT TERM

# shellcheck source=lib-92-sandbox.sh
. "$HERE/lib-92-sandbox.sh"
sb_init "$TMP" "$SCRIPT"

for p in /etc/shadow /etc/init.d/rpcd /etc/init.d/uhttpd /proc/net/tcp \
         /proc/net/tcp6 /www/tollgate /etc/uhttpd.crt /etc/uhttpd.key \
         /usr/bin/tollgate /etc/tollgate/; do
    n_raw=$(grep -o -F -- "$p" "$SB_SCRIPT" | wc -l | tr -d ' ')
    n_ok=$(grep -o -F -- "$SB_TMP$p" "$SB_SCRIPT" | wc -l | tr -d ' ')
    if [ "$n_raw" != "$n_ok" ]; then
        echo "FAIL: $p survives unrewritten ($n_raw raw vs $n_ok under \$TMP) — the test could reach the host" >&2
        exit 2
    fi
done

REC="nodogsplash.@nodogsplash[0].users_to_router"

# A fixture section that carries legitimate GUEST pre-auth entries plus the
# legacy admin entries a pre-change 92 would have left behind. The guest entries
# must SURVIVE (a repair that swept the whole list would lock the paying guest
# out of the portal); the admin entries must NOT.
seed_preauth() {
    printf 'nodogsplash.@nodogsplash[0]=nodogsplash\n' >> "$SB_STATE"
    printf '%s=allow tcp port 2050\n' "$REC" >> "$SB_STATE"   # captive portal
    printf '%s=allow udp port 67\n' "$REC" >> "$SB_STATE"     # dhcp
    printf '%s=allow tcp port 8090\n' "$REC" >> "$SB_STATE"   # legacy board
    printf '%s=allow tcp port 8443\n' "$REC" >> "$SB_STATE"   # legacy board TLS
}

# The assertion: no admin port survives in the pre-auth list.
admin_preauth="$(printf '%s' "$REC")"

echo "== 92-tollgate-admin-setup: no admin port in the pre-auth allow list (D7) =="
echo "script: $SCRIPT"
echo

# (a) board mode, after the run: no admin port in the list; guest entries kept.
sb_reset
sb_config board
sb_shadow set
sb_certs provisioned
sb_coverage not-covering
sb_proc
seed_preauth
sb_run
offending=$(sb_users_to_router)
ok=0
if [ -z "$offending" ] &&
   sb_has "$REC" 'allow tcp port 2050' &&
   sb_has "$REC" 'allow udp port 67'; then
    ok=1
fi
sb_report "(a) board mode: no admin port in users_to_router; guest entries survive" "$ok"
[ "$ok" = 1 ] || { echo "offending: $offending" >&2; sed -n '1,40p' "$SB_STATE" >&2; cat "$SB_STDERR" >&2; }

# (b) luci mode: the same, on today's mapping.
sb_reset
sb_config luci
sb_shadow set
sb_certs provisioned
sb_coverage not-covering
sb_proc
seed_preauth
sb_run
offending=$(sb_users_to_router)
ok=0
if [ -z "$offending" ] &&
   sb_has "$REC" 'allow tcp port 2050' &&
   sb_has "$REC" 'allow udp port 67'; then
    ok=1
fi
sb_report "(b) luci mode: no admin port in users_to_router; guest entries survive" "$ok"
[ "$ok" = 1 ] || { echo "offending: $offending" >&2; sed -n '1,40p' "$SB_STATE" >&2; }

# (c) the REFUSED path (fail-closed on the root credential) is still a path:
#     it must not add an admin port either.
sb_reset
sb_config board
sb_shadow empty
sb_certs provisioned
sb_coverage not-covering
sb_proc
seed_preauth
sb_run
offending=$(sb_users_to_router)
ok=0
if [ -z "$offending" ]; then ok=1; fi
sb_report "(c) refused path: no admin port in users_to_router" "$ok"
[ "$ok" = 1 ] || { echo "offending: $offending" >&2; sed -n '1,40p' "$SB_STATE" >&2; }

# (d) negative control: the checker must actually catch the legacy entry, or
#     cases (a)-(c) could pass on a checker that never fires.
sb_reset
printf '%s=allow tcp port 8090\n' "$REC" >> "$SB_STATE"
ok=0
if [ -n "$(sb_users_to_router)" ]; then ok=1; fi
sb_report "(d) control: the checker flags a legacy 'allow tcp port 8090' entry (assertions are not vacuous)" "$ok"

# (e) static: the ADD block is gone, and the script never adds to the pre-auth
#     list from anywhere.
ok=0
if ! grep -q -F 'for port in 8090 8443' "$SCRIPT" &&
   ! grep -E -q 'add_list[^|]*users_to_router' "$SCRIPT"; then
    ok=1
fi
sb_report "(e) static: no add_list into users_to_router anywhere in the script" "$ok"
[ "$ok" = 1 ] || grep -n 'users_to_router' "$SCRIPT" >&2

# (f) static: every admin port is named in the removal, so a mode flip cannot
#     leave one behind. The ports are listed in a `for port in ...` loop.
ok=0
if grep -E -q 'del_list[^|]*users_to_router' "$SCRIPT"; then
    list=$(grep -o 'for port in [0-9 ][0-9 ]*' "$SCRIPT" | head -n 1 | sed 's/for port in //')
    n=0
    for port in 8080 443 8090 8443; do
        case " $list " in
            *" $port "*) n=$((n + 1)) ;;
        esac
    done
    [ "$n" = 4 ] && ok=1
fi
sb_report "(f) static: the removal names all four admin ports (8080/443/8090/8443)" "$ok"

sb_summary
