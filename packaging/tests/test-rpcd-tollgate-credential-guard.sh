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
MARKER="$TMP/etc/admin-credential-provisional"
WIFI_MARKER="$TMP/etc/private-wifi-credential-provisional"
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
#
# Runs the plugin under the harness's own shell. `run_method_in SHELL METHOD
# [stdin]` runs it under another one — the backslash case needs a shell that
# really is POSIX-strict (dash), because the portability defect only shows there.
run_method_in() {
    _sh=$1
    _m=$2
    _in=${3:-}
    : > "$JSON_OUT"
    : > "$CALLS"
    if [ -n "$_in" ]; then
        OUT=$(printf '%s' "$_in" | \
            TOLLGATE_SHADOW_FILE="$SHADOW" \
            ADMIN_PROVISIONAL_MARKER="$MARKER" \
            PRIVATE_WIFI_PROVISIONAL_MARKER="$WIFI_MARKER" \
            TOLLGATE_CALLS="$CALLS" \
            JSON_OUT="$JSON_OUT" PATH="$BIN:$PATH" "$_sh" "$TMP/plugin.sh" call "$_m" 2>&1)
    else
        OUT=$(TOLLGATE_SHADOW_FILE="$SHADOW" \
            ADMIN_PROVISIONAL_MARKER="$MARKER" \
            PRIVATE_WIFI_PROVISIONAL_MARKER="$WIFI_MARKER" \
            TOLLGATE_CALLS="$CALLS" \
            JSON_OUT="$JSON_OUT" PATH="$BIN:$PATH" "$_sh" "$TMP/plugin.sh" call "$_m" 2>&1)
    fi
    RC=$?
}

