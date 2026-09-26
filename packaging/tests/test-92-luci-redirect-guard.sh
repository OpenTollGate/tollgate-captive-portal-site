#!/bin/sh
# Regression harness for the LuCI HTTP->HTTPS redirect guard in
# packaging/files/etc/uci-defaults/92-tollgate-admin-setup.
#
# Background - two incidents, one option:
#
# 2026-09-21 (pre13): 92-tollgate-admin-setup used to enable
# uhttpd.main.redirect_https whenever /etc/uhttpd.crt and /etc/uhttpd.key
# existed. uhttpd.main's OWN TLS listener (listen_https on :443) is configured
# only by the module's 99-tollgate-setup, which runs a FULL setup pass on first
# boot / setup-version change only - an apk upgrade takes its narrow branch. A
# router whose certs appeared after its last full setup therefore got a redirect
# to a :443 nothing was listening on, and LuCI on :8080 became unreachable.
# That added condition 1: a listener must be configured.
#
# 2026-09-26 (pre17, bench MT3000): a router with a LIVE :443 still could not be
# logged into. The certificate behind it was the OpenWrt image's placeholder
# (subject CN=OpenWrt, SAN DNS:OpenWrt), which satisfies every existence check
# while covering neither the router's hostname nor its LAN IP - so
# http://192.168.1.1:8080/ answered `307 https://192.168.1.1/` and the browser
# showed a hard certificate error. That added condition 2: the identity on the
# listener must COVER this router, delegated to the module's own check
# (`tollgate ssl covers`), failing CLOSED when that CLI is unusable.
#
# How it works: the two guarded blocks are extracted VERBATIM from the shipped
# script by sentinel, ONLY the absolute paths they touch are rewritten into a
# private temp dir, a stub `uci` and a stub `tollgate` are put on PATH and the
# extracted text is run under POSIX sh.
#
# Safety: nothing outside the temp dir is read or written; no root, no network;
# the shipped script itself is never executed (only parsed with `sh -n`, which
# executes nothing).
#
# Usage: sh packaging/tests/test-92-luci-redirect-guard.sh [path-to-script]
# Exits non-zero if any case fails.

set -u

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SCRIPT=${1:-"$HERE/../files/etc/uci-defaults/92-tollgate-admin-setup"}

if [ ! -f "$SCRIPT" ]; then
    echo "FAIL: shipped script not found: $SCRIPT" >&2
    exit 2
fi

TMP=$(mktemp -d "${TMPDIR:-/tmp}/tg-92-guard.XXXXXX") || exit 2
trap 'rm -rf "$TMP"' EXIT INT TERM

BIN="$TMP/bin"
CERT_CRT="$TMP/etc/uhttpd.crt"
CERT_KEY="$TMP/etc/uhttpd.key"
CLI="$BIN/tollgate"
CLI_LOG="$TMP/cli.invocations"
PROC_TCP="$TMP/proc/net/tcp"
PROC_TCP6="$TMP/proc/net/tcp6"
UHTTPD_INIT="$TMP/etc/init.d/uhttpd"
UCI_STATE="$TMP/uci.state"
RESTART_LOG="$TMP/uhttpd.restarts"
BLOCK_A="$TMP/block-a.sh"
BLOCK_B="$TMP/block-b.sh"

mkdir -p "$BIN" "$TMP/etc/init.d" "$TMP/proc/net"
: > "$UCI_STATE"
: > "$RESTART_LOG"
: > "$CLI_LOG"

# --- preconditions -----------------------------------------------------------

# The shipped script must parse. `sh -n` executes nothing.
if ! sh -n "$SCRIPT"; then
    echo "FAIL: sh -n rejected $SCRIPT" >&2
    exit 2
fi

# Rewrite ONLY the absolute paths the extracted blocks touch, so the code under
# test can never reach the live filesystem.
#
# Two passes via placeholders: a single sed pass is wrong here because the
# replacement for /proc/net/tcp6 ($TMP/proc/net/tcp6) itself contains
# /proc/net/tcp, so the later rule would re-match the text the earlier rule just
# inserted and produce a doubled, nonexistent path.
rewrite_paths() {
    sed \
        -e 's|/usr/bin/tollgate|@@CLI@@|g' \
        -e 's|/etc/uhttpd\.crt|@@CRT@@|g' \
        -e 's|/etc/uhttpd\.key|@@KEY@@|g' \
        -e 's|/proc/net/tcp6|@@TCP6@@|g' \
        -e 's|/proc/net/tcp|@@TCP@@|g' \
        -e 's|/etc/init\.d/uhttpd|@@INIT@@|g' |
        sed \
            -e "s|@@CLI@@|$CLI|g" \
            -e "s|@@CRT@@|$CERT_CRT|g" \
            -e "s|@@KEY@@|$CERT_KEY|g" \
            -e "s|@@TCP6@@|$PROC_TCP6|g" \
            -e "s|@@TCP@@|$PROC_TCP|g" \
            -e "s|@@INIT@@|$UHTTPD_INIT|g"
}

