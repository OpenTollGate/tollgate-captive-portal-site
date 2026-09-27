#!/bin/bash
set -euo pipefail

ARCH="${1:-aarch64_cortex-a53}"
VERSION="${2:-$(jq -r .version package.json)}"
PACKAGE_NAME="tollgate-captive-portal"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD_DIR="$REPO_ROOT/build"
WORK_DIR=$(mktemp -d)
trap 'rm -rf "$WORK_DIR"' EXIT

echo "=== Building $PACKAGE_NAME ipk ==="
echo "  Architecture: $ARCH"
echo "  Version:      $VERSION"
echo "  Source:       $BUILD_DIR"

if [ ! -f "$BUILD_DIR/splash.html" ]; then
    echo "ERROR: Build output not found. Run 'npm run build' first."
    exit 1
fi

CTRL_DIR="$WORK_DIR/control"
DATA_DIR="$WORK_DIR/data"

mkdir -p "$CTRL_DIR" "$DATA_DIR"

# Install portal files to nodogsplash htdocs
mkdir -p "$DATA_DIR/etc/nodogsplash/htdocs"
cp -r "$BUILD_DIR/." "$DATA_DIR/etc/nodogsplash/htdocs/"

cat > "$CTRL_DIR/control" << EOF
Package: tollgate-captive-portal
Version: ${VERSION}
Architecture: ${ARCH}
Maintainer: TollGate <dev@tollgate.me>
License: GPL-3.0
Depends: tollgate-wrt, nodogsplash
Provides: tollgate-captive-portal-site
Conflicts: tollgate-captive-portal
Description: TollGate captive portal SPA
 A branded captive portal skin for TollGate WiFi payment.
 Provides the tollgate-captive-portal-site virtual package,
 deploying the captive portal SPA to nodogsplash htdocs.
 Pays with Cashu tokens or BTC Lightning via the TollGate backend.
EOF

cp "$SCRIPT_DIR/postinst" "$CTRL_DIR/postinst"
cp "$SCRIPT_DIR/prerm" "$CTRL_DIR/prerm"
chmod 755 "$CTRL_DIR/postinst" "$CTRL_DIR/prerm"

cd "$WORK_DIR"
tar -czf control.tar.gz -C "$CTRL_DIR" .
tar -czf data.tar.gz -C "$DATA_DIR" .

echo "2.0" > debian-binary

OUTPUT="$REPO_ROOT/${PACKAGE_NAME}_${VERSION}_${ARCH}.ipk"
# OpenWrt opkg expects gzip-compressed tarball, not ar archive
tar -czf "$OUTPUT" ./debian-binary ./control.tar.gz ./data.tar.gz

SIZE=$(du -h "$OUTPUT" | cut -f1)
echo "=== Built: $OUTPUT ($SIZE) ==="