run_method() {
    run_method_in sh "$@"
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

# --- (f6..f9) the provisional marker the board consumes -------------------------
# 99-tollgate-setup (the module half) MINTS the root password when the operator
# did not supply one and records that fact — never the value — in
# /etc/tollgate/admin-credential-provisional. The board forces a password choice
# at the first login while that marker stands and then drops it. The probe it
# reads must carry the marker state, and the claim must be the one thing that
# removes it.

provisional_marker() { printf 'generated, not chosen\n' > "$MARKER"; }
no_provisional_marker() { rm -f "$MARKER"; }

shadow_set
no_provisional_marker
run_method auth_status
if printf '%s' "$OUT" | grep -q 'b provisional=0'; then
    ok "(f6) auth_status says provisional=0 when the marker is absent"
else
    bad "(f6) a marker-less router was not reported provisional=0 (out: $OUT)"
fi

provisional_marker
run_method auth_status
if printf '%s' "$OUT" | grep -q 'b provisional=1' \
        && printf '%s' "$OUT" | grep -q 's state=set'; then
    ok "(f7) auth_status says provisional=1 (state=set) while the marker stands"
else
    bad "(f7) the marker was not reported on the pre-auth probe (out: $OUT)"
fi
if printf '%s' "$OUT" | grep -q 'generated, not chosen'; then
    bad "(f8) the marker FILE's contents leaked through the probe"
else
    ok "(f8) only the marker's existence is exposed, never its text"
fi

run_method admin_credential_claim
if [ "$RC" = 0 ] && [ ! -f "$MARKER" ] \
        && printf '%s' "$OUT" | grep -q 'b provisional=0'; then
    ok "(f9) admin_credential_claim removes the marker and reports provisional=0"
else
    bad "(f9) the claim did not drop the marker (rc=$RC, exists=$( [ -f "$MARKER" ] && echo yes || echo no ), out: $OUT)"
fi
if cli_ran; then
    bad "(f10) the claim shelled out to the tollgate CLI: $(cat "$CALLS")"
else
    ok "(f10) the claim is plugin-local (no CLI, no router action beyond the marker)"
fi

# The claim is a method that ACTS on the router, so it is behind the same
# fail-closed gate as every other one: an unusable credential may not drop the
# marker (that would let a router with no root password walk to the dashboard).
shadow_empty
provisional_marker
run_method admin_credential_claim
if printf '%s' "$OUT" | grep -q 's error=no-admin-credential' && [ -f "$MARKER" ]; then
    ok "(f11) the claim is REFUSED while root has no usable credential"
else
    bad "(f11) the claim ran (or dropped the marker) on an empty hash: exists=$( [ -f "$MARKER" ] && echo yes || echo no ), out: $OUT"
fi

shadow_gone
run_method admin_credential_claim
if printf '%s' "$OUT" | grep -q 's error=no-admin-credential' && [ -f "$MARKER" ]; then
    ok "(f12) the claim fails closed when the credential state is unreadable"
else
    bad "(f12) the claim did not fail closed on an unreadable shadow (out: $OUT)"
fi

# --- (g) rpcd needs the method advertised --------------------------------------

OUT=$(TOLLGATE_SHADOW_FILE="$SHADOW" ADMIN_PROVISIONAL_MARKER="$MARKER" PATH="$BIN:$PATH" sh "$TMP/plugin.sh" list 2>&1)
if printf '%s' "$OUT" | grep -q '"auth_status"'; then
    ok "(g) the plugin's list advertises auth_status (rpcd resolves the method)"
else
    bad "(g) list does not advertise auth_status"
fi
if printf '%s' "$OUT" | grep -q '"admin_credential_claim"'; then
    ok "(g1) the plugin's list advertises admin_credential_claim"
else
    bad "(g1) list does not advertise admin_credential_claim (rpcd would 404 the claim)"
fi
if printf '%s' "$OUT" | grep -q '"admin_credential_setup"'; then
    ok "(g3) the plugin's list advertises admin_credential_setup"
else
    bad "(g3) list does not advertise admin_credential_setup (rpcd would 404 the first-run call)"
fi
for m in config_get config_set wallet_drain_cashu upstream_connect; do
    if ! printf '%s' "$OUT" | grep -q "\"$m\""; then
        bad "(g2) list no longer advertises $m"
    fi
done

# --- (j..n) the pre-auth first-run setup: admin_credential_setup ----------------
#
# PR #70 shipped this method with three load-bearing defects, all found by
# execution (review t_a35eebde). Each fix is pinned by BEHAVIOUR, never by
# implementation, so a rewrite keeps the guarantee:
#
#   (j) the post-`passwd` verification was VACUOUS: it accepted any pre-state,
#       and `set` is also the PRE-state on the normal first-run path (the
#       installer already minted a credential). So a FAILED passwd — read-only
#       /etc, full disk, unwritable shadow — left state=set, and the method
#       reported success, told the owner "sign in with it", and dropped the
#       one-shot marker. The typed password was never applied, the generated one
#       was never printed (that is the point of the feature), and the forced page
#       never came back: a permanent lockout of the management board. Comparing
#       STATES cannot fix it (pre == post == set on the happy path); only the
#       hash STRING distinguishes a write that landed from one that did not.
#   (k) an out-of-bounds wifi_passphrase was silently skipped while the reply
#       said success and the window closed. The installed key stayed, and nobody
#       can recover it: the module does not print that one either.
#   (l) every `uci`/`ubus` exit code was discarded, so a write that did not land
#       still reported success and closed the window.
#   (m) a newline in the password broke the `printf '%s\n%s\n' | passwd` idiom,
#       and `echo "$INPUT" | jsonfilter` is not POSIX-safe (dash eats the
#       backslashes a JSON body is full of).
#   (n) `uci set` on a missing NAMED section CREATES it, so the unconditional
#       writes minted a phantom wifi-iface on a single-band router.
#
# Every case drives the SHIPPED plugin through stubs for passwd/uci/ubus/
# jsonfilter. Nothing outside $TMP is touched: both markers, the shadow file and
# the uci database live under $TMP (asserted immediately below).

for _fixture in "$MARKER" "$WIFI_MARKER" "$SHADOW"; do
    case "$_fixture" in
        "$TMP"/*) : ;;
        *) echo "FAIL: a test fixture escapes \$TMP: $_fixture" >&2; exit 2 ;;
    esac
done

UCI_STATE="$TMP/uci.state"
UCI_LOG="$TMP/uci.log"
UBUS_LOG="$TMP/ubus.log"
PASSWD_STDIN="$TMP/passwd.stdin"
PASSWD_CALLED="$TMP/passwd.called"
export UCI_STATE UCI_LOG UBUS_LOG PASSWD_STDIN PASSWD_CALLED

# --- stub jsonfilter -----------------------------------------------------------
# The real tool reads a JSON body on stdin and prints ONE field. Node does the
# parsing here because a shell stub cannot: naive text handling of a JSON body is
# precisely what the backslash case below exists to catch, and a stub that shared
# the bug could never expose it. Node is already required by the ACL half of this
# harness.
cat > "$TMP/jsonfilter.cjs" <<'JF'
const fs = require('node:fs');
const args = process.argv.slice(2);
const i = args.indexOf('-e');
const expr = i >= 0 ? String(args[i + 1] || '') : '';
const key = expr.startsWith('@.') ? expr.slice(2) : expr;
let raw = '';
try { raw = fs.readFileSync(0, 'utf8'); } catch { /* no stdin */ }
try {
  const val = JSON.parse(raw)[key];
  if (typeof val === 'string') process.stdout.write(val);
} catch { /* a real jsonfilter prints nothing and exits non-zero */ }
JF
# Absolute path baked in: the plugin runs as a child process with this stub on
# PATH, so it must not depend on any variable from the harness shell.
printf '#!/bin/sh\nexec node %s "$@"\n' "'$TMP/jsonfilter.cjs'" > "$BIN/jsonfilter"
chmod +x "$BIN/jsonfilter"

