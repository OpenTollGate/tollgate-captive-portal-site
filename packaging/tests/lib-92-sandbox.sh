#!/bin/sh
# lib-92-sandbox.sh — shared OFFLINE sandbox for whole-script tests of
# packaging/files/etc/uci-defaults/92-tollgate-admin-setup.
#
# This is SOURCED by a test, never executed on its own, and it is not a CI
# entry point. It exists because the mode-aware mapping (D2/D4 in
# docs/architecture/default-ui-and-entry-port-decision.md) is a WHOLE-SCRIPT
# property — which pair uhttpd.admin binds, what the D4 marker says, and that no
# admin port reaches nodogsplash's pre-auth list on ANY path — and an
# extract-blocks harness (the shape of test-92-admin-board-tls.sh) can only see
# one block at a time.
#
# How it stays safe: the shipped script is COPIED into a private temp dir and
# every absolute path it touches is rewritten to point inside that dir, so the
# copy cannot read or write the host. Fake `uci`, `jq`, `tollgate` and the
# /etc/init.d/{rpcd,uhttpd} init scripts live in the temp dir's bin/. No root, no
# network, no apk, no uhttpd. The shipped script itself is never executed where
# it ships (only the rewritten copy is), and it is parsed with `sh -n` first.
#
# Caller contract:
#   TMP=$(mktemp -d "${TMPDIR:-/tmp}/tg-92-sbx.XXXXXX") || exit 2
#   trap 'rm -rf "$TMP"' EXIT INT TERM
#   . "$HERE/lib-92-sandbox.sh"
#   sb_init "$TMP" "$SCRIPT"
#
# Ports (D2): board = entry pair 8080(HTTP)/443(TLS); the other section keeps the
# secondary pair 8090/8443. luci = today's mapping (main 8080/443, admin
# 8090/8443). These are the LITERAL lists the tests assert against.

sb_init() { # sb_init <tmpdir> <shipped-script>
    SB_TMP=$1
    SB_SRC=$2
    SB_BIN="$SB_TMP/bin"
    SB_STATE="$SB_TMP/uci.state"
    SB_UCI_LOG="$SB_TMP/uci.log"
    SB_RESTART_LOG="$SB_TMP/uhttpd.restarts"
    SB_STDOUT="$SB_TMP/stdout.txt"
    SB_STDERR="$SB_TMP/stderr.txt"
    SB_SHADOW="$SB_TMP/etc/shadow"
    SB_SSL_CRT="$SB_TMP/etc/tollgate/ssl/server.crt"
    SB_SSL_KEY="$SB_TMP/etc/tollgate/ssl/server.key"
    SB_IMG_CRT="$SB_TMP/etc/uhttpd.crt"
    SB_IMG_KEY="$SB_TMP/etc/uhttpd.key"
    SB_CONFIG="$SB_TMP/etc/tollgate/config.json"
    SB_MARKER="$SB_TMP/etc/tollgate/entry-ui-mapping"
    SB_CLI="$SB_BIN/tollgate"
    SB_CLI_GONE="$SB_TMP/no-cli/tollgate"
    SB_COVERAGE="$SB_TMP/coverage"
    SB_ADMIN_HOME="$SB_TMP/www/tollgate"
    SB_PROC_TCP="$SB_TMP/proc/net/tcp"
    SB_PROC_TCP6="$SB_TMP/proc/net/tcp6"
    SB_RPCD_INIT="$SB_TMP/etc/init.d/rpcd"
    SB_UHTTPD_INIT="$SB_TMP/etc/init.d/uhttpd"
    SB_SCRIPT="$SB_TMP/92-under-test.sh"

    mkdir -p "$SB_BIN" "$SB_TMP/etc/ssl" "$SB_TMP/etc/tollgate/ssl" \
        "$SB_TMP/etc/init.d" "$SB_TMP/proc/net" "$SB_ADMIN_HOME"
    : > "$SB_STATE"
    : > "$SB_UCI_LOG"
    : > "$SB_RESTART_LOG"

    sb_rewrite
    sb_stubs

    SB_PASS=0
    SB_FAIL=0
}

