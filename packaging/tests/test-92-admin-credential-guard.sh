#!/bin/sh
# Regression harness for the FAIL-CLOSED credential decision in
# packaging/files/etc/uci-defaults/92-tollgate-admin-setup.
#
# Background: rpc_login_test_password() (rpcd/session.c) returns TRUE when
# root's /etc/shadow hash is empty, so `ubus session.login` accepts ANY password
# — including "" — and the session it returns carries the :8090 board's ACL
# (file exec, system.password_set, wallet_drain_cashu). A router in that state
# (a fresh OpenWrt; a deploy that was not given a password) must not serve the
# board at all. This harness proves the shipped script removes the listeners
# instead of serving them, and that a router with a real credential still gets
# the board.
#
# How it works: the fail-closed decision block AND the listener block are
# extracted VERBATIM from the shipped script by sentinel, ONLY the absolute
# paths they touch are rewritten into a private temp dir, a stub `uci` is put on
# PATH, and the two blocks are run together under POSIX sh. The extracted
# decision block defines the functions/variables the listener block reads, so
# both must run in the SAME shell (they are concatenated into one file).
#
# Safety: nothing outside the temp dir is read or written; no root, no network;
# the shipped script itself is never executed (only parsed with `sh -n`, which
# executes nothing).
#
# Usage: sh packaging/tests/test-92-admin-credential-guard.sh [path-to-script]
# Exits non-zero if any case fails.

set -u

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SCRIPT=${1:-"$HERE/../files/etc/uci-defaults/92-tollgate-admin-setup"}

if [ ! -f "$SCRIPT" ]; then
    echo "FAIL: shipped script not found: $SCRIPT" >&2
    exit 2
fi

TMP=$(mktemp -d "${TMPDIR:-/tmp}/tg-92-cred.XXXXXX") || exit 2
trap 'rm -rf "$TMP"' EXIT INT TERM

BIN="$TMP/bin"
CERT_CRT="$TMP/etc/uhttpd.crt"
CERT_KEY="$TMP/etc/uhttpd.key"
SHADOW="$TMP/etc/shadow"
UCI_STATE="$TMP/uci.state"
BLOCK="$TMP/guard.sh"

mkdir -p "$BIN" "$TMP/etc"
: > "$UCI_STATE"

# --- preconditions -----------------------------------------------------------

if ! sh -n "$SCRIPT"; then
    echo "FAIL: sh -n rejected $SCRIPT" >&2
    exit 2
fi

rewrite_paths() {
    sed \
        -e 's|/etc/uhttpd\.crt|@@CRT@@|g' \
        -e 's|/etc/uhttpd\.key|@@KEY@@|g' |
        sed \
            -e "s|@@CRT@@|$CERT_CRT|g" \
            -e "s|@@KEY@@|$CERT_KEY|g"
}

# The decision block runs from its sentinel to the (unindented) `esac` that
# closes its case statement; the function it defines has an INDENTED `esac`, so
# the range cannot stop early. The listener block runs from its
# ADMIN_BOARD_ALLOWED guard to the (unindented) `fi` that closes it; the inner
# cert check has an INDENTED `fi`.
sed -n '/^# ─── FAIL CLOSED/,/^esac$/p' "$SCRIPT" | rewrite_paths > "$BLOCK"
sed -n '/^if \[ "\$ADMIN_BOARD_ALLOWED" = "1" \]; then$/,/^fi$/p' "$SCRIPT" |
    rewrite_paths >> "$BLOCK"

if [ ! -s "$BLOCK" ]; then
    echo "FAIL: sentinel extraction produced an empty block" >&2
    exit 2
fi

# Every piece the block needs must actually be there; a silent extraction miss
# would otherwise turn every case below into a tautology.
for needle in \
    'root_hash_state' \
    'ADMIN_BOARD_ALLOWED=0' \
    "uci add_list uhttpd.admin.listen_http='0.0.0.0:8090'"
do
    if ! grep -F -q -- "$needle" "$BLOCK"; then
        echo "FAIL: extracted block is missing '$needle' (sentinel drift?)" >&2
        exit 2
    fi
done

# No un-rewritten path may survive, /dev/null excepted (stderr discard, not a
# redirect target), /etc/shadow excepted (it is only the DEFAULT of
# $TOLLGATE_SHADOW_FILE — the harness always sets the override) and
# /etc/config/rpcd excepted (it appears in the explanatory comment only; the
# extracted code never touches it).
stray=$(grep -o -E '(^|[^A-Za-z0-9._/-])/[A-Za-z0-9._/-]+' "$BLOCK" |
    sed -e 's|^[^/]*||' -e 's|/$||' |
    grep -v -F "$TMP" |
    grep -v -x -F '/dev/null' |
    grep -v -x -F '/etc/shadow' |
    grep -v -x -F '/etc/config/rpcd' |
    sort -u)