# --- stub uci ------------------------------------------------------------------
# A minimal uci over "$key=value" lines, faithful exactly where the plugin
# depends on it:
#   - `get` prints the value and exits 0, or prints nothing and exits 1;
#   - `set` on a NAMED section that does not exist CREATES it (real uci does;
#     that is how a single-band router grows a phantom private_radio1);
#   - every operation has an injectable failure, because "the write did not
#     land" is the case being pinned.
cat > "$BIN/uci" <<'UCI'
#!/bin/sh
argv="$*"
if [ "${1:-}" = "-q" ]; then shift; fi
cmd=${1:-}
if [ $# -gt 0 ]; then shift; fi
printf 'uci %s\n' "$argv" >> "$UCI_LOG"
case "$cmd" in
  get)
    key=${1:-}
    while IFS= read -r line; do
      case "$line" in
        "$key"=*) printf '%s\n' "${line#*=}"; exit 0 ;;
      esac
    done < "$UCI_STATE"
    exit 1
    ;;
  set)
    kv=${1:-}
    case "$kv" in
      *=*) : ;;
      *) exit 1 ;;
    esac
    if [ "${UCI_SET_FAIL:-0}" = "1" ]; then exit 1; fi
    key=${kv%%=*}
    val=${kv#*=}
    sect=${key%.*}
    if [ "$sect" != "$key" ]; then
      found=0
      while IFS= read -r line; do
        case "$line" in
          "$sect"=*) found=1; break ;;
        esac
      done < "$UCI_STATE"
      if [ "$found" = "0" ]; then
        printf '%s=wifi-iface\n' "$sect" >> "$UCI_STATE"
        printf 'created %s\n' "$sect" >> "$UCI_LOG"
      fi
    fi
    if [ "${UCI_SILENT_DROP:-0}" = "1" ]; then exit 0; fi
    : > "$UCI_STATE.new"
    while IFS= read -r line; do
      case "$line" in
        "$key"=*) continue ;;
      esac
      printf '%s\n' "$line" >> "$UCI_STATE.new"
    done < "$UCI_STATE"
    printf '%s=%s\n' "$key" "$val" >> "$UCI_STATE.new"
    mv "$UCI_STATE.new" "$UCI_STATE"
    exit 0
    ;;
  commit)
    if [ "${UCI_COMMIT_FAIL:-0}" = "1" ]; then exit 1; fi
    exit 0
    ;;
