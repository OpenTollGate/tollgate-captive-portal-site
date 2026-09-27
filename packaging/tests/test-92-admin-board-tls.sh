#!/bin/sh
# Regression harness for the ADMIN BOARD's own TLS identity and the redirect
# derived from it, in packaging/files/etc/uci-defaults/92-tollgate-admin-setup.
#
# Background - the board instance (uhttpd.admin, :8090 + :8443) was the last
# surface still pinned to the OpenWrt image's own certificate pair
# (/etc/uhttpd.crt, subject CN=OpenWrt, SAN DNS:OpenWrt). That pair satisfies
# every readable-and-non-empty check while covering neither the router's
# hostname nor its LAN IP, and the script never redirected :8090 at all - so the
# board's login form (a password field) was typed on a cleartext origin while
# its "secure" :8443 listener, when it existed, served an identity a browser can
# never validate. That is the same defect class as the pre17 LuCI incident
# (module PR #593 / portal PR #64), one surface over.
#
# The rule now, and what this harness pins:
#
#   IDENTITY  the board's listener carries the MODULE's provisioned certificate
#             (/etc/tollgate/ssl/server.{crt,key}, written by `tollgate ssl
#             apply` from the module's 99-tollgate-setup) whenever that pair is
#             present. The image's pair is a fallback LISTENER identity only, so
#             a router that could not be provisioned keeps :8443 instead of
#             losing it.
#   REDIRECT  uhttpd.admin.redirect_https is a DERIVED value: :8090 is sent to
#             the instance's own :8443 only when that listener carries an
#             identity that COVERS this router, decided by the SAME predicate
#             the LuCI hop uses (`tollgate ssl covers`, via cert_covers_router).
#             It fails CLOSED (an unusable CLI is "does not cover"), it writes an
#             explicit value in both directions (a stale '1' is repaired), and it
#             is turned back off if :8443 never came up (fail open - a redirect
#             into a dead port is a board nobody can open).
#
# How it works: the guarded blocks are extracted VERBATIM from the shipped
# script by sentinel, ONLY the absolute paths they touch are rewritten into a
# private temp dir, stub `uci`/`tollgate` binaries are put on PATH and the
# extracted text is run under POSIX sh.
#
# Safety: nothing outside the temp dir is read or written; no root, no network;
# the shipped script itself is never executed (only parsed with `sh -n`, which
# executes nothing).
#
# Usage: sh packaging/tests/test-92-admin-board-tls.sh [path-to-script]
# Exits non-zero if any case fails.

set -u

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SCRIPT=${1:-"$HERE/../files/etc/uci-defaults/92-tollgate-admin-setup"}

if [ ! -f "$SCRIPT" ]; then
    echo "FAIL: shipped script not found: $SCRIPT" >&2
    exit 2
fi

TMP=$(mktemp -d "${TMPDIR:-/tmp}/tg-92-board-tls.XXXXXX") || exit 2
trap 'rm -rf "$TMP"' EXIT INT TERM

BIN="$TMP/bin"
CLI="$BIN/tollgate"
CLI_GONE="$TMP/no-cli/tollgate"
SSL_CRT="$TMP/etc/tollgate/ssl/server.crt"
SSL_KEY="$TMP/etc/tollgate/ssl/server.key"
IMG_CRT="$TMP/etc/uhttpd.crt"
IMG_KEY="$TMP/etc/uhttpd.key"
UHTTPD_INIT="$TMP/etc/init.d/uhttpd"
RPCD_INIT="$TMP/etc/init.d/rpcd"
PROC_TCP="$TMP/proc/net/tcp"
PROC_TCP6="$TMP/proc/net/tcp6"
UCI_STATE="$TMP/uci.state"
RESTART_LOG="$TMP/uhttpd.restarts"
COVERAGE="$TMP/coverage"
PREDICATE="$TMP/block-predicate.sh"
LISTENER="$TMP/block-listener.sh"
REDIRECT="$TMP/block-redirect.sh"
FAILOPEN="$TMP/block-failopen.sh"
RUN_ID="$TMP/run-identity.sh"
RUN_FO="$TMP/run-failopen.sh"