# Rewrite EVERY absolute path the script touches into $SB_TMP. Two sed passes via
# placeholders (one pass is wrong: the replacement for /proc/net/tcp6 itself
# contains /proc/net/tcp, so a later rule would re-match what an earlier rule
# inserted).
sb_rewrite() {
    sed \
        -e 's|/usr/bin/tollgate|@@CLI@@|g' \
        -e 's|/etc/uhttpd\.crt|@@IMGCRT@@|g' \
        -e 's|/etc/uhttpd\.key|@@IMGKEY@@|g' \
        -e 's|/proc/net/tcp6|@@TCP6@@|g' \
        -e 's|/proc/net/tcp|@@TCP@@|g' \
        -e 's|/etc/init\.d/uhttpd|@@UHTTPD@@|g' \
        -e 's|/etc/init\.d/rpcd|@@RPCD@@|g' \
        -e 's|/etc/tollgate/|@@TGDIR@@|g' \
        -e 's|/etc/shadow|@@SHADOW@@|g' \
        -e 's|/www/tollgate|@@ADMINHOME@@|g' "$SB_SRC" |
        sed \
            -e "s|@@CLI@@|$SB_CLI|g" \
            -e "s|@@IMGCRT@@|$SB_IMG_CRT|g" \
            -e "s|@@IMGKEY@@|$SB_IMG_KEY|g" \
            -e "s|@@TCP6@@|$SB_PROC_TCP6|g" \
            -e "s|@@TCP@@|$SB_PROC_TCP|g" \
            -e "s|@@UHTTPD@@|$SB_UHTTPD_INIT|g" \
            -e "s|@@RPCD@@|$SB_RPCD_INIT|g" \
            -e "s|@@TGDIR@@|$SB_TMP/etc/tollgate/|g" \
            -e "s|@@SHADOW@@|$SB_SHADOW|g" \
            -e "s|@@ADMINHOME@@|$SB_ADMIN_HOME|g" > "$SB_SCRIPT"
}

sb_stubs() {
    # Fake `uci`: the subset the shipped script uses, backed by a flat key=value
    # state file. `get` space-joins a list with NO trailing space (as real uci
    # does); `-q get <missing>` exits non-zero; `show <pkg>` prints every line.
    # An unhandled verb is a FAILURE, never a silent no-op — a silent no-op would
    # make every assertion about that verb a tautology.
    cat > "$SB_BIN/uci" <<'STUB'
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
        out=""; found=0
        while IFS= read -r line; do
            case "$line" in
                "$key="*)
                    if [ "$found" = 1 ]; then out="$out ${line#*=}"
                    else out="${line#*=}"; found=1; fi ;;
            esac
        done < "$STATE"
        [ "$found" = 1 ] || exit 1
        printf '%s\n' "$out" ;;
    set)
        grep -v -F -- "$key=" "$STATE" 2>/dev/null > "$STATE.tmp" || : > "$STATE.tmp"
        printf '%s=%s\n' "$key" "$val" >> "$STATE.tmp"
        mv "$STATE.tmp" "$STATE" ;;
    add_list)
        grep -F -x -- "$key=$val" "$STATE" >/dev/null 2>&1 ||
            printf '%s=%s\n' "$key" "$val" >> "$STATE" ;;
    del_list)
        grep -v -F -x -- "$key=$val" "$STATE" 2>/dev/null > "$STATE.tmp" || : > "$STATE.tmp"
        mv "$STATE.tmp" "$STATE" ;;
    delete)
        grep -v -F -- "$key=" "$STATE" 2>/dev/null > "$STATE.tmp" || : > "$STATE.tmp"
        mv "$STATE.tmp" "$STATE" ;;
    show)
        [ -f "$STATE" ] || exit 1
        grep -F "$key." "$STATE" 2>/dev/null || exit 1 ;;
    commit) : ;;
    *) echo "stub uci: unexpected verb '$cmd'" >&2; exit 9 ;;
esac
exit 0
STUB
    chmod +x "$SB_BIN/uci"

    # Fake `jq`: only the one form the module and this script share —
    # `jq -r '.entry_ui // empty' <file>`. A missing file exits non-zero with no
    # output (so the resolver falls back), exactly like the real tool.
    cat > "$SB_BIN/jq" <<'STUB'