esac
exit 0
UCI
chmod +x "$BIN/uci"

# --- stub ubus -----------------------------------------------------------------
cat > "$BIN/ubus" <<'UBUS'
#!/bin/sh
printf 'ubus %s\n' "$*" >> "$UBUS_LOG"
case "$*" in
  *reload*)
    if [ "${UBUS_RELOAD_FAIL:-0}" = "1" ]; then exit 1; fi
    ;;
esac
exit 0
UBUS
chmod +x "$BIN/ubus"

# --- stub passwd ---------------------------------------------------------------
# BusyBox `passwd` reads the new password TWICE from stdin. This stub keeps the
# exact bytes it was fed — so a case can prove WHAT would have been set, not just
# that something happened — and then updates root's hash the way a successful
# passwd would. The hash is derived from the password, so it differs from every
# fixture pre-state; PASSWD_FAIL and PASSWD_NOOP model the two ways a real passwd
# lets the caller down (it errors, or it lies).
cat > "$BIN/passwd" <<'PW'
#!/bin/sh
printf 'called with: %s\n' "$*" > "$PASSWD_CALLED"
cat > "$PASSWD_STDIN"
if [ "${PASSWD_FAIL:-0}" = "1" ]; then exit 1; fi
if [ "${PASSWD_NOOP:-0}" = "1" ]; then exit 0; fi
pw=$(sed -n '1p' "$PASSWD_STDIN")
new='$1$stub$'"$(printf '%s' "$pw" | md5sum | cut -d' ' -f1)"
# TOLLGATE_SHADOW_FILE is the variable the harness exports to the plugin; the
# plugin's own $SHADOW_FILE is a shell local and never reaches a child.
awk -F: -v h="$new" 'BEGIN{OFS=":"} $1=="root"{$2=h}{print}' "$TOLLGATE_SHADOW_FILE" > "$TOLLGATE_SHADOW_FILE.tmp" \
    && mv "$TOLLGATE_SHADOW_FILE.tmp" "$TOLLGATE_SHADOW_FILE"
exit 0
PW
chmod +x "$BIN/passwd"

# --- fixtures and helpers ------------------------------------------------------

# The uci database a provisioned dual-band router carries.
two_radios() {
    : > "$UCI_STATE"
    printf 'wireless.private_radio0=wifi-iface\nwireless.private_radio0.key=generated-key-0\n' >> "$UCI_STATE"
    printf 'wireless.private_radio1=wifi-iface\nwireless.private_radio1.key=generated-key-1\n' >> "$UCI_STATE"
}
# A single-band router: the module's setup deletes a stale radio1.
one_radio() {
    : > "$UCI_STATE"
    printf 'wireless.private_radio0=wifi-iface\nwireless.private_radio0.key=generated-key-0\n' >> "$UCI_STATE"
}
wifi_provisional_marker() { printf 'generated, not chosen\n' > "$WIFI_MARKER"; }

reset_stubs() {
    : > "$UCI_LOG"
    : > "$UBUS_LOG"
    : > "$PASSWD_STDIN"
    : > "$PASSWD_CALLED"
    UCI_SET_FAIL=0; UCI_COMMIT_FAIL=0; UCI_SILENT_DROP=0
    UBUS_RELOAD_FAIL=0; PASSWD_FAIL=0; PASSWD_NOOP=0
    export UCI_SET_FAIL UCI_COMMIT_FAIL UCI_SILENT_DROP UBUS_RELOAD_FAIL PASSWD_FAIL PASSWD_NOOP
}