mkdir -p "$BIN" "$TMP/etc/init.d" "$TMP/etc/tollgate/ssl" "$TMP/proc/net"
: > "$UCI_STATE"
: > "$RESTART_LOG"

# --- preconditions -----------------------------------------------------------

if ! sh -n "$SCRIPT"; then
    echo "FAIL: sh -n rejected $SCRIPT" >&2
    exit 2
fi

# Static preconditions, checked BEFORE anything is extracted, so that pointing
# this harness at a pre-change revision reports the defect itself instead of a
# sentinel-drift error:
#
#   * the shipped script consumes the module's provisioned identity, and
#   * it derives the board's :8090 hop at all (an explicit '1' AND '0').
#
# The pre-change script did neither: it pinned the board's listener to the
# image's pair (/etc/uhttpd.crt) and never redirected :8090.
if ! grep -F -q -- 'TOLLGATE_SSL_CERT' "$SCRIPT"; then
    echo "FAIL: the shipped script does not consume the module's provisioned TLS identity" >&2
    echo "      (pre-change revision: the board's :8443 listener is pinned to the image's placeholder pair)" >&2
    exit 2
fi
if ! grep -F -q -- "uhttpd.admin.redirect_https='1'" "$SCRIPT" ||
   ! grep -F -q -- "uhttpd.admin.redirect_https='0'" "$SCRIPT"; then
    echo "FAIL: the shipped script never derives uhttpd.admin.redirect_https in both directions" >&2
    echo "      (pre-change revision: the board's :8090 hop is never armed)" >&2
    exit 2
fi

rewrite_paths() {
    sed \
        -e 's|/usr/bin/tollgate|@@CLI@@|g' \
        -e 's|/etc/uhttpd\.crt|@@IMGCRT@@|g' \
        -e 's|/etc/uhttpd\.key|@@IMGKEY@@|g' \
        -e 's|/proc/net/tcp6|@@TCP6@@|g' \
        -e 's|/proc/net/tcp|@@TCP@@|g' \
        -e 's|/etc/init\.d/uhttpd|@@UHTTPD@@|g' \
        -e 's|/etc/init\.d/rpcd|@@RPCD@@|g' |
        sed \
            -e "s|@@CLI@@|$CLI|g" \
            -e "s|@@IMGCRT@@|$IMG_CRT|g" \
            -e "s|@@IMGKEY@@|$IMG_KEY|g" \
            -e "s|@@TCP6@@|$PROC_TCP6|g" \
            -e "s|@@TCP@@|$PROC_TCP|g" \
            -e "s|@@UHTTPD@@|$UHTTPD_INIT|g" \
            -e "s|@@RPCD@@|$RPCD_INIT|g"
}

# The shared predicate (TOLLGATE_CLI + cert_covers_router) ends at the
# function's closing brace; the listener block runs from the ADMIN_BOARD_ALLOWED
# guard to the (unindented) `fi` that closes it; the board's derived redirect
# runs from its banner to its own unindented `fi`; the fail-open runs from its
# own banner. Inner `if`/`fi` pairs are all INDENTED, which is what keeps those
# ranges from stopping early.
sed -n '/^TOLLGATE_CLI=/,/^}$/p' "$SCRIPT" | rewrite_paths > "$PREDICATE"
sed -n '/^if \[ "\$ADMIN_BOARD_ALLOWED" = "1" \]; then$/,/^fi$/p' "$SCRIPT" |
    rewrite_paths > "$LISTENER"
sed -n '/^# --- the BOARD.s own listener/,/^fi$/p' "$SCRIPT" |
    rewrite_paths > "$REDIRECT"
sed -n '/^# Fail open, same shape, for the board/,/^fi$/p' "$SCRIPT" |
    rewrite_paths > "$FAILOPEN"