if [ -n "$stray" ]; then
    echo "FAIL: absolute path(s) survived rewriting:" >&2
    echo "$stray" >&2
    exit 2
fi

if grep -q -F '@@' "$BLOCK"; then
    echo "FAIL: unsubstituted placeholder left in the extracted block" >&2
    exit 2
fi

# --- stubs -------------------------------------------------------------------

cat > "$BIN/uci" <<'STUB'
#!/bin/sh
STATE="${UCI_STATE}"
LOG="${UCI_LOG:-/dev/null}"
printf '%s\n' "$*" >> "$LOG"
while [ "${1:-}" = "-q" ]; do shift; done
cmd="${1:-}"
[ "$#" -gt 0 ] && shift
key="${1%%=*}"
val="${1#*=}"

case "$cmd" in
    get)
        [ -f "$STATE" ] || exit 1
        found=0
        while IFS= read -r line; do
            case "$line" in
                "$key="*) printf '%s ' "${line#*=}"; found=1 ;;
            esac
        done < "$STATE"
        [ "$found" = 1 ] && { echo; exit 0; }
        exit 1
        ;;
    set)
        grep -v -F -- "$key=" "$STATE" 2>/dev/null > "$STATE.tmp" || : > "$STATE.tmp"
        printf '%s=%s\n' "$key" "$val" >> "$STATE.tmp"
        mv "$STATE.tmp" "$STATE"
        ;;
    add_list)
        grep -F -x -- "$key=$val" "$STATE" >/dev/null 2>&1 || printf '%s=%s\n' "$key" "$val" >> "$STATE"
        ;;
    del_list)
        grep -v -F -x -- "$key=$val" "$STATE" > "$STATE.tmp" 2>/dev/null || : > "$STATE.tmp"
        mv "$STATE.tmp" "$STATE"
        ;;
    delete)
        grep -v -F -- "$key=" "$STATE" 2>/dev/null > "$STATE.tmp" || : > "$STATE.tmp"
        mv "$STATE.tmp" "$STATE"
        ;;
    # An unhandled verb is a NO-OP: a `*)` fall-through would make every
    # assertion about that verb a tautology, so the verbs the block uses are
    # enumerated above and anything else is reported.
    commit) : ;;
    *)
        echo "stub uci: unexpected verb '$cmd'" >&2
        exit 9
        ;;
esac
exit 0
STUB
chmod +x "$BIN/uci"

# --- helpers -----------------------------------------------------------------

state_reset() {
    : > "$UCI_STATE"
    printf 'uhttpd.admin=uhttpd\n' >> "$UCI_STATE"
    : > "$TMP/uci.log"
}

state_set() { # key value
    grep -v -F -- "$1=" "$UCI_STATE" 2>/dev/null > "$UCI_STATE.tmp" || : > "$UCI_STATE.tmp"
    printf '%s=%s\n' "$1" "$2" >> "$UCI_STATE.tmp"
    mv "$UCI_STATE.tmp" "$UCI_STATE"
}

state_has() { # key value -> 0 when present
    grep -F -x -q -- "$1=$2" "$UCI_STATE"
}

shadow_empty()  { printf 'root::0:0:99999:7:::\n' > "$SHADOW"; }
shadow_locked() { printf 'root:!:0:0:99999:7:::\n' > "$SHADOW"; }
shadow_set()    { printf 'root:$1$abc$defghijklmnop:0:0:99999:7:::\n' > "$SHADOW"; }
shadow_gone()   { rm -f "$SHADOW"; }

certs_on() {
    printf 'CERTIFICATE-DATA\n' > "$CERT_CRT"
    printf 'PRIVATE-KEY-DATA\n' > "$CERT_KEY"
}

certs_off() { rm -f "$CERT_CRT" "$CERT_KEY"; }

run_block() {
    PATH="$BIN:$PATH" UCI_STATE="$UCI_STATE" UCI_LOG="$TMP/uci.log" \
        TOLLGATE_SHADOW_FILE="$SHADOW" \
        sh "$BLOCK" 2> "$TMP/stderr.txt"
    RC=$?
}

stderr_text() { cat "$TMP/stderr.txt"; }

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

echo "== 92-tollgate-admin-setup: admin board credential guard =="
echo "script: $SCRIPT"
echo "blocks: $(wc -l < "$BLOCK" | tr -d ' ') lines (decision + listener)"
echo

