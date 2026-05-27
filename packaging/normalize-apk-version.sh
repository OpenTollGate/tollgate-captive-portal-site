#!/bin/sh
# Normalize a version string for apk (OpenWrt 25.12+).
# Strips leading 'v', replaces hyphens with tildes.
set -eu
VERSION="${1:-0.0.0}"
VERSION="${VERSION#v}"
echo "$VERSION"