#!/bin/sh
# the file is the LAST argument of `jq -r '.entry_ui // empty' <file>`
f=""
for a in "$@"; do f="$a"; done
[ -n "$f" ] || exit 2
[ -f "$f" ] || exit 5
v=$(sed -n 's/.*"entry_ui"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$f" | head -n 1)
[ -n "$v" ] && printf '%s\n' "$v"
exit 0
STUB
    chmod +x "$SB_BIN/jq"

    # Fake `tollgate`: `ssl covers <cert>` is exit 0 (= covers this router) only
    # for the PROVISIONED path, while $FAKE_COVERAGE says "covering" — the
    # contract of the real x509 SAN check, where a missing/empty file is refused.
    cat > "$SB_CLI" <<'STUB'
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
    chmod +x "$SB_CLI"

    for init in "$SB_RPCD_INIT" "$SB_UHTTPD_INIT"; do
        cat > "$init" <<'STUB'
#!/bin/sh
printf '%s\n' "$*" >> "${RESTART_LOG:-/dev/null}"
exit 0
STUB
        chmod +x "$init"
    done
}

# --- state helpers -----------------------------------------------------------

sb_reset() { # fresh fixture state: both sections exist, empty of listeners
    : > "$SB_STATE"
    printf 'uhttpd.main=uhttpd\n' >> "$SB_STATE"
    printf 'uhttpd.admin=uhttpd\n' >> "$SB_STATE"
    : > "$SB_RESTART_LOG"
    : > "$SB_UCI_LOG"
    : > "$SB_STDOUT"
    : > "$SB_STDERR"
}

sb_set() { # key value
    grep -v -F -- "$1=" "$SB_STATE" 2>/dev/null > "$SB_STATE.tmp" || : > "$SB_STATE.tmp"
    printf '%s=%s\n' "$1" "$2" >> "$SB_STATE.tmp"
    mv "$SB_STATE.tmp" "$SB_STATE"
}

sb_add() { # key value (add_list semantics)
    grep -F -x -- "$1=$2" "$SB_STATE" >/dev/null 2>&1 ||
        printf '%s=%s\n' "$1" "$2" >> "$SB_STATE"
}

sb_get() { # key -> last value (as the shipped script reads it)
    grep -F -- "$1=" "$SB_STATE" 2>/dev/null | tail -n 1 | sed "s|^$1=||"
}

sb_has() { grep -F -x -q -- "$1=$2" "$SB_STATE"; }

# --- fixtures ----------------------------------------------------------------

sb_config() { # board|luci|garbage|nokey|missing
    case "$1" in
        missing) rm -f "$SB_CONFIG" ;;
        nokey)   printf '{"other":"x"}\n' > "$SB_CONFIG" ;;
        garbage) printf '{"entry_ui":"garbage"}\n' > "$SB_CONFIG" ;;
        *)       printf '{"entry_ui":"%s"}\n' "$1" > "$SB_CONFIG" ;;
    esac
}

sb_shadow() { # set|locked|empty
    case "$1" in
        set)    printf 'root:$1$aaaa$bbbbbbbbbbbbbbbbbbbbbb:19000:0:99999:7:::\n' > "$SB_SHADOW" ;;
        locked) printf 'root:!:19000:0:99999:7:::\n' > "$SB_SHADOW" ;;
        *)      printf 'root::19000:0:99999:7:::\n' > "$SB_SHADOW" ;;
    esac
}

sb_certs() { # provisioned|image|none
    case "$1" in
        provisioned)
            printf 'PROVISIONED-CERT\n' > "$SB_SSL_CRT"; printf 'PROVISIONED-KEY\n' > "$SB_SSL_KEY" ;;
        image)
            printf 'IMAGE-PLACEHOLDER\n' > "$SB_IMG_CRT"; printf 'IMAGE-PLACEHOLDER\n' > "$SB_IMG_KEY" ;;
        *) : ;;
    esac
}

sb_clear_certs() { rm -f "$SB_SSL_CRT" "$SB_SSL_KEY" "$SB_IMG_CRT" "$SB_IMG_KEY"; }

sb_nodogsplash() { # seed|none — a guest section with a legitimate pre-auth entry
    case "$1" in
        seed)
            printf 'nodogsplash.@nodogsplash[0]=nodogsplash\n' >> "$SB_STATE"
            printf 'nodogsplash.@nodogsplash[0].users_to_router=allow tcp port 2050\n' >> "$SB_STATE"
            printf 'nodogsplash.@nodogsplash[0].users_to_router=allow udp port 67\n' >> "$SB_STATE"
            ;;
    esac
}