for b in "$PREDICATE" "$LISTENER" "$REDIRECT" "$FAILOPEN"; do
    if [ ! -s "$b" ]; then
        echo "FAIL: sentinel extraction produced an empty block ($b)" >&2
        exit 2
    fi
done

# The extraction must not be vacuous: every piece a later assertion depends on
# has to be present in the extracted text.
for needle in \
    'cert_covers_router' \
    'ssl covers' \
    'admin_tls_cert' \
    'TOLLGATE_SSL_CERT'
do
    if ! grep -F -q -- "$needle" "$PREDICATE" "$LISTENER" "$REDIRECT"; then
        echo "FAIL: extracted blocks are missing '$needle' (sentinel drift?)" >&2
        exit 2
    fi
done
if ! grep -F -q -- "uhttpd.admin.redirect_https='1'" "$REDIRECT"; then
    echo "FAIL: the board redirect block writes no '1' value (extraction miss?)" >&2
    exit 2
fi
if ! grep -F -q -- "uhttpd.admin.redirect_https='0'" "$REDIRECT"; then
    echo "FAIL: the board redirect block writes no '0' value (extraction miss?)" >&2
    exit 2
fi

# No un-rewritten absolute path may survive, /dev/null excepted (the code
# deliberately discards stderr there; it is not a redirect target and does not
# exist in the temp dir).
for b in "$PREDICATE" "$LISTENER" "$REDIRECT" "$FAILOPEN"; do
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
    if grep -q -F '@@' "$b"; then
        echo "FAIL: unsubstituted placeholder left in $b" >&2
        exit 2
    fi
done

# The two runs: identity+redirect, and the fail-open half on its own (running
# the fail-open together with the redirect would let it repair the value under
# the identity cases, which is exactly what case (g) tests deliberately).
{
    echo 'ADMIN_BOARD_ALLOWED=1'
    cat "$PREDICATE" "$LISTENER" "$REDIRECT"
} > "$RUN_ID"
{
    echo 'ADMIN_BOARD_ALLOWED=1'
    cat "$FAILOPEN"
} > "$RUN_FO"

# --- stubs -------------------------------------------------------------------

# Stub `uci`: only the subset the extracted blocks use, backed by a flat
# key=value state file. `get` prints a list's values space separated with NO
# trailing space, which is what the real `uci get` does and what the shipped
# `[ -r "$cert" ]` guard needs; `-q get <missing>` exits non-zero. An
# unhandled verb is a FAILURE, never a fall-through: a silent no-op would make
# every assertion about that verb a tautology.
cat > "$BIN/uci" <<'STUB'
#!/bin/sh
STATE="${UCI_STATE:?}"
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
        out=""
        found=0
        while IFS= read -r line; do
            case "$line" in
                "$key="*)
                    if [ "$found" = 1 ]; then
                        out="$out ${line#*=}"
                    else
                        out="${line#*=}"
                        found=1
                    fi
                    ;;
            esac
        done < "$STATE"
        [ "$found" = 1 ] || exit 1
        printf '%s\n' "$out"
        ;;
    set)
        grep -v -F -- "$key=" "$STATE" 2>/dev/null > "$STATE.tmp" || : > "$STATE.tmp"
        printf '%s=%s\n' "$key" "$val" >> "$STATE.tmp"
        mv "$STATE.tmp" "$STATE"
        ;;
    add_list)
        grep -F -x -- "$key=$val" "$STATE" >/dev/null 2>&1 ||
            printf '%s=%s\n' "$key" "$val" >> "$STATE"
        ;;
    del_list)
        grep -v -F -x -- "$key=$val" "$STATE" 2>/dev/null > "$STATE.tmp" || : > "$STATE.tmp"
        mv "$STATE.tmp" "$STATE"
        ;;
    delete)
        grep -v -F -- "$key=" "$STATE" 2>/dev/null > "$STATE.tmp" || : > "$STATE.tmp"
        mv "$STATE.tmp" "$STATE"
        ;;
    commit)
        : ;;
    *)
        echo "stub uci: unexpected verb '$cmd'" >&2
        exit 9
        ;;
