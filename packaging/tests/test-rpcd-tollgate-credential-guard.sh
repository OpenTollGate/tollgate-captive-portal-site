#!/bin/sh
# Regression harness for the fail-closed credential guard in the shipped rpcd
# plugin (openwrt/rpcd/tollgate) and the ACL that exposes its pre-authentication
# probe (openwrt/rpcd/tollgate_acl.json).
#
# Background: rpc_login_test_password() (rpcd/session.c) returns TRUE when
# root's /etc/shadow hash is empty, so `ubus session.login` accepts ANY password
# — including "" — and hands back a session carrying this board's ACL
# (file exec, system.password_set, wallet_drain_cashu). "I have a session"
# therefore proves nothing on such a router, so the plugin refuses every method
# that ACTS on the router while root has no usable credential, and the board
# asks the pre-auth `auth_status` probe whether it may offer a login form at all.
#
# What this harness runs: the SHIPPED plugin, verbatim apart from its
# `. /usr/share/libubox/jshn.sh` line (rewritten to a stub with the same four
# functions it uses) and its `tollgate` CLI dependency (a stub on PATH that
# records every invocation). The plugin's own decisions are what is asserted.
#
# Safety: nothing outside the temp dir is touched; no root, no network, no
# router. The shipped plugin is never executed from its own path.
#
# Usage: sh packaging/tests/test-rpcd-tollgate-credential-guard.sh [plugin] [acl]
# Exits non-zero if any case fails.
set -u

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PLUGIN=${1:-"$HERE/../../openwrt/rpcd/tollgate"}
ACL=${2:-"$HERE/../../openwrt/rpcd/tollgate_acl.json"}

for f in "$PLUGIN" "$ACL"; do
    if [ ! -f "$f" ]; then
        echo "FAIL: shipped file not found: $f" >&2
        exit 2
    fi
done
if ! sh -n "$PLUGIN"; then
    echo "FAIL: sh -n rejected $PLUGIN" >&2
    exit 2
fi

TMP=$(mktemp -d "${TMPDIR:-/tmp}/tg-rpcd-guard.XXXXXX") || exit 2
trap 'rm -rf "$TMP"' EXIT INT TERM

BIN="$TMP/bin"
SHADOW="$TMP/etc/shadow"
CALLS="$TMP/tollgate.calls"
JSON_OUT="$TMP/json.out"
mkdir -p "$BIN" "$TMP/etc"
: > "$CALLS"

# --- stub jshn -----------------------------------------------------------------
# Only the four functions the plugin uses. `json_dump` prints the accumulated
# fields as `type key=value` lines so assertions do not depend on JSON spacing.
cat > "$TMP/jshn.sh" <<'JSHN'
json_init() { : > "$JSON_OUT"; }
json_add_string() { printf 's %s=%s\n' "$1" "$2" >> "$JSON_OUT"; }
json_add_boolean() { printf 'b %s=%s\n' "$1" "$2" >> "$JSON_OUT"; }
json_dump() { cat "$JSON_OUT" 2>/dev/null || :; }
JSHN

# --- stub tollgate CLI ---------------------------------------------------------
# Records argv, then answers with a recognisable payload. Its ABSENCE from
# $CALLS is how the "refused before doing anything" cases are proven.
cat > "$BIN/tollgate" <<'CLI'
#!/bin/sh
printf '%s\n' "$*" >> "$TOLLGATE_CALLS"
echo '{"stub":"tollgate-cli"}'
CLI
chmod +x "$BIN/tollgate"

# --- the shipped plugin, with its jshn include rewritten -----------------------
sed "s|^\. /usr/share/libubox/jshn.sh|. $TMP/jshn.sh|" "$PLUGIN" > "$TMP/plugin.sh"
if grep -q '/usr/share/libubox/jshn.sh' "$TMP/plugin.sh"; then
    echo "FAIL: could not rewrite the jshn include (plugin layout changed?)" >&2
    exit 2
fi
chmod +x "$TMP/plugin.sh"

# --- helpers -------------------------------------------------------------------

pass=0
fail=0
ok()   { pass=$((pass + 1)); echo "PASS: $1"; }
bad()  { fail=$((fail + 1)); echo "FAIL: $1" >&2; }

shadow_empty()  { printf 'root::0:0:99999:7:::\n' > "$SHADOW"; }
shadow_locked() { printf 'root:!:0:0:99999:7:::\n' > "$SHADOW"; }
shadow_set()    { printf 'root:$1$abc$defghijklmnop:0:0:99999:7:::\n' > "$SHADOW"; }
shadow_gone()   { rm -f "$SHADOW"; }

