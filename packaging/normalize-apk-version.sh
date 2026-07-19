#!/bin/sh
# Normalize a version string for apk (OpenWrt 25.12+).
# APK requires versions matching: [epoch:]version[-release]
# Hyphens in the main version are invalid — replace with dots.
set -eu
VERSION="${1:-0.0.0}"
# Strip leading 'v'
VERSION="${VERSION#v}"
# Replace hyphens with dots (APK doesn't allow hyphens in version)
VERSION=$(echo "$VERSION" | tr '-' '.')
echo "$VERSION"