# --- GUARD (not a case): the extraction must not be vacuous. With a real root
# hash the block MUST add the :8090 listeners — otherwise case (a) could pass on
# a block that serves nothing at all, for any state.
state_reset
shadow_set
certs_off
run_block
if [ "$RC" = 0 ] && state_has uhttpd.admin.listen_http '0.0.0.0:8090' &&
   state_has uhttpd.admin.listen_http '[::]:8090'; then
    echo "guard:   state=set -> :8090 listeners ARE added (assertions are not vacuous)"
else
    echo "GUARD FAIL: state=set did not add the :8090 listeners (rc=$RC)" >&2
    stderr_text >&2
    exit 2
fi
echo

# (a) THE FINDING: root has NO password hash -> the board must not be served.
state_reset
shadow_empty
certs_on
run_block
ok=0
if [ "$RC" = 0 ] &&
   ! grep -q -F 'uhttpd.admin.listen_http=' "$UCI_STATE" &&
   ! grep -q -F 'uhttpd.admin.listen_https=' "$UCI_STATE" &&
   [ -z "$(grep -F 'uhttpd.admin.cert=' "$UCI_STATE")" ]; then
    ok=1
fi
report "(a) shadow hash empty -> NO :8090/:8443 listener is configured" "$ok"
if [ "$ok" != 1 ]; then stderr_text >&2; fi

# (a2) ...and the operator is told WHY, with the fix.
state_reset
shadow_empty
certs_on
run_block
ok=0
if stderr_text | grep -q 'no usable password' &&
   stderr_text | grep -q 'passwd root' &&
   stderr_text | grep -q 'NOT being served'; then
    ok=1
fi
report "(a2) refusal is explained on stderr with the passwd root remedy" "$ok"
if [ "$ok" != 1 ]; then stderr_text >&2; fi

# (b) an unreadable state must fail closed, not open.
state_reset
shadow_gone
certs_on
run_block
ok=0
if [ "$RC" = 0 ] && ! grep -q -F 'uhttpd.admin.listen_http=' "$UCI_STATE"; then
    ok=1
fi
report "(b) credential state unreadable -> NO listener (fail closed)" "$ok"
if [ "$ok" != 1 ]; then stderr_text >&2; fi

# (c) convergence: a router that ALREADY serves :8090 converges to not serving.
state_reset
shadow_empty
state_set uhttpd.admin.listen_http '0.0.0.0:8090'
state_set uhttpd.admin.listen_http '[::]:8090'
state_set uhttpd.admin.listen_https '0.0.0.0:8443'
run_block
ok=0
if ! grep -q -F 'uhttpd.admin.listen_http=' "$UCI_STATE" &&
   ! grep -q -F 'uhttpd.admin.listen_https=' "$UCI_STATE"; then
    ok=1
fi
report "(c) already-serving router with an empty hash -> listeners removed" "$ok"

# (d) a real credential still gets the board (HTTP + HTTPS when a cert exists).
state_reset
shadow_set
certs_on
run_block
ok=0
if state_has uhttpd.admin.listen_http '0.0.0.0:8090' &&
   state_has uhttpd.admin.listen_http '[::]:8090' &&
   state_has uhttpd.admin.listen_https '0.0.0.0:8443' &&
   state_has uhttpd.admin.listen_https '[::]:8443' &&
   state_has uhttpd.admin.cert "$CERT_CRT" &&
   state_has uhttpd.admin.key "$CERT_KEY"; then
    ok=1
fi
report "(d) shadow hash set + cert -> :8090 and :8443 listeners configured" "$ok"
if [ "$ok" != 1 ]; then cat "$UCI_STATE" >&2; fi

# (e) a real credential without a cert: HTTP only, never an advertized TLS
#     listener uhttpd cannot bind.
state_reset
shadow_set
certs_off
run_block
ok=0
if state_has uhttpd.admin.listen_http '0.0.0.0:8090' &&
   ! grep -q -F 'uhttpd.admin.listen_https=' "$UCI_STATE" &&
   ! grep -q -F 'uhttpd.admin.cert=' "$UCI_STATE"; then
    ok=1
fi
report "(e) shadow hash set, no cert -> :8090 only (no dangling TLS)" "$ok"

# (f) a LOCKED password ('!') is not credential-less: `crypt()` can never match
#     it, so serving the board cannot hand out a session.
state_reset
shadow_locked
certs_off
run_block
ok=0
if state_has uhttpd.admin.listen_http '0.0.0.0:8090'; then
    ok=1
fi
report "(f) shadow hash locked ('!') -> board still served (nobody can log in)" "$ok"

echo
echo "-- $pass passed, $fail failed --"
if [ "$fail" -ne 0 ]; then
    exit 1
fi
exit 0