# run METHOD [stdin] -> stdout in $OUT, stub calls recorded in $CALLS
run_method() {
    _m=$1
    _in=${2:-}
    : > "$JSON_OUT"
    : > "$CALLS"
    if [ -n "$_in" ]; then
        OUT=$(printf '%s' "$_in" | \
            TOLLGATE_SHADOW_FILE="$SHADOW" TOLLGATE_CALLS="$CALLS" \
            JSON_OUT="$JSON_OUT" PATH="$BIN:$PATH" sh "$TMP/plugin.sh" call "$_m" 2>&1)
    else
        OUT=$(TOLLGATE_SHADOW_FILE="$SHADOW" TOLLGATE_CALLS="$CALLS" \
            JSON_OUT="$JSON_OUT" PATH="$BIN:$PATH" sh "$TMP/plugin.sh" call "$_m" 2>&1)
    fi
    RC=$?
}

cli_ran() { [ -s "$CALLS" ]; }

echo "== rpcd plugin: root credential fail-closed guard =="
echo "plugin: $PLUGIN"
echo "acl:    $ACL"
echo

# --- (a) the fresh-deploy state: NO root password ------------------------------

shadow_empty
run_method config_get
if [ "$RC" = 0 ] && printf '%s' "$OUT" | grep -q 's error=no-admin-credential'; then
    ok "(a) empty root hash -> config_get is REFUSED (no-admin-credential)"
else
    bad "(a) empty root hash: config_get was not refused (rc=$RC, out: $OUT)"
fi
if cli_ran; then
    bad "(a2) the tollgate CLI ran anyway: $(cat "$CALLS")"
else
    ok "(a2) the tollgate CLI was not invoked — nothing acted on the router"
fi
if printf '%s' "$OUT" | grep -q 'b success=0'; then
    ok "(a3) the refusal is a structured failure (success=0)"
else
    bad "(a3) refusal did not report success=0 (out: $OUT)"
fi

# the money path, same state
run_method wallet_drain_cashu
if printf '%s' "$OUT" | grep -q 's error=no-admin-credential' && ! cli_ran; then
    ok "(b) empty root hash -> wallet_drain_cashu is REFUSED"
else
    bad "(b) wallet_drain_cashu not refused on an empty hash (rc=$RC, out: $OUT)"
fi

# --- (c) unreadable state must not be assumed safe -----------------------------

shadow_gone
run_method config_get
if printf '%s' "$OUT" | grep -q 's error=no-admin-credential' && ! cli_ran; then
    ok "(c) unreadable /etc/shadow -> REFUSED (fail closed, not fail open)"
else
    bad "(c) unreadable shadow state was not refused (rc=$RC, out: $OUT)"
fi

# --- (d) a provisioned router is untouched (assertions are not vacuous) --------

shadow_set
run_method config_get
if printf '%s' "$OUT" | grep -q 'no-admin-credential'; then
    bad "(d) a router WITH a real root hash was refused — the guard is too broad"
elif cli_ran && printf '%s' "$OUT" | grep -q 'stub'; then
    ok "(d) real root hash -> config_get reaches the tollgate CLI (not vacuous)"
else
    bad "(d) config_get did not reach the CLI on a provisioned router (rc=$RC, out: $OUT)"
fi

# --- (e) a locked account is not credential-less -------------------------------

shadow_locked
run_method config_get
if cli_ran; then
    ok "(e) locked root hash ('!') -> allowed: crypt() can never match it"
else
    bad "(e) a locked root account was refused (it is not credential-less)"
fi

# --- (f) the pre-auth probe ----------------------------------------------------

shadow_empty
run_method auth_status
if [ "$RC" = 0 ] && printf '%s' "$OUT" | grep -q 's state=empty' \
        && printf '%s' "$OUT" | grep -q 'b password_set=0'; then
    ok "(f) auth_status on an empty hash answers state=empty password_set=0"
else
    bad "(f) auth_status did not report the empty state (rc=$RC, out: $OUT)"
fi
if printf '%s' "$OUT" | grep -q 'no-admin-credential' || ! printf '%s' "$OUT" | grep -q 's state='; then
    bad "(f2) auth_status was refused — the board could not explain the state (out: $OUT)"
else
    ok "(f2) auth_status is the ONE method that still answers while unset"
fi

shadow_set
run_method auth_status
if printf '%s' "$OUT" | grep -q 's state=set' && printf '%s' "$OUT" | grep -q 'b password_set=1'; then
    ok "(f3) auth_status on a provisioned router answers state=set password_set=1"
else
    bad "(f3) auth_status did not report the set state (out: $OUT)"
fi
if printf '%s' "$OUT" | grep -q 'defghijklmnop'; then
    bad "(f4) the shadow HASH leaked through auth_status"
else
    ok "(f4) no hash material is exposed by the probe"
fi