# The normal first-run state: the installer already minted a credential (so the
# hash is `set`, NOT empty), both markers stand, and nobody has logged in.
first_run() {
    shadow_set
    provisional_marker
    wifi_provisional_marker
    reset_stubs
    two_radios
}

# json_body PASSWORD PASSWORD2 WIFI — the SPA's own payload shape. Arguments are
# inserted as JSON-ready text; a value that needs escaping is written inline by
# the case that needs it.
json_body() {
    printf '{"password":"%s","password2":"%s","wifi_passphrase":"%s"}' "$1" "$2" "$3"
}

passwd_ran() { [ -s "$PASSWD_CALLED" ]; }

echo
echo "== (j) a passwd that did not land must never report success =="

first_run
PASSWD_FAIL=1
run_method admin_credential_setup "$(json_body 'correct-horse' 'correct-horse' '')"
if printf '%s' "$OUT" | grep -q 's error=password-not-applied' \
        && printf '%s' "$OUT" | grep -q 'b success=0'; then
    ok "(j1) a FAILED passwd is refused (password-not-applied), not reported as success"
else
    bad "(j1) a failed passwd still reported success — the owner is told the password is set (out: $OUT)"
fi
if [ -f "$MARKER" ]; then
    ok "(j2) the one-shot marker SURVIVES a refused passwd (the forced page can retry)"
else
    bad "(j2) the marker was dropped although the password was never applied (permanent lockout)"
fi
if [ -f "$WIFI_MARKER" ]; then
    ok "(j3) the WiFi marker is untouched by a refusal"
else
    bad "(j3) the WiFi marker was dropped on a refused passwd"
fi

first_run
PASSWD_NOOP=1
run_method admin_credential_setup "$(json_body 'correct-horse' 'correct-horse' '')"
if printf '%s' "$OUT" | grep -q 's error=password-not-applied' && [ -f "$MARKER" ]; then
    ok "(j4) a passwd that EXITS 0 but changes nothing is refused (the exit code is not the proof)"
else
    bad "(j4) a silent passwd failure was accepted (out: $OUT, marker=$( [ -f "$MARKER" ] && echo kept || echo dropped ))"
fi

first_run
shadow_locked
PASSWD_FAIL=1
run_method admin_credential_setup "$(json_body 'correct-horse' 'correct-horse' '')"
if printf '%s' "$OUT" | grep -q 's error=password-not-applied' && [ -f "$MARKER" ]; then
    ok "(j5) a LOCKED pre-state plus a failed passwd is refused ('locked' is not an acceptance arm)"
else
    bad "(j5) a locked account was treated as a successful password change (out: $OUT)"
fi

# The obvious wrong fix — "refuse unless the STATE changed" — refuses every
# normal first-run, because the pre-state is already `set`. This case is the
# guard against that trap.
first_run
run_method admin_credential_setup "$(json_body 'correct-horse' 'correct-horse' '')"
if printf '%s' "$OUT" | grep -q 'b success=1' && [ ! -f "$MARKER" ]; then
    ok "(j6) the NORMAL first-run path (pre-state already 'set') succeeds and drops the marker"
else
    bad "(j6) the normal first-run was refused — a state comparison instead of a hash comparison? (out: $OUT)"
fi
if printf '%s' "$(cat "$SHADOW")" | grep -q 'stub'; then
    ok "(j7) the shadow hash actually changed (the passwd stub's write landed)"
else
    bad "(j7) the fixture never saw a hash write — the case above proves nothing"
fi

echo
echo "== (k) an out-of-bounds WiFi passphrase is refused BEFORE passwd =="

first_run
run_method admin_credential_setup "$(json_body 'correct-horse' 'correct-horse' 'seven77')"
if printf '%s' "$OUT" | grep -q 's error=weak-wifi-passphrase' \
        && printf '%s' "$OUT" | grep -q 'b success=0'; then
    ok "(k1) a 7-character wifi_passphrase is REFUSED (weak-wifi-passphrase)"
