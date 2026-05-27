#!/bin/sh
# Build an OpenWrt-compatible .ipk from a payload tree and metadata.
# Uses standard ar + tar — no OpenWrt SDK required.
set -eu

PAYLOAD_DIR=${1:?payload dir required}
OUTPUT=${2:?output ipk path required}

: "${PKG_NAME:?PKG_NAME required}"
: "${PKG_VERSION:?PKG_VERSION required}"
: "${ARCH:?ARCH required}"

[ -d "$PAYLOAD_DIR" ] || { echo "error: payload dir missing: $PAYLOAD_DIR" >&2; exit 1; }

mkdir -p "$(dirname "$OUTPUT")"
OUTPUT="$(cd "$(dirname "$OUTPUT")" && pwd)/$(basename "$OUTPUT")"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if command -v gtar >/dev/null 2>&1; then
    TAR=gtar
else
    TAR=tar
fi

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

mkdir "$WORK/CONTROL"

{
    printf 'Package: %s\n' "$PKG_NAME"
    printf 'Version: %s\n' "$PKG_VERSION"
    printf 'Architecture: %s\n' "$ARCH"
    [ -n "${MAINTAINER:-}" ]  && printf 'Maintainer: %s\n'  "$MAINTAINER"
    [ -n "${LICENSE:-}" ]     && printf 'License: %s\n'     "$LICENSE"
    [ -n "${DEPENDS:-}" ]     && printf 'Depends: %s\n'     "$DEPENDS"
    [ -n "${PROVIDES:-}" ]    && printf 'Provides: %s\n'    "$PROVIDES"
    [ -n "${REPLACES:-}" ]    && printf 'Replaces: %s\n'    "$REPLACES"
    [ -n "${DESCRIPTION:-}" ] && printf 'Description: %s\n' "$DESCRIPTION"
} > "$WORK/CONTROL/control"

for s in preinst postinst prerm postrm; do
    if [ -f "$SCRIPT_DIR/$s" ]; then
        cp "$SCRIPT_DIR/$s" "$WORK/CONTROL/$s"
        chmod 0755 "$WORK/CONTROL/$s"
    fi
done

( cd "$WORK/CONTROL" && \
  "$TAR" --sort=name --mtime='@0' --owner=0 --group=0 --numeric-owner \
    -czf "$WORK/control.tar.gz" . )

( cd "$PAYLOAD_DIR" && \
  "$TAR" --sort=name --mtime='@0' --owner=0 --group=0 --numeric-owner \
    -czf "$WORK/data.tar.gz" . )

printf '2.0\n' > "$WORK/debian-binary"

rm -f "$OUTPUT"
( cd "$WORK" && \
  "$TAR" --owner=0 --group=0 --numeric-owner \
    -czf "$OUTPUT" ./debian-binary ./data.tar.gz ./control.tar.gz )

size=$(wc -c < "$OUTPUT" | tr -d ' ')
printf 'Built %s (%s bytes)\n' "$OUTPUT" "$size"
