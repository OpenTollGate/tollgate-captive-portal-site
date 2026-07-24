#!/bin/sh
# Normalize a version string for apk (OpenWrt 25.12+).
# APK requires purely numeric versions: digits and dots only.
# Any non-numeric characters are stripped, collapsed to dots.
set -eu
VERSION="${1:-0.0.0}"
# Strip leading 'v'
VERSION="${VERSION#v}"
# Replace any non-alphanumeric with dots
VERSION=$(echo "$VERSION" | tr -c '[0-9]' '.')
# Collapse multiple dots
VERSION=$(echo "$VERSION" | sed 's/\.\.*/./g')
# Strip leading/trailing dots
VERSION="${VERSION#.}"
VERSION="${VERSION%.}"
# Ensure we have something
if [ -z "$VERSION" ]; then
    VERSION="0.0.0"
fi
echo "$VERSION"
