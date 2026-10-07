#!/bin/sh
# Offline test: 92-tollgate-admin-setup is MODE-AWARE — it binds the entry pair
# (8080 + 443) or the secondary pair (8090 + 8443) to the section it owns
# (uhttpd.admin) from the same `entry_ui` value the module's 99-tollgate-setup
# reads, and it emits the D4 marker that gates the module half.
#
# The decision: docs/architecture/default-ui-and-entry-port-decision.md
#   D1  entry_ui in {board,luci}, default board; a missing file / key / empty /
#       unparseable value / absent jq all resolve to BOARD, and nothing may
#       resolve to "bind no admin listener at all" (invariant 6).
#   D2  the switch decides which UI owns the entry pair; the other owns the
#       secondary pair. The PORT SETS never change, only their meaning.
#   D3  one writer per section: this repo's 92 owns `uhttpd.admin` (the only
#       writer that knows the brand webroot); the module's 99 owns `uhttpd.main`.
#       Both compute the mapping from the same value; 92 therefore BINDS only
#       the pair it owns and STRIPS that pair from every other section so no port
#       is bound twice (invariant 3).
#   D4  a marker, /etc/tollgate/entry-ui-mapping (env-overridable through
#       TOLLGATE_ENTRY_UI_MARKER), announces the mapping protocol. Its existence
#       means "the mode-aware 92 is installed"; its content is the resolved
#       value. It is the atomicity boundary across the two packages: the module's
#       99 refuses to honour board without it and repairs to the legacy luci
#       mapping.
#
# Shape: whole-script sandbox (see lib-92-sandbox.sh) for the mapping and the
# marker, plus a cheap standalone run of the shipped `entry_ui_resolved` for the
# resolution table (D1). Nothing outside a private temp dir is read or written;
# no root, no network; the shipped script itself is never executed (only a
# rewritten copy is) and is parsed with `sh -n` first.
#
# Usage: sh packaging/tests/test-92-entry-ui-mapping.sh [path-to-script]
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

TMP=$(mktemp -d "${TMPDIR:-/tmp}/tg-92-entry-ui.XXXXXX") || exit 2
trap 'rm -rf "$TMP"' EXIT INT TERM

# shellcheck source=lib-92-sandbox.sh
. "$HERE/lib-92-sandbox.sh"
sb_init "$TMP" "$SCRIPT"

# --- host safety: every occurrence of an absolute path the script touches must
#     sit under the temp dir. The rewritten path keeps the original suffix, so a
#     bare `grep -F <path>` would match its own replacement; count instead.
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
if grep -q -F '@@' "$SB_SCRIPT"; then
    echo "FAIL: unsubstituted placeholder left in the sandboxed script" >&2
    exit 2
fi

# The four ports, as literal lists (D2). board: admin owns the ENTRY pair and
# the other section keeps the SECONDARY pair. luci: today's mapping.
ENTRY_HTTP='0.0.0.0:8080'; ENTRY_HTTP6='[::]:8080'
ENTRY_HTTPS='0.0.0.0:443'; ENTRY_HTTPS6='[::]:443'
SEC_HTTP='0.0.0.0:8090'; SEC_HTTP6='[::]:8090'
SEC_HTTPS='0.0.0.0:8443'; SEC_HTTPS6='[::]:8443'

echo "== 92-tollgate-admin-setup: entry_ui mapping + D4 marker =="
echo "script: $SCRIPT"
echo

# (a) entry_ui=board -> uhttpd.admin binds the ENTRY pair (8080 + 443) with the
#     brand webroot; the other section (uhttpd.main, the module's writer) keeps
#     the secondary pair (8090 + 8443); a STALE copy of the entry pair on the
#     other section is stripped, so after the flip exactly one section lists each
#     of the four ports (invariant 3); and the :443 owner carries the MODULE's
#     provisioned identity, not the image placeholder (D3).
sb_reset
sb_config board
sb_shadow set
sb_certs provisioned
sb_coverage not-covering
sb_proc
sb_set uhttpd.main.listen_http "$SEC_HTTP"; sb_add uhttpd.main.listen_http "$SEC_HTTP6"
sb_add uhttpd.main.listen_http "$ENTRY_HTTP"; sb_add uhttpd.main.listen_http "$ENTRY_HTTP6"
sb_set uhttpd.main.listen_https "$SEC_HTTPS"; sb_add uhttpd.main.listen_https "$SEC_HTTPS6"
sb_add uhttpd.main.listen_https "$ENTRY_HTTPS"
sb_set uhttpd.main.home '/www'
sb_run
ok=0
if [ "$SB_RC" = 0 ] &&
   sb_section_has admin "$ENTRY_HTTP" && sb_section_has admin "$ENTRY_HTTP6" &&
   sb_section_has admin "$ENTRY_HTTPS" && sb_section_has admin "$ENTRY_HTTPS6" &&
   ! sb_section_has admin "$SEC_HTTP" && ! sb_section_has admin "$SEC_HTTPS" &&
   sb_section_has main "$SEC_HTTP" && sb_section_has main "$SEC_HTTP6" &&
   sb_section_has main "$SEC_HTTPS" && sb_section_has main "$SEC_HTTPS6" &&
   ! sb_section_has main "$ENTRY_HTTP" && ! sb_section_has main "$ENTRY_HTTPS" &&
   [ "$(sb_get uhttpd.admin.home)" = "$SB_ADMIN_HOME" ] &&
   [ "$(sb_get uhttpd.admin.error_page)" = "/index.html" ]; then
    ok=1
