#!/bin/sh
# test-redirect-https-single-rule.sh -- one rule for a derived value, whatever
# the install order.
#
# WHY THIS EXISTS
#
# `uhttpd.main.redirect_https` is a DERIVED value, not a configured one: LuCI's
# :8080 may only be redirected to the TLS listener when that listener is real AND
# its identity covers the address a browser used. Two scripts write it:
#
#   this repo:  packaging/files/etc/uci-defaults/92-tollgate-admin-setup
#   the module: packaging/files/etc/uci-defaults/99-tollgate-setup
#
# Install order decides which lands LAST, and the order differs by path: the
# module's postinst runs `90, 99, 92` (so 92 lands last there), while
# uci-defaults run numerically at boot (`90, 92, 99`, so 99 lands last). Two
# writers that evaluate the SAME rule agree either way. Two writers that each
# carry a premise of their own do not - and that is the defect this guards:
#
#   * 2026-09-21 (pre13, measured on hardware): 92 armed the redirect on "a
#     cert/key pair exists" while the module's :443 listener was not configured,
#     so every :8080 LuCI request 307'd into a dead port and the operator was
#     locked out of LuCI.
#   * 2026-09-26 (pre17, bench MT3000): the same existence-only premise accepted
#     the OpenWrt image's placeholder certificate (subject CN=OpenWrt,
#     SAN DNS:OpenWrt), which covers neither the router's hostname nor its LAN
#     IP, so the hop landed on an identity a browser can never validate - a hard
#     certificate error on every admin login.
#
# The rule both writers now evaluate is delegated, not reimplemented: the shell
# calls the module's own x509 check (`tollgate ssl covers`) and fails CLOSED when
# that CLI is unusable. This test fails if either writer grows a premise of its
# own - which is exactly what "a test that fails if both writers exist" has to
# mean, since both writers are legitimate once they share one rule.
#
# WHAT IS ASSERTED, per script that writes the option
#   A. it writes uhttpd.main.redirect_https at all (otherwise there is nothing
#      to disagree about, reported as a note)
#   B. it DERIVES the value through the shared coverage check (`ssl covers`)
#   C. it FAILS CLOSED: the coverage check is gated on the CLI being executable,
#      so an absent CLI can never be read as "covers"
#   D. it writes an EXPLICIT value in both directions, so a stale value left by
#      the other writer cannot survive the install ('1' and '0' both present)
#   E. it does not decide from the image's fixed placeholder path
#      (`/etc/uhttpd.crt`) - the literal test that produced both incidents
#
# NEGATIVE CONTROL: the superseded rule is written out as a fixture inside this
# test (never read from git history: CI checks out at fetch-depth 1) and the same
# checker must reject it. Without that, every assertion above could pass on a
# script that decides nothing at all.
#
# HOW THE OTHER WRITER IS FOUND
#   MODULE_SCRIPT=<file>  read that file as the module's 99-tollgate-setup
#   MODULE_DIR=<dir>      read $MODULE_DIR/packaging/files/etc/uci-defaults/99-tollgate-setup
#   otherwise             shallow-fetch OpenTollGate/tollgate-module-basic-go
#                         (MODULE_REPO / MODULE_REF overridable).
# A pin whose tree is unreachable is unverifiable: strict in CI (fail), a SKIP
# locally with no network.
#
# Exit status: 0 = pass (or skipped), 1 = a writer carries its own premise,
# 2 = harness misuse.

set -u

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$HERE/../.." && pwd)

SELF_SCRIPT_DEFAULT="$HERE/../files/etc/uci-defaults/92-tollgate-admin-setup"
SELF_SCRIPT=${SELF_SCRIPT:-"$SELF_SCRIPT_DEFAULT"}

