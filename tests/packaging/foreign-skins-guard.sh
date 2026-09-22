#!/bin/sh
# Verification harness for the __FOREIGN_SKINS__ guard in
# packaging/files/etc/uci-defaults/92-tollgate-admin-setup.
#
# Extracts the cleanup loop VERBATIM from the shipped script (only the
# FOREIGN=... line is rewritten so the loop can be fed test tokens), runs it
# with stub `uci`/`rm` on PATH, and asserts what it tried to delete.

set -u

REPO=${1:?usage: harness.sh <repo-root>}
SCRIPT="$REPO/packaging/files/etc/uci-defaults/92-tollgate-admin-setup"
[ -f "$SCRIPT" ] || { echo "missing $SCRIPT"; exit 1; }

BIN=$(mktemp -d)
LOOP=$(mktemp)
trap 'rm -rf "$BIN" "$LOOP"' EXIT

cat > "$BIN/uci" <<'EOF'
#!/bin/sh
echo "UCI $*"
EOF
cat > "$BIN/rm" <<'EOF'
#!/bin/sh
echo "RM $*"
EOF
chmod +x "$BIN/uci" "$BIN/rm"
PATH="$BIN:$PATH"

# Loop body, verbatim except the FOREIGN= assignment.
sed -n '/^FOREIGN="__FOREIGN_SKINS__"/,/^done$/p' "$SCRIPT" |
  sed '1s|.*|FOREIGN="$TEST_FOREIGN"|' > "$LOOP"

fail=0
run_case() {
  desc=$1; admin_home=$2; tokens=$3; expect=$4
  out=$(ADMIN_HOME="$admin_home" TEST_FOREIGN="$tokens" PATH="$BIN:$PATH" sh -c '. "$1"' sh "$LOOP" 2>&1)
  if [ "$out" = "$expect" ]; then
    printf 'PASS  %-52s -> %s\n' "$desc" "${out:-<no action>}"
  else
    fail=$((fail + 1))
    printf 'FAIL  %-52s\n      expected: %s\n      actual:   %s\n' "$desc" "${expect:-<no action>}" "${out:-<no action>}"
  fi
}

# 1. A genuine foreign skin is still cleaned up (feature preserved).
run_case "foreign skin is removed" /www/tollgate "/www/othervendor:othervendor" \
  "UCI -q delete uhttpd.othervendor
RM -rf /www/othervendor"

# 2. This build's own webroot + section (byte-identical token) is spared.
run_case "own webroot via own section name is spared" /www/tollgate "/www/tollgate:admin" ""

# 3. This build's own webroot via a foreign section name is spared.
run_case "own webroot with foreign section is spared" /www/tollgate "/www/tollgate:othervendor" ""

# 4. Trailing slash must not slip past the guard.
run_case "trailing slash on own webroot is spared" /www/tollgate "/www/tollgate/:othervendor" ""

# 5. The admin uhttpd section must never be deleted, whatever the webroot.
run_case "admin uhttpd section is never deleted" /www/tollgate "/www/othervendor:admin" ""

# 6. LuCI's webroot must survive.
run_case "/www itself is spared" /www/tollgate "/www:luci" ""
run_case "/www/ is spared" /www/tollgate "/www/:luci" ""

# 7. Anything outside /www is not ours to delete.
run_case "path outside /www is spared" /www/tollgate "/etc/passwd:passwd" ""
run_case "bare relative token is spared" /www/tollgate "brand:brand" ""

# 8. Unsubstituted placeholder is a no-op.
run_case "unsubstituted placeholder is a no-op" /www/tollgate "__FOREIGN_SKINS__" ""

# 9. A branded build cleans the generic default + another vendor.
run_case "branded build cleans generic + other vendors" /www/acme \
  "/www/tollgate:tollgate /www/othervendor:othervendor" \
  "UCI -q delete uhttpd.tollgate
RM -rf /www/tollgate
UCI -q delete uhttpd.othervendor
RM -rf /www/othervendor"

# 10. Syntax check of the whole shipped script.
if sh -n "$SCRIPT"; then
  printf 'PASS  %-52s -> sh -n clean\n' "script parses"
else
  fail=$((fail + 1))
  printf 'FAIL  %s does not parse\n' "$SCRIPT"
fi

echo
if [ "$fail" -eq 0 ]; then
  echo "ALL GUARD CASES PASSED"
else
  echo "$fail GUARD CASE(S) FAILED"
  exit 1
fi
