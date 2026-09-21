#!/bin/sh
# Regression harness for the LuCI HTTP->HTTPS redirect guard in
# packaging/files/etc/uci-defaults/92-tollgate-admin-setup.
#
# Background: 92-tollgate-admin-setup used to enable uhttpd.main.redirect_https
# whenever /etc/uhttpd.crt and /etc/uhttpd.key existed. uhttpd.main's OWN TLS
# listener (listen_https on :443) is configured only by the module's
# 99-tollgate-setup, which runs a FULL setup pass on first boot / setup-version
# change only - an apk upgrade takes its narrow branch. A router whose certs
# appeared after its last full setup therefore got a redirect to a :443 nothing
# was listening on, and LuCI on :8080 became unreachable (2026-09-21 pre13).
#
# How it works: the two guarded blocks are extracted VERBATIM from the shipped
# script by sentinel, ONLY the absolute paths they touch are rewritten into a
# private temp dir, a stub `uci` is put on PATH and the extracted text is run
# under POSIX sh.
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
        -e 's|/etc/uhttpd\.crt|@@CRT@@|g' \
        -e 's|/etc/uhttpd\.key|@@KEY@@|g' \
        -e 's|/proc/net/tcp6|@@TCP6@@|g' \
        -e 's|/proc/net/tcp|@@TCP@@|g' \
        -e 's|/etc/init\.d/uhttpd|@@INIT@@|g' |
        sed \
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

# No un-rewritten absolute path may survive.
assert_rewritten() {
    raw=$1
    tgt=$2
    n_raw=$(grep -o -F "$raw" "$BLOCK_A" "$BLOCK_B" | wc -l | tr -d ' ')
    n_tgt=$(grep -o -F "$tgt" "$BLOCK_A" "$BLOCK_B" | wc -l | tr -d ' ')
    if [ "$n_raw" -eq 0 ] || [ "$n_raw" -ne "$n_tgt" ]; then
        echo "FAIL: path not fully rewritten: $raw ($n_raw raw vs $n_tgt rewritten)" >&2
        exit 2
    fi
}

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
        sh "$BLOCK_A"
}

run_block_b() {
    PATH="$BIN:$PATH" UCI_STATE="$UCI_STATE" RESTART_LOG="$RESTART_LOG" \
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

echo "== 92-tollgate-admin-setup: LuCI redirect guard =="
echo "script:  $SCRIPT"
echo "blocks:  $(wc -l < "$BLOCK_A" | tr -d ' ') lines (guard) + $(wc -l < "$BLOCK_B" | tr -d ' ') lines (fail-open)"
echo

# --- GUARD (not a case): the fail-open check must not be vacuous. The same
# block, with a real :443 LISTEN socket present, must LEAVE the redirect on and
# must not restart uhttpd. Without this, case (d) could pass on a broken check.
state_reset
certs_on
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

# (a) readable, non-empty cert+key AND a configured uhttpd.main.listen_https.
state_reset
certs_on
state_set uhttpd.main.listen_https '0.0.0.0:443 [::]:443'
state_set uhttpd.main.redirect_https 0
run_block_a
ok=0
if [ "$(state_get uhttpd.main.redirect_https)" = "1" ]; then ok=1; fi
report "(a) cert+key present + listen_https configured -> redirect_https=1" "$ok"

# (b) cert+key present but listen_https empty -> must NOT redirect.
#     Starts at a stale 1, so a no-op would fail.
state_reset
certs_on
state_set uhttpd.main.listen_https ''
state_set uhttpd.main.redirect_https 1
run_block_a
ok=0
if [ "$(state_get uhttpd.main.redirect_https)" = "0" ]; then ok=1; fi
report "(b) cert+key present but listen_https empty -> redirect_https=0" "$ok"

# (c) no cert files, stale redirect_https=1 -> repaired.
state_reset
certs_off
state_set uhttpd.main.listen_https '0.0.0.0:443 [::]:443'
state_set uhttpd.main.redirect_https 1
run_block_a
ok=0
if [ "$(state_get uhttpd.main.redirect_https)" = "0" ]; then ok=1; fi
report "(c) no cert files, stale redirect_https=1 -> redirect_https=0" "$ok"

# (d) redirect enabled but no :443 LISTEN socket -> fail open + restart.
state_reset
certs_on
state_set uhttpd.main.listen_https '0.0.0.0:443 [::]:443'
state_set uhttpd.main.redirect_https 1
proc_without_443
run_block_b
ok=0
if [ "$(state_get uhttpd.main.redirect_https)" = "0" ] &&
   [ "$(wc -l < "$RESTART_LOG" | tr -d ' ')" -ge 1 ]; then
    ok=1
fi
report "(d) no :443 LISTEN socket -> fail-open sets 0 and restarts uhttpd" "$ok"

echo
echo "-- $pass passed, $fail failed --"
if [ "$fail" -ne 0 ]; then
    exit 1
fi
exit 0