sb_coverage() { printf '%s\n' "$1" > "$SB_COVERAGE"; }

# /proc/net/tcp fixture with a LISTEN (0A) socket on each named decimal port.
sb_proc() { # sb_proc [port ...]
    : > "$SB_PROC_TCP"
    : > "$SB_PROC_TCP6"
    printf '  sl  local_address rem_address   st\n' >> "$SB_PROC_TCP"
    for p in "$@"; do
        hex=$(printf '%04X\n' "$p")
        printf '   0: 00000000:%s 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 1 1 0000000000000000 100 0 0 10 0\n' \
            "$hex" >> "$SB_PROC_TCP"
    done
}

# --- run --------------------------------------------------------------------

sb_run() { # sb_run [cli-path] [marker-path]
    PATH="$SB_BIN:$PATH" \
        UCI_STATE="$SB_STATE" UCI_LOG="$SB_UCI_LOG" RESTART_LOG="$SB_RESTART_LOG" \
        TOLLGATE_SHADOW_FILE="$SB_SHADOW" \
        TOLLGATE_SSL_CERT="$SB_SSL_CRT" TOLLGATE_SSL_KEY="$SB_SSL_KEY" \
        UHTTPD_IMAGE_CERT="$SB_IMG_CRT" UHTTPD_IMAGE_KEY="$SB_IMG_KEY" \
        TOLLGATE_CLI="${1:-$SB_CLI}" \
        TOLLGATE_CONFIG_JSON="$SB_CONFIG" \
        TOLLGATE_ENTRY_UI_MARKER="${2:-$SB_MARKER}" \
        PROVISIONED_CERT="$SB_SSL_CRT" FAKE_COVERAGE="$SB_COVERAGE" \
        sh "$SB_SCRIPT" > "$SB_STDOUT" 2> "$SB_STDERR"
    SB_RC=$?
}

# --- assertions --------------------------------------------------------------

sb_listen_count() { # port -> number of distinct sections that list it
    awk -v p="$1" '
        { eq = index($0, "="); if (eq == 0) next
          k = substr($0, 1, eq - 1); v = substr($0, eq + 1)
          if (k ~ /\.listen_(http|https)$/ && v == p) {
              sub(/\.listen_(http|https)$/, "", k); secs[k] = 1 } }
        END { n = 0; for (s in secs) n++; print n }' "$SB_STATE"
}

sb_owner() { # port -> the single section that lists it; MULTI when several; "" when none
    awk -v p="$1" '
        { eq = index($0, "="); if (eq == 0) next
          k = substr($0, 1, eq - 1); v = substr($0, eq + 1)
          if (k ~ /\.listen_(http|https)$/ && v == p) {
              sub(/\.listen_(http|https)$/, "", k); sub(/^uhttpd\./, "", k); secs[k] = 1 } }
        END { n = 0; s = ""
              for (x in secs) { n++; s = x }
              if (n == 1) print s
              else if (n > 1) print "MULTI" }' "$SB_STATE"
}

sb_section_has() { # section port -> 0 when that section lists the port
    # awk string equality, not a regex: the v6 address carries [::], which is a
    # bracket expression to grep -E.
    awk -v s="uhttpd.$1" -v p="$2" -F= '
        $1 == s ".listen_http" || $1 == s ".listen_https" { if ($2 == p) f = 1 }
        END { exit !f }' "$SB_STATE"
}

sb_users_to_router() { # prints every admin-port entry in the pre-auth list
    awk -F= '/users_to_router/ { print $2 }' "$SB_STATE" |
        grep -E '(^| )port (8080|443|8090|8443)( |$)' || true
}

sb_marker() { # prints marker content, or nothing if absent
    [ -f "$SB_MARKER" ] || [ -f "${1:-$SB_MARKER}" ] || return 0
    cat "${1:-$SB_MARKER}" 2>/dev/null
}

sb_report() { # label ok
    if [ "$2" = 1 ]; then
        echo "PASS: $1"; SB_PASS=$((SB_PASS + 1))
    else
        echo "FAIL: $1"; SB_FAIL=$((SB_FAIL + 1))
    fi
}

sb_summary() {
    echo
    echo "-- $SB_PASS passed, $SB_FAIL failed --"
    if [ "$SB_FAIL" -ne 0 ]; then exit 1; fi
    exit 0
}