else
    bad "(k1) an out-of-bounds wifi_passphrase was accepted (out: $OUT)"
fi
if passwd_ran; then
    bad "(k2) passwd ran before the wifi refusal: $(cat "$PASSWD_CALLED")"
else
    ok "(k2) the refusal happens BEFORE passwd — a rejected passphrase costs nothing"
fi
if [ -f "$MARKER" ] && [ -f "$WIFI_MARKER" ]; then
    ok "(k3) both markers survive the refusal (the owner can correct the passphrase)"
else
    bad "(k3) a marker was dropped on a refused wifi passphrase"
fi
if grep -q 'wireless.private_radio0.key=generated-key-0' "$UCI_STATE"; then
    ok "(k4) the installed WiFi key was NOT overwritten by a refused passphrase"
else
    bad "(k4) the WiFi key changed although the passphrase was refused"
fi

first_run
WIFI64=$(printf '%064d' 0)
run_method admin_credential_setup "$(json_body 'correct-horse' 'correct-horse' "$WIFI64")"
if printf '%s' "$OUT" | grep -q 's error=weak-wifi-passphrase' && ! passwd_ran; then
    ok "(k5) a 64-character wifi_passphrase is REFUSED (WPA2-PSK upper bound)"
else
    bad "(k5) a 64-character passphrase was accepted (out: $OUT)"
fi

first_run
WIFI8=$(printf '%08d' 0)
run_method admin_credential_setup "$(json_body 'correct-horse' 'correct-horse' "$WIFI8")"
if printf '%s' "$OUT" | grep -q 'b success=1' && grep -q 'wireless.private_radio0.key=00000000' "$UCI_STATE"; then
    ok "(k6) exactly 8 characters is ACCEPTED (the lower bound is not off by one)"
else
    bad "(k6) an 8-character passphrase was refused (out: $OUT)"
fi

first_run
WIFI63=$(printf '%063d' 0)
run_method admin_credential_setup "$(json_body 'correct-horse' 'correct-horse' "$WIFI63")"
if printf '%s' "$OUT" | grep -q 'b success=1'; then
    ok "(k7) exactly 63 characters is ACCEPTED (the upper bound is not off by one)"
else
    bad "(k7) a 63-character passphrase was refused (out: $OUT)"
fi

echo
echo "== (l) a uci/ubus write that failed must refuse BEFORE the markers go =="

first_run
UCI_SET_FAIL=1
run_method admin_credential_setup "$(json_body 'correct-horse' 'correct-horse' 'stable-network')"
if printf '%s' "$OUT" | grep -q 's error=wifi-not-applied' \
        && printf '%s' "$OUT" | grep -q 'b success=0'; then
    ok "(l1) a failing 'uci set' is REFUSED (wifi-not-applied)"
else
    bad "(l1) a failing 'uci set' still reported success (out: $OUT)"
fi
if [ -f "$MARKER" ] && [ -f "$WIFI_MARKER" ]; then
    ok "(l2) both markers survive a failed uci write"
else
    bad "(l2) the window closed although the WiFi write failed"
fi

first_run
UCI_COMMIT_FAIL=1
run_method admin_credential_setup "$(json_body 'correct-horse' 'correct-horse' 'stable-network')"
if printf '%s' "$OUT" | grep -q 's error=wifi-not-applied' && [ -f "$MARKER" ]; then
    ok "(l3) a failing 'uci commit' is REFUSED"
else
    bad "(l3) a failing 'uci commit' still reported success (out: $OUT)"
fi

first_run
UBUS_RELOAD_FAIL=1
run_method admin_credential_setup "$(json_body 'correct-horse' 'correct-horse' 'stable-network')"
if printf '%s' "$OUT" | grep -q 's error=wifi-not-reloaded' && [ -f "$MARKER" ]; then
    ok "(l4) a failing 'ubus call network.wireless reload' is REFUSED (wifi-not-reloaded)"