esac
exit 0
STUB
chmod +x "$BIN/uci"

# Stub `tollgate`: `ssl covers <cert>` exits 0 only for the PROVISIONED path and
# only while $FAKE_COVERAGE says "covering" - the contract of the real x509 SAN
# check, where a missing or empty file is refused outright.
cat > "$CLI" <<'STUB'
#!/bin/sh
[ "${1:-}" = "ssl" ] || exit 1
[ "${2:-}" = "covers" ] || exit 1
cert="${3:-}"
[ -n "$cert" ] || exit 1
[ -r "$cert" ] && [ -s "$cert" ] || exit 1
[ "$cert" = "$PROVISIONED_CERT" ] || exit 1
[ "$(cat "${FAKE_COVERAGE:?}" 2>/dev/null)" = "covering" ] || exit 1
exit 0
STUB
chmod +x "$CLI"

cat > "$UHTTPD_INIT" <<'STUB'
#!/bin/sh
printf '%s\n' "$*" >> "$RESTART_LOG"
exit 0
STUB
chmod +x "$UHTTPD_INIT"

# --- helpers -----------------------------------------------------------------

state_reset() {
    : > "$UCI_STATE"
    printf 'uhttpd.admin=uhttpd\n' >> "$UCI_STATE"
    : > "$RESTART_LOG"
}

state_set() { # key value
    grep -v -F -- "$1=" "$UCI_STATE" 2>/dev/null > "$UCI_STATE.tmp" || : > "$UCI_STATE.tmp"
    printf '%s=%s\n' "$1" "$2" >> "$UCI_STATE.tmp"
    mv "$UCI_STATE.tmp" "$UCI_STATE"
}

state_has() { # key value -> 0 when present
    grep -F -x -q -- "$1=$2" "$UCI_STATE"
}

state_get() { # key -> value (last occurrence wins, as in the shipped script)
    grep -F -- "$1=" "$UCI_STATE" 2>/dev/null | tail -n 1 | sed "s|^$1=||"
}

provisioned_on() {
    printf 'PROVISIONED-CERT-DATA\n' > "$SSL_CRT"
    printf 'PROVISIONED-KEY-DATA\n' > "$SSL_KEY"
}
provisioned_off() { rm -f "$SSL_CRT" "$SSL_KEY"; }

image_pair_on() {
    printf 'IMAGE-PLACEHOLDER-CERT (561 bytes, DER fixture)\n' > "$IMG_CRT"
    printf 'IMAGE-PLACEHOLDER-KEY fixture\n' > "$IMG_KEY"
}
image_pair_off() { rm -f "$IMG_CRT" "$IMG_KEY"; }

coverage_covering()    { printf 'covering\n' > "$COVERAGE"; }
coverage_not_covering() { printf 'not-covering\n' > "$COVERAGE"; }

# /proc/net/tcp fixtures for the fail-open half. $1 = "listen" adds a LISTEN
# (state 0A) socket on :8443 (0x20FB).
proc_net() {
    : > "$PROC_TCP"
    : > "$PROC_TCP6"
    if [ "${1:-}" = "listen" ]; then
        printf '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n' >> "$PROC_TCP"
        printf '   0: 00000000:20FB 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 12345 1 0000000000000000 100 0 0 10 0\n' >> "$PROC_TCP"
    fi
}

run_id() {
    PATH="$BIN:$PATH" UCI_STATE="$UCI_STATE" UCI_LOG="$TMP/uci.log" \
        TOLLGATE_CLI="${1:-$CLI}" \
        TOLLGATE_SSL_CERT="$SSL_CRT" TOLLGATE_SSL_KEY="$SSL_KEY" \
        IMAGE_CERT="$IMG_CRT" IMAGE_KEY="$IMG_KEY" \
        UHTTPD_IMAGE_CERT="$IMG_CRT" UHTTPD_IMAGE_KEY="$IMG_KEY" \
        PROVISIONED_CERT="$SSL_CRT" FAKE_COVERAGE="$COVERAGE" \
        sh "$RUN_ID" 2> "$TMP/stderr.txt"
    RC=$?
}