sed -n '/^# LuCI (uhttpd.main :8080)/,/^fi$/p' "$SCRIPT" | rewrite_paths > "$BLOCK_A"
sed -n '/^# Fail open:/,/^fi$/p' "$SCRIPT" | rewrite_paths > "$BLOCK_B"

for b in "$BLOCK_A" "$BLOCK_B"; do
    if [ ! -s "$b" ]; then
        echo "FAIL: sentinel extraction produced an empty block ($b)" >&2
        exit 2
    fi
done

# No un-rewritten absolute path may survive. A path that is simply ABSENT from
# this script has nothing to rewrite and is reported as such (the harness is also
# pointed at pre-change revisions by hand to prove it goes red).
assert_rewritten() {
    raw=$1
    tgt=$2
    n_raw=$(grep -o -F "$raw" "$BLOCK_A" "$BLOCK_B" | wc -l | tr -d ' ')
    n_tgt=$(grep -o -F "$tgt" "$BLOCK_A" "$BLOCK_B" | wc -l | tr -d ' ')
    if [ "$n_raw" -eq 0 ]; then
        echo "note:    $raw is not referenced by this revision (nothing to rewrite)"
        return 0
    fi
    if [ "$n_raw" -ne "$n_tgt" ]; then
        echo "FAIL: path not fully rewritten: $raw ($n_raw raw vs $n_tgt rewritten)" >&2
        exit 2
    fi
}

assert_rewritten "/usr/bin/tollgate" "$CLI"
assert_rewritten "/etc/uhttpd.crt" "$CERT_CRT"
assert_rewritten "/etc/uhttpd.key" "$CERT_KEY"
assert_rewritten "/proc/net/tcp" "$PROC_TCP"
assert_rewritten "/etc/init.d/uhttpd" "$UHTTPD_INIT"

# A doubled prefix (or an unsubstituted placeholder) would point the code under
# test at a nonexistent path; for the fail-open check that would silently take
# the "drop the redirect" branch, so it must be fatal here.
if grep -q -F "$TMP$TMP" "$BLOCK_A" "$BLOCK_B"; then
    echo "FAIL: doubled temp prefix in an extracted block" >&2
    exit 2
fi
if grep -q -F '@@' "$BLOCK_A" "$BLOCK_B"; then
    echo "FAIL: unsubstituted placeholder left in an extracted block" >&2
    exit 2
fi

# No absolute path outside the temp dir may survive in either block, /dev/null
# excepted (the code deliberately discards stderr there; it is not a redirect
# target and does not exist in the temp dir). The rewritten paths are all
# prefixed with $TMP, and the count check above proves no bare occurrence of a
# rewritten path is left either.
for b in "$BLOCK_A" "$BLOCK_B"; do
    stray=$(grep -o -E '(^|[^A-Za-z0-9._/-])/[A-Za-z0-9._/-]+' "$b" |
        sed -e 's|^[^/]*||' -e 's|/$||' |
        grep -v -F "$TMP" |
        grep -v -x -F '/dev/null' |
        sort -u)
    if [ -n "$stray" ]; then
        echo "FAIL: absolute path(s) survived rewriting in $b:" >&2
        echo "$stray" >&2
        exit 2
    fi
done

# --- stubs -------------------------------------------------------------------

# Stub `uci`: only the subset the extracted blocks use, backed by a flat
# key=value state file. `uci -q get <missing>` exits non-zero, as real uci does.
cat > "$BIN/uci" <<'STUB'
#!/bin/sh
STATE="$UCI_STATE"
case "$1" in
    -q) shift ;;
esac
cmd="$1"
if [ "$#" -gt 0 ]; then shift; fi