else
    bad "(l4) a failing wireless reload still reported success (out: $OUT)"
fi

first_run
UCI_SILENT_DROP=1
run_method admin_credential_setup "$(json_body 'correct-horse' 'correct-horse' 'stable-network')"
if printf '%s' "$OUT" | grep -q 's error=wifi-not-applied' && [ -f "$MARKER" ]; then
    ok "(l5) a 'uci set' that exits 0 without writing is caught by the re-read"
else
    bad "(l5) a silently dropped uci write was accepted (out: $OUT)"
fi

# A refusal after the password landed must SAY so: the owner can log in, and a
# reply that pretends nothing happened would send them round the loop.
if printf '%s' "$OUT" | grep -q 'b password_set=1'; then
    ok "(l6) a post-passwd WiFi refusal reports password_set=1 (the admin half really did land)"
else
    bad "(l6) the WiFi refusal did not tell the owner the admin password is set (out: $OUT)"
fi

first_run
run_method admin_credential_setup "$(json_body 'correct-horse' 'correct-horse' 'stable-network')"
if printf '%s' "$OUT" | grep -q 'b success=1' \
        && [ ! -f "$MARKER" ] && [ ! -f "$WIFI_MARKER" ] \
        && grep -q 'wireless.private_radio0.key=stable-network' "$UCI_STATE" \
        && grep -q 'wireless.private_radio1.key=stable-network' "$UCI_STATE" \
        && grep -q 'commit wireless' "$UCI_LOG" \
        && grep -q 'reload' "$UBUS_LOG"; then
    ok "(l7) the healthy path still sets BOTH radios, commits, reloads and drops both markers"
else
    bad "(l7) the healthy path regressed (out: $OUT, uci: $(tr '\n' ';' < "$UCI_STATE"))"
fi
if grep -q 'set wireless.private_radio0.key=stable-network' "$UCI_LOG"; then
    ok "(l8) the uci writes still carry the passphrase (the checks did not change the write)"
else
    bad "(l8) the uci write log does not show the expected set: $(cat "$UCI_LOG")"
fi

echo
echo "== (m) control characters, POSIX-safe jsonfilter feeding, skippable password2 =="

first_run
run_method admin_credential_setup \
    '{"password":"line-one\nline-two","password2":"line-one\nline-two","wifi_passphrase":""}'
if printf '%s' "$OUT" | grep -q 's error=invalid-password'; then
    ok "(m1) a password containing a newline is REFUSED before passwd"
else
    bad "(m1) a multi-line password was handed to passwd (out: $OUT)"
fi
if passwd_ran; then
    bad "(m2) passwd ran on a password it cannot set: $(tr '\n' '|' < "$PASSWD_STDIN")"
else
    ok "(m2) passwd was never called for the control-character refusal"
fi

# `echo "$INPUT"` is not POSIX-safe: dash interprets backslashes, and a JSON body
# is full of them (JSON.stringify spells one typed backslash as two). Under dash
# the body below no longer parses, so the password silently becomes empty — which
# is how a typed password turns into a mangled or missing one. Run under a
# POSIX-strict shell so the case means something.
STRICT_SH=$(command -v dash 2>/dev/null) || STRICT_SH=sh
first_run
run_method_in "$STRICT_SH" admin_credential_setup \
    '{"password":"pa\\ss-word-8","password2":"pa\\ss-word-8","wifi_passphrase":""}'
printf '%s\n%s\n' 'pa\ss-word-8' 'pa\ss-word-8' > "$TMP/expected.stdin"
if cmp -s "$TMP/expected.stdin" "$PASSWD_STDIN"; then
    ok "(m3) a backslash in the password reaches passwd BYTE-EXACT under $(basename "$STRICT_SH")"