run_fo() {
    PATH="$BIN:$PATH" UCI_STATE="$UCI_STATE" UCI_LOG="$TMP/uci.log" \
        RESTART_LOG="$RESTART_LOG" \
        sh "$RUN_FO" 2> "$TMP/stderr.txt"
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

echo "== 92-tollgate-admin-setup: the board's own TLS identity + derived redirect =="
echo "script: $SCRIPT"
echo "blocks: predicate $(wc -l < "$PREDICATE" | tr -d ' ') + listener $(wc -l < "$LISTENER" | tr -d ' ') + redirect $(wc -l < "$REDIRECT" | tr -d ' ') + fail-open $(wc -l < "$FAILOPEN" | tr -d ' ') lines"
echo

# --- GUARD (not a case): the extraction must not be vacuous -------------------
# With a covering provisioned identity the block MUST put the provisioned pair
# on the listener and arm the hop - otherwise every case below could pass on a
# block that configures nothing at all.
provisioned_on
image_pair_on
coverage_covering
proc_net
state_reset
run_id
if [ "$RC" = 0 ] && state_has uhttpd.admin.listen_https '0.0.0.0:8443' &&
   [ "$(state_get uhttpd.admin.cert)" = "$SSL_CRT" ] &&
   [ "$(state_get uhttpd.admin.redirect_https)" = "1" ]; then
    echo "guard:   covering provisioned identity -> provisioned pair + redirect 1 (assertions are not vacuous)"
else
    echo "GUARD FAIL: the extracted blocks configured nothing usable (rc=$RC)" >&2
    cat "$UCI_STATE" >&2
    stderr_text >&2
    exit 2
fi
echo

# (a) THE FINDING: the board's listener carries the MODULE's provisioned
#     identity, and the plain-HTTP board is redirected to its own TLS listener.
provisioned_on
image_pair_on
coverage_covering
proc_net
state_reset
run_id
ok=0
if state_has uhttpd.admin.listen_https '0.0.0.0:8443' &&
   state_has uhttpd.admin.listen_https '[::]:8443' &&
   [ "$(state_get uhttpd.admin.cert)" = "$SSL_CRT" ] &&
   [ "$(state_get uhttpd.admin.key)" = "$SSL_KEY" ] &&
   [ "$(state_get uhttpd.admin.redirect_https)" = "1" ]; then
    ok=1
fi
report "(a) covering provisioned identity -> cert/key = provisioned pair, redirect_https=1" "$ok"
if [ "$ok" != 1 ]; then cat "$UCI_STATE" >&2; stderr_text >&2; fi

# (b) plain HTTP is NOT redirected to an identity that does not cover this
#     router: the listener stays, the hop stays off.
provisioned_on
image_pair_on
coverage_not_covering
proc_net
state_reset
state_set uhttpd.admin.redirect_https '1'
run_id
ok=0
if [ "$(state_get uhttpd.admin.redirect_https)" = "0" ]; then
    ok=1
fi
report "(b) identity does NOT cover this router, stale redirect=1 -> redirect_https=0" "$ok"
if [ "$ok" != 1 ]; then cat "$UCI_STATE" >&2; fi

# (c) an unusable CLI fails CLOSED: "no verdict" must never read as "covers".
provisioned_on
image_pair_on
coverage_covering
proc_net
state_reset
state_set uhttpd.admin.redirect_https '1'
run_id "$CLI_GONE"
ok=0
if [ "$(state_get uhttpd.admin.redirect_https)" = "0" ]; then
    ok=1
fi
report "(c) no usable tollgate CLI, stale redirect=1 -> redirect_https=0 (fails closed)" "$ok"
if [ "$ok" != 1 ]; then cat "$UCI_STATE" >&2; fi

# (d) a router that could NOT be provisioned keeps its :8443 listener on the
#     image's pair - but the hop is never armed on a placeholder identity.
provisioned_off
image_pair_on
coverage_covering
proc_net
state_reset
run_id
ok=0
if state_has uhttpd.admin.listen_https '0.0.0.0:8443' &&
   [ "$(state_get uhttpd.admin.cert)" = "$IMG_CRT" ] &&
   [ "$(state_get uhttpd.admin.redirect_https)" = "0" ]; then
    ok=1
fi
report "(d) no provisioned identity -> image pair keeps :8443, redirect_https=0 (never the placeholder)" "$ok"
if [ "$ok" != 1 ]; then cat "$UCI_STATE" >&2; fi

# (e) no pair at all: no dangling TLS listener, and an explicit 0.
provisioned_off
image_pair_off
coverage_covering
proc_net
state_reset
state_set uhttpd.admin.redirect_https '1'
run_id
ok=0
if ! grep -q -F 'uhttpd.admin.listen_https=' "$UCI_STATE" &&
   [ -z "$(state_get uhttpd.admin.cert)" ] &&
   [ "$(state_get uhttpd.admin.redirect_https)" = "0" ]; then
    ok=1
fi
report "(e) no cert pair at all -> :8090 only, no cert, redirect_https=0" "$ok"
if [ "$ok" != 1 ]; then cat "$UCI_STATE" >&2; fi

# (f) idempotent: re-running with a covering identity keeps the derived value.
provisioned_on
image_pair_on
coverage_covering
proc_net
state_reset
run_id
run_id
ok=0
if [ "$(state_get uhttpd.admin.redirect_https)" = "1" ] &&
   [ "$(state_get uhttpd.admin.cert)" = "$SSL_CRT" ]; then
    ok=1
fi
report "(f) idempotent: re-run keeps cert = provisioned pair and redirect_https=1" "$ok"
if [ "$ok" != 1 ]; then cat "$UCI_STATE" >&2; fi

# (g) FAIL OPEN: the hop is only safe if :8443 actually came up. With the
#     redirect armed and no LISTEN socket on :8443 the block drops it and
#     restarts uhttpd once - it only ever turns the redirect OFF.
proc_net
state_reset
state_set uhttpd.admin.redirect_https '1'
run_fo
ok=0
if [ "$(state_get uhttpd.admin.redirect_https)" = "0" ] &&
   grep -q 'restart' "$RESTART_LOG"; then
    ok=1
fi
report "(g) no :8443 LISTEN socket -> fail-open sets 0 and restarts uhttpd" "$ok"
if [ "$ok" != 1 ]; then cat "$UCI_STATE" >&2; cat "$RESTART_LOG" >&2; fi

# (h) ...and it leaves a live listener alone.
proc_net listen
state_reset
state_set uhttpd.admin.redirect_https '1'
: > "$RESTART_LOG"
run_fo
ok=0
if [ "$(state_get uhttpd.admin.redirect_https)" = "1" ] &&
   [ ! -s "$RESTART_LOG" ]; then
    ok=1
fi
report "(h) :8443 LISTEN present -> redirect kept at 1, no restart (fail-open not vacuous)" "$ok"
if [ "$ok" != 1 ]; then cat "$UCI_STATE" >&2; cat "$RESTART_LOG" >&2; fi

# (i) static: the hop is armed through the SHARED predicate, never from the
#     image's fixed placeholder path - the premise that produced the incident.
ok=0
if grep -q -F 'cert_covers_router "$admin_cert"' "$SCRIPT" &&
   ! grep -q -F '[ -r /etc/uhttpd.crt ]' "$SCRIPT"; then
    ok=1
fi
report "(i) the board hop is derived through the shared coverage check, not the placeholder path" "$ok"

echo
echo "-- $pass passed, $fail failed --"
if [ "$fail" -ne 0 ]; then
    exit 1
fi
exit 0