uci_get() {
    [ -f "$STATE" ] || return 1
    awk -v key="$1" '
        { eq = index($0, "=")
          if (eq > 0 && substr($0, 1, eq - 1) == key) { val = substr($0, eq + 1); found = 1 } }
        END { if (found) { print val; exit 0 } exit 1 }' "$STATE"
}

uci_set() {
    key=${1%%=*}
    val=${1#*=}
    [ -f "$STATE" ] || : > "$STATE"
    awk -v key="$key" '
        { eq = index($0, "=")
          if (eq > 0 && substr($0, 1, eq - 1) == key) next
          print }' "$STATE" > "$STATE.new" || exit 1
    mv "$STATE.new" "$STATE"
    printf '%s=%s\n' "$key" "$val" >> "$STATE"
}

case "$cmd" in
    get)    uci_get "$1" ;;
    set)    uci_set "$1" ;;
    commit) exit 0 ;;
    *)      exit 0 ;;
esac
STUB
chmod +x "$BIN/uci"

# Stub `tollgate` (the module's CLI): only `ssl covers <cert>` matters here.
# It records every invocation and its verdict is its EXIT STATUS - 0 = the
# certificate covers this router - which is the contract the shipped block
# branches on. $CLI_COVERS selects the verdict ("1" = covers, anything else =
# does not). The stub is created/removed per case so "no usable CLI" is a real
# state, not a simulated one.
make_cli_stub() {
    cat > "$CLI" <<'STUB'
#!/bin/sh
printf '%s\n' "$*" >> "$CLI_LOG"
[ "${1:-}" = "ssl" ] && [ "${2:-}" = "covers" ] || exit 64
[ "${CLI_COVERS:-0}" = "1" ] || exit 1
exit 0
STUB
    chmod +x "$CLI"
}

# Stub init script: records that it was called instead of touching uhttpd.
cat > "$UHTTPD_INIT" <<'STUB'
#!/bin/sh
printf '%s\n' "${1:-restart}" >> "$RESTART_LOG"
exit 0
STUB
chmod +x "$UHTTPD_INIT"

# --- helpers -----------------------------------------------------------------

state_reset() {
    : > "$UCI_STATE"
    printf 'uhttpd.main=uhttpd\n' >> "$UCI_STATE"
    : > "$RESTART_LOG"
    : > "$CLI_LOG"
}

state_set() { # key value
    awk -v key="$1" '
        { eq = index($0, "=")
          if (eq > 0 && substr($0, 1, eq - 1) == key) next
          print }' "$UCI_STATE" > "$UCI_STATE.new"
    mv "$UCI_STATE.new" "$UCI_STATE"
    printf '%s=%s\n' "$1" "$2" >> "$UCI_STATE"
}

state_get() { # key -> value (empty + non-zero if absent)
    awk -v key="$1" '
        { eq = index($0, "=")
          if (eq > 0 && substr($0, 1, eq - 1) == key) { val = substr($0, eq + 1); found = 1 } }
        END { if (found) { print val; exit 0 } exit 1 }' "$UCI_STATE"
}

certs_on() {
    printf 'CERTIFICATE-DATA\n' > "$CERT_CRT"
    printf 'PRIVATE-KEY-DATA\n' > "$CERT_KEY"
}

certs_off() {
    rm -f "$CERT_CRT" "$CERT_KEY"
}

# The identity uhttpd.main is configured with, as the module's setup leaves it:
# certificate and key options pointing into the temp dir.
main_identity_on() {
    state_set uhttpd.main.cert "$CERT_CRT"
    state_set uhttpd.main.key "$CERT_KEY"
}

# /proc/net/tcp fixture with a :443 (0x01BB) LISTEN socket present.
proc_with_443() {
    {
        printf '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n'
        printf '   0: 00000000:01BB 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 11111 1 0000000000000000 100 0 0 10 0\n'
        printf '   1: 00000000:1F9A 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 22222 1 0000000000000000 100 0 0 10 0\n'
    } > "$PROC_TCP"
    printf '  sl  local_address rem_address   st\n' > "$PROC_TCP6"
}

# /proc/net/tcp fixture with NO :443 LISTEN socket (only :8090 and :2051).
proc_without_443() {
    {
        printf '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n'
        printf '   0: 00000000:1F9A 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 22222 1 0000000000000000 100 0 0 10 0\n'
        printf '   1: 00000000:0803 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 33333 1 0000000000000000 100 0 0 10 0\n'
    } > "$PROC_TCP"
    printf '  sl  local_address rem_address   st\n' > "$PROC_TCP6"
}