MODULE_REPO=${MODULE_REPO:-https://github.com/OpenTollGate/tollgate-module-basic-go.git}
MODULE_REF=${MODULE_REF:-main}
MODULE_SCRIPT=${MODULE_SCRIPT:-}
MODULE_DIR=${MODULE_DIR:-}
MODULE_PATH_IN_REPO=packaging/files/etc/uci-defaults/99-tollgate-setup

pass=0
fail=0
notes=0

ok()   { echo "OK:   $1"; pass=$((pass + 1)); }
bad()  { echo "FAIL: $1" >&2; fail=$((fail + 1)); }
note() { echo "note: $1"; notes=$((notes + 1)); }

# --- the checker, as a function so the negative control runs the SAME code ----

# check_writer <label> <path>
# Prints its findings; returns 1 when the script writes the option without
# sharing the one rule.
check_writer() {
    label=$1
    path=$2
    rc=0

    if [ ! -f "$path" ]; then
        bad "$label: writer not found: $path"
        return 1
    fi
    if ! sh -n "$path" 2>/dev/null; then
        bad "$label: sh -n rejected $path"
        return 1
    fi

    writes=$(grep -c -F 'uhttpd.main.redirect_https' "$path")
    if [ "$writes" -eq 0 ]; then
        note "$label: does not write uhttpd.main.redirect_https (nothing to disagree about)"
        return 0
    fi

    set_1=$(grep -c -F "uhttpd.main.redirect_https='1'" "$path")
    set_0=$(grep -c -F "uhttpd.main.redirect_https='0'" "$path")

    # B - the shared predicate.
    if ! grep -q -F 'ssl covers' "$path"; then
        bad "$label: writes redirect_https but never consults the shared coverage check (tollgate ssl covers) - it evaluates a premise of its own"
        rc=1
    fi

    # C - fail closed: the coverage check must be gated on an executable CLI.
    if ! grep -q -E '\[ *-x +"[^"]*" *\]' "$path"; then
        bad "$label: no executability test on the tollgate CLI - an absent CLI could be read as \"covers\""
        rc=1
    fi

    # D - explicit value, both directions.
    if [ "$set_1" -eq 0 ] || [ "$set_0" -eq 0 ]; then
        bad "$label: does not write an explicit value in both directions ('1': $set_1, '0': $set_0) - a stale value left by the other writer would survive"
        rc=1
    fi

    # E - never the image's fixed placeholder path.
    if grep -q -F '[ -r /etc/uhttpd.crt ]' "$path"; then
        bad "$label: decides from the image's fixed placeholder path (/etc/uhttpd.crt) - that is the superseded rule"
        rc=1
    fi

    if [ "$rc" -eq 0 ]; then
        ok "$label: derives redirect_https from the shared coverage check, fails closed, writes both directions explicitly"
    fi
    return "$rc"
}

# --- resolve the two writers -------------------------------------------------

echo "== uhttpd.main.redirect_https: one derived value, one rule =="

if [ ! -f "$SELF_SCRIPT" ]; then
    echo "FAIL: this repo's writer not found: $SELF_SCRIPT" >&2
    exit 2
fi
echo "writer 1 (this repo): $SELF_SCRIPT"

TMP=""
cleanup() { [ -n "$TMP" ] && rm -rf "$TMP"; }
trap cleanup EXIT INT TERM

if [ -n "$MODULE_SCRIPT" ]; then
    other="$MODULE_SCRIPT"
elif [ -n "$MODULE_DIR" ]; then
    other="$MODULE_DIR/$MODULE_PATH_IN_REPO"
else
    TMP=$(mktemp -d "${TMPDIR:-/tmp}/tg-single-rule.XXXXXX") || exit 2
    if git -C "$TMP" init -q 2>/dev/null &&
       git -C "$TMP" remote add origin "$MODULE_REPO" 2>/dev/null &&
       git -C "$TMP" fetch -q --depth 1 origin "$MODULE_REF" 2>/dev/null; then
        git -C "$TMP" show "FETCH_HEAD:$MODULE_PATH_IN_REPO" > "$TMP/99-tollgate-setup" 2>/dev/null || : > "$TMP/99-tollgate-setup"
        other="$TMP/99-tollgate-setup"
    else
        other=""
        if [ -n "${GITHUB_ACTIONS:-}" ]; then
            bad "cannot read the module's writer at $MODULE_REPO@$MODULE_REF (fetch failed) - the pair is unverifiable"
        else
            echo "SKIP: cannot read the module's writer at $MODULE_REPO@$MODULE_REF (offline and no MODULE_DIR/MODULE_SCRIPT)"
            exit 0
        fi
    fi
fi
[ -n "$other" ] && echo "writer 2 (module):    $other"
echo

# --- the shipped pair --------------------------------------------------------

check_writer "92-tollgate-admin-setup" "$SELF_SCRIPT"
check_writer "99-tollgate-setup" "$other"

# --- negative control: the superseded rule must be REJECTED -------------------
# Written out here, not read from git history: CI checks out at fetch-depth 1, so
# `git show <old-rev>:<path>` is unavailable there (the module's setup-marker
# suite injects its pre-change predicate the same way). This is the rule 92
# shipped until 2026-09-26: existence + listener, no coverage.
FIXDIR=$(mktemp -d "${TMPDIR:-/tmp}/tg-single-rule-fixture.XXXXXX") || exit 2
FIXTURE_FILE="$FIXDIR/superseded-92.sh"
cat > "$FIXTURE_FILE" <<'FIXTURE'
#!/bin/sh
if uci -q get uhttpd.main >/dev/null 2>&1; then
    if [ -r /etc/uhttpd.crt ] && [ -s /etc/uhttpd.crt ] &&
       [ -r /etc/uhttpd.key ] && [ -s /etc/uhttpd.key ] &&
       [ -n "$(uci -q get uhttpd.main.listen_https 2>/dev/null)" ]; then
        uci set uhttpd.main.redirect_https='1'
    else
        uci set uhttpd.main.redirect_https='0'
    fi
    uci commit uhttpd
fi
FIXTURE

control_out=$(check_writer "negative-control (superseded rule)" "$FIXTURE_FILE" 2>&1)
control_rc=$?
rm -rf "$FIXDIR"

if [ "$control_rc" -eq 0 ]; then
    bad "negative control is VACUOUS: the superseded existence-only rule passed the same checker"
else
    ok "negative control: the superseded existence-only rule is rejected by the same checker"
fi
printf '%s\n' "$control_out" | sed 's/^/       control: /' | grep -v '^$' || true

echo
echo "-- $pass passed, $fail failed, $notes note(s) --"
if [ "$fail" -ne 0 ]; then
    exit 1
fi
exit 0