else
    bad "(m3) the password was corrupted in transit under $(basename "$STRICT_SH") (fed: $(od -c "$PASSWD_STDIN" | tr '\n' ' '))"
fi
if [ -f "$MARKER" ]; then
    bad "(m4) the marker survived a successful setup"
else
    ok "(m4) that same request succeeded and dropped the marker (the parse was not merely empty)"
fi

first_run
run_method admin_credential_setup '{"password":"correct-horse","wifi_passphrase":""}'
if printf '%s' "$OUT" | grep -q 'b success=1' && [ ! -f "$MARKER" ]; then
    ok "(m5) omitting password2 is allowed for a direct caller (confirmation is the form's, not a control)"
else
    bad "(m5) a body without password2 was refused (out: $OUT)"
fi

echo
echo "== (n) only the private radios that EXIST are written =="

first_run
one_radio
run_method admin_credential_setup "$(json_body 'correct-horse' 'correct-horse' 'stable-network')"
if grep -q 'wireless.private_radio0.key=stable-network' "$UCI_STATE"; then
    ok "(n1) the radio that exists gets the passphrase"
else
    bad "(n1) the existing radio was not written: $(tr '\n' ';' < "$UCI_STATE")"
fi
if grep -q 'wireless.private_radio1' "$UCI_STATE"; then
    bad "(n2) a phantom wireless.private_radio1 section was CREATED on a single-band router"
else
    ok "(n2) no phantom private_radio1 section is created on a single-band router"
fi
if printf '%s' "$OUT" | grep -q 'b success=1'; then
    ok "(n3) the single-radio setup still reports success"
else
    bad "(n3) the single-radio setup was refused (out: $OUT)"
fi

echo
echo "== (o) no passphrase requested: the WiFi marker keeps the page asking =="

# The board's own contract (#71): the WiFi choice is forced while the WiFi
# marker stands, so a setup that did not set a passphrase must NOT clear it.
# Clearing it would silently accept the package default as the owner's choice.
first_run
run_method admin_credential_setup "$(json_body 'correct-horse' 'correct-horse' '')"
if [ ! -f "$MARKER" ] && [ -f "$WIFI_MARKER" ]; then
    ok "(o1) the admin marker goes, the WiFi marker STAYS (the forced WiFi choice persists)"
else
    bad "(o1) marker state wrong: admin=$( [ -f "$MARKER" ] && echo present || echo gone ) wifi=$( [ -f "$WIFI_MARKER" ] && echo present || echo gone ) (out: $OUT)"
fi
if grep -q 'uci set wireless' "$UCI_LOG"; then
    bad "(o2) a wireless write happened although no passphrase was sent: $(cat "$UCI_LOG")"
else
    ok "(o2) no wireless write is attempted without a passphrase"
fi

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
  // The ONE sanctioned pre-auth write is the first-run `admin_credential_setup`
  // (#70): it runs only while the install-time marker stands, and it is how the
  // board lets the owner choose their own admin password with NO session. Any
  // OTHER write from a session-less caller would be a hole.
  line('(h3) its only write is the pre-auth admin_credential_setup',
       JSON.stringify([...writes].sort()) === JSON.stringify(['admin_credential_setup']),
       JSON.stringify(writes));
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
  // The claim drops /etc/tollgate/admin-credential-provisional: it is a WRITE on
  // the authenticated surface, and the board can only finish the forced password
  // choice if this group carries it.
  const writes = (grp.write && grp.write.ubus && grp.write.ubus.tollgate) || [];
  line('(i5) the authenticated group may claim the provisional credential',
       writes.includes('admin_credential_claim'),
       `write methods: ${JSON.stringify(writes)}`);
  const preWrites =
    (((acl.unauthenticated || {}).write || {}).ubus || {}).tollgate || [];
  line('(i6) the pre-auth group may NOT claim it (no session, no marker write)',
       !preWrites.includes('admin_credential_claim'),
       'the claim needs a session');
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