run_block_a() {
    PATH="$BIN:$PATH" UCI_STATE="$UCI_STATE" RESTART_LOG="$RESTART_LOG" \
        CLI_LOG="$CLI_LOG" CLI_COVERS="${CLI_COVERS:-0}" \
        sh "$BLOCK_A"
}

run_block_b() {
    PATH="$BIN:$PATH" UCI_STATE="$UCI_STATE" RESTART_LOG="$RESTART_LOG" \
        CLI_LOG="$CLI_LOG" CLI_COVERS="${CLI_COVERS:-0}" \
        sh "$BLOCK_B"
}

pass=0
fail=0

report() { # label ok
    if [ "$2" = 1 ]; then
        echo "PASS: $1"
        pass=$((pass + 1))
    else
        echo "FAIL: $1"
        fail=$((fail + 1))
    fi
}

# The rule this guard REPLACED, written out as a function rather than read from
# git history (CI checks out at fetch-depth 1, so `git show main:<path>` is not
# available there - the setup-marker suite injects its pre-change predicate the
# same way). Existence + listener, no coverage: exactly the premise the
# 2026-09-26 bench defect came from. It exists so the coverage cases below have a
# negative control that proves the changed verdict is the guard doing work.
superseded_rule_says_redirect() {
    [ -r "$CERT_CRT" ] && [ -s "$CERT_CRT" ] &&
        [ -r "$CERT_KEY" ] && [ -s "$CERT_KEY" ] &&
        [ -n "$(state_get uhttpd.main.listen_https 2>/dev/null)" ]
}

echo "== 92-tollgate-admin-setup: LuCI redirect guard =="
echo "script:  $SCRIPT"
echo "blocks:  $(wc -l < "$BLOCK_A" | tr -d ' ') lines (guard) + $(wc -l < "$BLOCK_B" | tr -d ' ') lines (fail-open)"
echo

# --- the shipped block must DERIVE the value, not decide it itself -----------
# A revert to a premise of its own (the image's certificate merely existing, a
# configured listener alone) is caught here, before the state cases run, because
# a weaker rule can still agree with the shipped one on some particular state.
# These are REPORTED rather than fatal, so the harness also runs end-to-end
# against a pre-change revision and shows the semantic cases going red.
BLOCK_A_RAW=$(sed -n '/^# LuCI (uhttpd.main :8080)/,/^fi$/p' "$SCRIPT")
pre=0
if printf '%s\n' "$BLOCK_A_RAW" | grep -q 'ssl covers'; then pre=1; fi
report "(pre) the guard derives the value from the shared coverage check (tollgate ssl covers)" "$pre"

pre_paths=1
if printf '%s\n' "$BLOCK_A_RAW" | grep -q -F '[ -r /etc/uhttpd.crt ]'; then pre_paths=0; fi
if printf '%s\n' "$BLOCK_A_RAW" | grep -q -F '/etc/uhttpd.key'; then pre_paths=0; fi
report "(pre) the guard reads the CONFIGURED identity, not the image's fixed paths" "$pre_paths"
echo

# --- GUARD (not a case): the fail-open check must not be vacuous. The same
# block, with a real :443 LISTEN socket present, must LEAVE the redirect on and
# must not restart uhttpd. Without this, case (f) could pass on a broken check.
make_cli_stub
state_reset
certs_on
main_identity_on
state_set uhttpd.main.listen_https '0.0.0.0:443 [::]:443'
state_set uhttpd.main.redirect_https 1
proc_with_443
run_block_b
if [ "$(state_get uhttpd.main.redirect_https)" != "1" ] || [ "$(wc -l < "$RESTART_LOG" | tr -d ' ')" -ne 0 ]; then
    echo "GUARD FAIL: fail-open check fired despite a :443 LISTEN socket being present" >&2
    exit 2
fi
echo "guard:   :443 LISTEN present -> redirect kept at 1, no restart (fail-open not vacuous)"
echo

# (a) listener configured, identity installed, and the CLI says it COVERS this
#     router -> redirect armed. The CLI must actually have been consulted.
CLI_COVERS=1
state_reset
certs_on
main_identity_on
state_set uhttpd.main.listen_https '0.0.0.0:443 [::]:443'
state_set uhttpd.main.redirect_https 0
run_block_a
ok=0
if [ "$(state_get uhttpd.main.redirect_https)" = "1" ] &&
   grep -q '^ssl covers ' "$CLI_LOG"; then ok=1; fi