fi
sb_report "(a) entry_ui=board -> admin binds 8080+443 (brand webroot); main keeps 8090+8443; stale entry pair stripped" "$ok"
[ "$ok" = 1 ] || { sed -n '1,40p' "$SB_STATE" >&2; cat "$SB_STDERR" >&2; }

# (b) invariant 3 with the OWNER pinned, not just the count: exactly one section
#     lists each of 8080 / 443 / 8090 / 8443, and in board mode that owner is the
#     board's section for the entry pair and the module's for the secondary pair
#     (a count alone would also be satisfied by the wrong mapping).
ok=1
[ "$(sb_owner "$ENTRY_HTTP")" = admin ] || ok=0
[ "$(sb_owner "$ENTRY_HTTPS")" = admin ] || ok=0
[ "$(sb_owner "$SEC_HTTP")" = main ] || ok=0
[ "$(sb_owner "$SEC_HTTPS")" = main ] || ok=0
sb_report "(b) board mode: admin owns 8080/443, main owns 8090/8443, one section per port" "$ok"
[ "$ok" = 1 ] || sed -n '1,40p' "$SB_STATE" >&2

# (c) identity follows the listener (D3) + the D4 marker carries the RESOLVED
#     value ("board") on a completed run.
ok=0
if [ "$(sb_get uhttpd.admin.cert)" = "$SB_SSL_CRT" ] &&
   [ "$(sb_get uhttpd.admin.key)" = "$SB_SSL_KEY" ]; then
    ok=1
fi
sb_report "(c) board mode: the :443 owner carries the provisioned identity (never /etc/uhttpd.crt)" "$ok"
[ "$ok" = 1 ] || sed -n '1,40p' "$SB_STATE" >&2

ok=0
if [ -f "$SB_MARKER" ] && [ "$(cat "$SB_MARKER")" = "board" ]; then ok=1; fi
sb_report "(d) completed board run -> marker exists, content 'board'" "$ok"
[ "$ok" = 1 ] || { echo "marker: $([ -f "$SB_MARKER" ] && cat "$SB_MARKER" || echo absent)" >&2; cat "$SB_STDERR" >&2; }

# (e) entry_ui=luci, with the marker path OVERRIDDEN (so the offline test never
#     touches /etc): admin binds the secondary pair (today's mapping), the other
#     section keeps the entry pair, exactly one owner per port, and the marker
#     lands at the override path with the resolved value "luci".
alt="$TMP/alt-marker"
sb_reset
sb_config luci
sb_shadow set
sb_certs provisioned
sb_coverage not-covering
sb_proc
sb_set uhttpd.main.listen_http "$ENTRY_HTTP"; sb_add uhttpd.main.listen_http "$ENTRY_HTTP6"
sb_set uhttpd.main.listen_https "$ENTRY_HTTPS"; sb_add uhttpd.main.listen_https "$ENTRY_HTTPS6"
rm -f "$SB_MARKER" "$alt"
sb_run "$SB_CLI" "$alt"
ok=0
if [ "$SB_RC" = 0 ] &&
   sb_section_has admin "$SEC_HTTP" && sb_section_has admin "$SEC_HTTPS" &&
   ! sb_section_has admin "$ENTRY_HTTP" && ! sb_section_has admin "$ENTRY_HTTPS" &&
   sb_section_has main "$ENTRY_HTTP" && sb_section_has main "$ENTRY_HTTPS" &&
   [ "$(sb_listen_count "$ENTRY_HTTP")" = 1 ] &&
   [ "$(sb_listen_count "$ENTRY_HTTPS")" = 1 ] &&
   [ "$(sb_listen_count "$SEC_HTTP")" = 1 ] &&
   [ "$(sb_listen_count "$SEC_HTTPS")" = 1 ]; then
    ok=1
fi
sb_report "(e) entry_ui=luci -> today's mapping (admin 8090+8443, main 8080+443), one owner per port" "$ok"
[ "$ok" = 1 ] || { sed -n '1,40p' "$SB_STATE" >&2; cat "$SB_STDERR" >&2; }

