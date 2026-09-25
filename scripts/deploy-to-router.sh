#!/usr/bin/env bash
set -euo pipefail

ROUTER_IP="${1:-192.168.1.1}"
SSH_USER="${SSH_USER:-root}"
SSH_KEY="${SSH_KEY:-}"
BUILD_DIR="$(cd "$(dirname "$0")/.." && pwd)/build"
REMOTE_WEB_ROOT="/www"
REMOTE_BACKUP="/tmp/tollgate-backup"
CONFIGURE_NDS="${CONFIGURE_NDS:-true}"

ssh_opts=( -o ConnectTimeout=5 -o StrictHostKeyChecking=no )
if [ -n "$SSH_KEY" ]; then
  ssh_opts+=( -i "$SSH_KEY" )
fi

ssh_cmd=( ssh "${ssh_opts[@]}" "${SSH_USER}@${ROUTER_IP}" )
scp_cmd=( scp -O "${ssh_opts[@]}" )

echo "=== TollGate captive portal — router deployment ==="
echo "Router: ${SSH_USER}@${ROUTER_IP}"
echo "Build:  ${BUILD_DIR}"

if [ ! -d "$BUILD_DIR" ] || [ -z "$(ls -A "$BUILD_DIR" 2>/dev/null)" ]; then
  echo "Error: Build directory is empty or missing. Run 'npm run build' first."
  exit 1
fi

echo ""
echo "[1/7] Checking SSH connectivity..."
if ! "${ssh_cmd[@]}" "echo ok" >/dev/null 2>&1; then
  echo "Error: Cannot reach router at ${ROUTER_IP}. Check connection."
  exit 1
fi
echo "  Connected."

echo ""
echo "[2/7] Checking router disk space..."
disk_info=$("${ssh_cmd[@]}" "df -h ${REMOTE_WEB_ROOT} | tail -1")
echo "  ${disk_info}"
avail_kb=$(echo "$disk_info" | awk '{print $4}' | sed 's/K//')
build_size=$(du -sk "$BUILD_DIR" | awk '{print $1}')
if [ "$build_size" -gt "$avail_kb" ]; then
  echo "Error: Build is ${build_size}KB but only ${avail_kb}KB available on router."
  exit 1
fi
echo "  Build size: ${build_size}KB — fits."

echo ""
echo "[3/7] Backing up existing portal to ${REMOTE_BACKUP}..."
"${ssh_cmd[@]}" "rm -rf ${REMOTE_BACKUP} && mkdir -p ${REMOTE_BACKUP}"
"${ssh_cmd[@]}" "cp -r ${REMOTE_WEB_ROOT}/* ${REMOTE_BACKUP}/ 2>/dev/null || true"
echo "  Backed up."

echo ""
echo "[4/7] Deploying captive portal to ${REMOTE_WEB_ROOT}..."
for file in "$BUILD_DIR"/*; do
  filename=$(basename "$file")
  if [ -d "$file" ]; then
    echo "  ${filename}/"
    "${ssh_cmd[@]}" "mkdir -p ${REMOTE_WEB_ROOT}/${filename}"
    "${scp_cmd[@]}" -r "$file"/* "${SSH_USER}@${ROUTER_IP}:${REMOTE_WEB_ROOT}/${filename}/"
  else
    echo "  ${filename}"
    "${scp_cmd[@]}" "$file" "${SSH_USER}@${ROUTER_IP}:${REMOTE_WEB_ROOT}/${filename}"
  fi
done

echo ""
echo "[5/7] Verifying deployment..."
file_count=$("${ssh_cmd[@]}" "find ${REMOTE_WEB_ROOT} -type f | wc -l")
echo "  ${file_count} files in ${REMOTE_WEB_ROOT}"

if "${ssh_cmd[@]}" "test -f ${REMOTE_WEB_ROOT}/splash.html"; then
  echo "  splash.html — OK"
else
  echo "  splash.html — MISSING (nodogsplash expects this file)"
fi

if "${ssh_cmd[@]}" "test -f ${REMOTE_WEB_ROOT}/index.html"; then
  echo "  index.html — OK (fallback for direct access)"
fi

echo ""
echo "[6/7] Configuring nodogsplash..."
if "${ssh_cmd[@]}" "which nodogsplash" >/dev/null 2>&1; then
  echo "  nodogsplash found — configuring..."

  "${ssh_cmd[@]}" "uci set nodogsplash.@nodogsplash[0].enabled='1' 2>/dev/null || true"
  "${ssh_cmd[@]}" "uci set nodogsplash.@nodogsplash[0].clientid='mac' 2>/dev/null || true"
  "${ssh_cmd[@]}" "uci set nodogsplash.@nodogsplash[0].preauthid='disable' 2>/dev/null || true"
  "${ssh_cmd[@]}" "uci set nodogsplash.@nodogsplash[0].gatewayport='2050' 2>/dev/null || true"
  "${ssh_cmd[@]}" "uci set nodogsplash.@nodogsplash[0].gatewayname='TollGate' 2>/dev/null || true"
  "${ssh_cmd[@]}" "uci set nodogsplash.@nodogsplash[0].maxclients='20' 2>/dev/null || true"
  "${ssh_cmd[@]}" "uci set nodogsplash.@nodogsplash[0].authidleness='480' 2>/dev/null || true"
  "${ssh_cmd[@]}" "uci set nodogsplash.@nodogsplash[0].checkinterval='60' 2>/dev/null || true"

  "${ssh_cmd[@]}" "uci commit nodogsplash 2>/dev/null || true"
  "${ssh_cmd[@]}" "/etc/init.d/nodogsplash enable 2>/dev/null || true"
  "${ssh_cmd[@]}" "/etc/init.d/nodogsplash restart 2>/dev/null || true"
  echo "  nodogsplash configured and restarted."
else
  echo "  nodogsplash not found — skipping NDS config."
  echo "  Install it: ssh ${SSH_USER}@${ROUTER_IP} 'opkg update && opkg install nodogsplash'"
fi

echo ""
echo "[7/7] Checking TollGate backend..."
if "${ssh_cmd[@]}" "pgrep -f tollgate" >/dev/null 2>&1; then
  echo "  TollGate process running."
elif "${ssh_cmd[@]}" "which tollgate-wrt" >/dev/null 2>&1; then
  echo "  TollGate binary found but not running."
  echo "  Start it: ssh ${SSH_USER}@${ROUTER_IP} '/etc/init.d/tollgate start'"
else
  echo "  TollGate backend not found."
  echo "  Deploy it from: https://github.com/OpenTollGate/tollgate-module-basic-go"
fi

echo ""
echo "=== Deployment complete ==="
echo ""
echo "Portal:     http://${ROUTER_IP}/splash.html"
echo "Rollback:   ssh ${SSH_USER}@${ROUTER_IP} 'cp -r ${REMOTE_BACKUP}/* ${REMOTE_WEB_ROOT}/'"
echo ""
echo "When a client connects to WiFi and browses, nodogsplash will"
echo "redirect them to /splash.html which loads the captive portal."