report "(a) listener configured + identity covers -> redirect_https=1 (coverage consulted)" "$ok"

# (b) THE DEFECT: listener configured, an identity is installed, but it does NOT
#     cover this router (the OpenWrt image placeholder) -> the redirect must stay
#     OFF. Starts at a stale 1, so a no-op fails the case.
CLI_COVERS=0
state_reset
certs_on
main_identity_on
state_set uhttpd.main.listen_https '0.0.0.0:443 [::]:443'
state_set uhttpd.main.redirect_https 1
old_verdict=0
superseded_rule_says_redirect && old_verdict=1
run_block_a
ok=0
if [ "$(state_get uhttpd.main.redirect_https)" = "0" ]; then ok=1; fi
report "(b) identity does NOT cover this router, stale redirect=1 -> redirect_https=0" "$ok"
if [ "$old_verdict" != 1 ]; then
    echo "FAIL: negative control is vacuous - the superseded rule does not even reach the defect state here" >&2
    exit 2
fi
echo "control: the superseded existence-only rule says 'redirect ON' on this exact state (the shipped defect)"

# (c) no usable CLI at all -> fail CLOSED (redirect off). Starts at a stale 1.
rm -f "$CLI"
CLI_COVERS=1
state_reset
certs_on
main_identity_on
state_set uhttpd.main.listen_https '0.0.0.0:443 [::]:443'
state_set uhttpd.main.redirect_https 1
run_block_a
ok=0
if [ "$(state_get uhttpd.main.redirect_https)" = "0" ]; then ok=1; fi
report "(c) no usable tollgate CLI, stale redirect=1 -> redirect_https=0 (fails closed)" "$ok"

# (d) identity covers, but no listener is configured -> must NOT redirect: the
#     hop would target a dead :443 (the 2026-09-21 pre13 lockout).
make_cli_stub
CLI_COVERS=1
state_reset
certs_on
main_identity_on
state_set uhttpd.main.listen_https ''
state_set uhttpd.main.redirect_https 1
run_block_a
ok=0
if [ "$(state_get uhttpd.main.redirect_https)" = "0" ]; then ok=1; fi
report "(d) identity covers but listen_https empty -> redirect_https=0" "$ok"

# (e) no cert files at all, stale redirect_https=1 -> repaired.
CLI_COVERS=1
state_reset
certs_off
state_set uhttpd.main.listen_https '0.0.0.0:443 [::]:443'
state_set uhttpd.main.redirect_https 1
run_block_a
ok=0
if [ "$(state_get uhttpd.main.redirect_https)" = "0" ]; then ok=1; fi
report "(e) no cert files, stale redirect_https=1 -> redirect_https=0" "$ok"

# (f) redirect enabled but no :443 LISTEN socket -> fail open + restart.
CLI_COVERS=1
state_reset
certs_on
main_identity_on
state_set uhttpd.main.listen_https '0.0.0.0:443 [::]:443'
state_set uhttpd.main.redirect_https 1
proc_without_443
run_block_b
ok=0
if [ "$(state_get uhttpd.main.redirect_https)" = "0" ] &&
   [ "$(wc -l < "$RESTART_LOG" | tr -d ' ')" -ge 1 ]; then
    ok=1
fi
report "(f) no :443 LISTEN socket -> fail-open sets 0 and restarts uhttpd" "$ok"

# (g) the value is written EXPLICITLY on every run, in both directions: a router
#     already at the derived value must be re-asserted (an omitted write would
#     leave the other writer's value in place).
CLI_COVERS=1
state_reset
certs_on
main_identity_on
state_set uhttpd.main.listen_https '0.0.0.0:443 [::]:443'
state_set uhttpd.main.redirect_https 0
run_block_a
first=$(state_get uhttpd.main.redirect_https)
run_block_a
second=$(state_get uhttpd.main.redirect_https)
ok=0
if [ "$first" = "1" ] && [ "$second" = "1" ]; then ok=1; fi
report "(g) idempotent: re-run keeps the derived value at 1" "$ok"

echo
echo "-- $pass passed, $fail failed --"
if [ "$fail" -ne 0 ]; then
    exit 1
fi
exit 0