shadow_locked
run_method auth_status
if printf '%s' "$OUT" | grep -q 's state=locked'; then
    ok "(f5) auth_status distinguishes a locked account from an unset one"
else
    bad "(f5) locked state not reported (out: $OUT)"
fi

# --- (g) rpcd needs the method advertised --------------------------------------

OUT=$(TOLLGATE_SHADOW_FILE="$SHADOW" PATH="$BIN:$PATH" sh "$TMP/plugin.sh" list 2>&1)
if printf '%s' "$OUT" | grep -q '"auth_status"'; then
    ok "(g) the plugin's list advertises auth_status (rpcd resolves the method)"
else
    bad "(g) list does not advertise auth_status"
fi
for m in config_get config_set wallet_drain_cashu upstream_connect; do
    if ! printf '%s' "$OUT" | grep -q "\"$m\""; then
        bad "(g2) list no longer advertises $m"
    fi
done

# --- (h) the ACL: the pre-auth group may reach auth_status and NOTHING else -----

if ! command -v node >/dev/null 2>&1; then
    bad "(h) node is required to validate $ACL (package.json engines requires node 22)"
else
    cat > "$TMP/acl-check.mjs" <<'MJS'
import { readFileSync } from 'node:fs';
const acl = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const line = (label, ok, detail) => console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ' — ' + detail : ''}`);
const pre = acl.unauthenticated;
const grp = acl.tollgate;
if (!pre) line('(h1) the "unauthenticated" ACL group exists', false, 'missing');
else {
  const methods = (pre.read && pre.read.ubus && pre.read.ubus.tollgate) || [];
  const writes = (pre.write && pre.write.ubus && pre.write.ubus.tollgate) || [];
  // `list` is how rpcd resolves a method name to its signature; a pre-auth
  // caller must not be able to enumerate anything either.
  const lists = (pre.list && pre.list.ubus && pre.list.ubus.tollgate) || [];
  line('(h1) the "unauthenticated" ACL group exists', true);
  line('(h2) it grants exactly ["auth_status"]',
       JSON.stringify([...methods].sort()) === JSON.stringify(['auth_status']),
       `granted: ${JSON.stringify(methods)}`);
  line('(h3) it grants no write access', writes.length === 0, JSON.stringify(writes));
  line('(h4) it grants no list access', lists.length === 0, JSON.stringify(lists));
  line('(h5) the description says what is exposed and why',
       typeof pre.description === 'string' && /auth_status/.test(pre.description));
}
if (!grp) line('(i1) the authenticated "tollgate" group still exists', false, 'missing');
else {
  const methods = [
    ...((grp.read && grp.read.ubus && grp.read.ubus.tollgate) || []),
    ...((grp.write && grp.write.ubus && grp.write.ubus.tollgate) || []),
  ];
  line('(i1) the authenticated "tollgate" group still exists', true);
  const needed = ['auth_status', 'config_get', 'config_set', 'config_save',
                  'wallet_balance', 'wallet_fund', 'wallet_drain_cashu',
                  'upstream_connect', 'upstream_list', 'status'];
  const missing = needed.filter((m) => !methods.includes(m));
  line('(i2) it still grants every method the board uses (read + write)',
       missing.length === 0, missing.length ? `missing: ${missing.join(', ')}` : '');
  line('(i3) the authenticated group carries write access for password_set/wallet drain',
       !!(grp.write && grp.write.ubus && grp.write.ubus.tollgate),
       'the board mutates state through this group');
  // The board is a root-capable surface: the guest-side ACL must not be able to
  // reach file exec / password_set / wallet drain from the pre-auth group.
  const pre = acl.unauthenticated;
  const preWrite = (pre && pre.write) || {};
  line('(i4) the pre-auth group has no access to `system.*` or `file.*` at all',
       !preWrite.ubus || (!preWrite.ubus.system && !preWrite.ubus.file),
       JSON.stringify(preWrite));
}
MJS
    ACL_OUT=$(node "$TMP/acl-check.mjs" "$ACL" 2>&1)
    ACL_RC=$?
    if [ "$ACL_RC" != 0 ]; then
        bad "(h) the ACL check crashed (rc=$ACL_RC): $ACL_OUT"
    else
        printf '%s\n' "$ACL_OUT" | while IFS= read -r l; do printf '%s\n' "$l"; done
        if printf '%s' "$ACL_OUT" | grep -q '^FAIL'; then
            fail=$((fail + $(printf '%s\n' "$ACL_OUT" | grep -c '^FAIL')))
        fi
        pass=$((pass + $(printf '%s\n' "$ACL_OUT" | grep -c '^PASS')))
    fi
fi

echo
echo "-- $pass passed, $fail failed --"
[ "$fail" = 0 ] || exit 1
exit 0