ok=0
if [ -f "$alt" ] && [ "$(cat "$alt")" = "luci" ] && [ ! -f "$SB_MARKER" ]; then ok=1; fi
sb_report "(f) luci run -> marker content 'luci' at the TOLLGATE_ENTRY_UI_MARKER override (default path untouched)" "$ok"

# (g) the marker is the atomicity boundary: a REFUSED run (no usable root
#     credential -> fail-closed) leaves NO marker, so the module's 99 must not
#     honour board — and the admin listeners are gone too.
sb_reset
sb_config board
sb_shadow empty
sb_certs provisioned
sb_coverage not-covering
sb_proc
rm -f "$SB_MARKER"
sb_run
ok=0
if [ ! -f "$SB_MARKER" ] &&
   [ -z "$(sb_get uhttpd.admin.listen_http)" ] &&
   [ -z "$(sb_get uhttpd.admin.listen_https)" ]; then
    ok=1
fi
sb_report "(g) refused run -> marker ABSENT and no admin listener (fail-closed)" "$ok"
[ "$ok" = 1 ] || { echo "marker: $([ -f "$SB_MARKER" ] && cat "$SB_MARKER" || echo absent)" >&2; sed -n '1,40p' "$SB_STATE" >&2; }

# (h) D1 resolution table, run against the SHIPPED resolver rather than a copy:
#     a missing file / a missing key / garbage / an empty value / an absent jq
#     all resolve to the SAME mapping as board, and luci resolves to luci
#     (invariant 6 — none of them may mean "no admin listener").
RESOLVER="$TMP/entry_ui_resolved.sh"
sed -n '/^entry_ui_resolved() {$/,/^}$/p' "$SCRIPT" > "$RESOLVER"
if [ ! -s "$RESOLVER" ]; then
    echo "FAIL: could not extract entry_ui_resolved() from the shipped script (sentinel drift?)" >&2
    exit 2
fi
resolver_says() { # config-file-content-spec -> prints the resolved value
    spec=$1
    rm -f "$SB_BIN/jq"
    case "$spec" in
        jq-absent) : ;;
        *)         sb_stubs ;;   # restores the jq stub
    esac
    case "$spec" in
        missing) rm -f "$SB_CONFIG" ;;
        nokey)   printf '{"other":"x"}\n' > "$SB_CONFIG" ;;
        garbage) printf '{"entry_ui":"garbage"}\n' > "$SB_CONFIG" ;;
        empty)   printf '{"entry_ui":""}\n' > "$SB_CONFIG" ;;
        jq-absent) printf '{"entry_ui":"board"}\n' > "$SB_CONFIG" ;;
        *)       printf '{"entry_ui":"%s"}\n' "$spec" > "$SB_CONFIG" ;;
    esac
    PATH="$SB_BIN:$PATH" TOLLGATE_CONFIG_JSON="$SB_CONFIG" \
        sh -c '. "$1"; entry_ui_resolved' _ "$RESOLVER"
}
ok=1
for spec in missing nokey garbage empty jq-absent board; do
    v=$(resolver_says "$spec")
    [ "$v" = "board" ] || { ok=0; echo "  '$spec' resolved to '$v', expected board" >&2; }
done
[ "$(resolver_says luci)" = "luci" ] || { ok=0; echo "  'luci' did not resolve to luci" >&2; }
sb_report "(h) D1: missing/keyless/garbage/empty/absent-jq -> board; luci -> luci (invariant 6)" "$ok"

# (i) static: 92 reads the SAME shared value the module's 99 reads (the flat
#     entry_ui field of /etc/tollgate/config.json, through jq), so neither half
#     decides the mapping on its own (D3), and both pairs are present as literals
#     so a revert to a single fixed pair is caught here (D2).
ok=0
if grep -q -F 'entry_ui' "$SCRIPT" &&
   grep -q -F 'config.json' "$SCRIPT" &&
   grep -q -F 'jq' "$SCRIPT" &&
   grep -q -F 'TOLLGATE_ENTRY_UI_MARKER' "$SCRIPT" &&
   grep -q -F 'entry-ui-mapping' "$SCRIPT"; then
    ok=1
fi
sb_report "(i) static: 92 reads entry_ui from config.json via jq and documents the D4 marker" "$ok"

ok=0
if grep -q -F '8080' "$SCRIPT" && grep -q -F '8443' "$SCRIPT" &&
   grep -q -F '8090' "$SCRIPT" && grep -q -F '443' "$SCRIPT"; then
    ok=1
fi
sb_report "(j) static: the script names both port pairs (8080/443 and 8090/8443)" "$ok"

sb_summary
