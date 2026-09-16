#!/usr/bin/env bash
# ─── ship.sh — Build, push, and deploy Limelight in one command ──────────────
#
# Usage:
#   ./ship.sh                    # uses defaults
#   ./ship.sh --data             # also sync hub/files data
#   ./ship.sh --restart-only     # just restart the container (no rebuild)
#
# Config (edit these or set as env vars):
#   ORACLE_IP, SSH_KEY, SSH_USER
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── Config ───────────────────────────────────────────────────────────────────
ORACLE_IP="${ORACLE_IP:-140.245.245.11}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/oracle-limelight.key}"
SSH_USER="${SSH_USER:-ubuntu}"
REMOTE="$SSH_USER@$ORACLE_IP"
SSH="ssh -i $SSH_KEY -o StrictHostKeyChecking=accept-new"
SCP="scp -i $SSH_KEY -o StrictHostKeyChecking=accept-new"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"

SYNC_DATA=false
RESTART_ONLY=false

for arg in "$@"; do
    case "$arg" in
        --data)         SYNC_DATA=true ;;
        --restart-only) RESTART_ONLY=true ;;
        --help|-h)
            echo "Usage: ./ship.sh [--data] [--restart-only]"
            echo "  --data          Also sync hub/files/ data to the server"
            echo "  --restart-only  Just restart the container (no rebuild)"
            exit 0 ;;
    esac
done

RED='\033[0;31m'
GRN='\033[0;32m'
CYN='\033[0;36m'
DIM='\033[2m'
RST='\033[0m'

echo ""
echo -e "${CYN}═══════════════════════════════════════════════════════════${RST}"
echo -e "${CYN}  Limelight — Ship to $ORACLE_IP${RST}"
echo -e "${CYN}═══════════════════════════════════════════════════════════${RST}"
echo ""

# ── Restart only ─────────────────────────────────────────────────────────────
if $RESTART_ONLY; then
    echo -e "${CYN}→ Restarting container...${RST}"
    $SSH "$REMOTE" "sudo docker restart limelight && sleep 5 && sudo docker ps"
    echo ""
    echo -e "${GRN}✓ Restarted!${RST}  http://$ORACLE_IP/"
    exit 0
fi

# ── 1. Build Docker image locally ────────────────────────────────────────────
echo -e "${CYN}→ Building Docker image locally...${RST}"
cd "$REPO_DIR"
docker build -f deploy/Dockerfile -t limelight:latest .
echo -e "${GRN}  ✓ Image built${RST}"

# ── 2. Save and compress ────────────────────────────────────────────────────
echo ""
echo -e "${CYN}→ Saving image to tarball...${RST}"
docker save limelight:latest | gzip > /tmp/limelight-image.tar.gz
SIZE=$(du -h /tmp/limelight-image.tar.gz | cut -f1)
echo -e "${GRN}  ✓ Image saved${RST} ($SIZE)"

# ── 3. Upload image to server ───────────────────────────────────────────────
echo ""
echo -e "${CYN}→ Uploading image to server ($SIZE)...${RST}"
$SCP /tmp/limelight-image.tar.gz "$REMOTE":~/limelight-image.tar.gz
echo -e "${GRN}  ✓ Upload complete${RST}"

# ── 4. Sync hub data (optional) ─────────────────────────────────────────────
if $SYNC_DATA; then
    HUB_FILES="$REPO_DIR/hub/files"
    if [ -d "$HUB_FILES" ]; then
        DATA_SIZE=$(du -sh "$HUB_FILES" | cut -f1)
        echo ""
        echo -e "${CYN}→ Syncing hub data ($DATA_SIZE)...${RST}"
        rsync -avz --progress \
            -e "$SSH" \
            "$HUB_FILES/" "$REMOTE":~/hub-data/ 2>&1 | tail -5
        echo -e "${GRN}  ✓ Data synced${RST}"
    else
        echo -e "${RED}  ⚠ hub/files/ not found — skipping data sync${RST}"
    fi
fi

# ── 5. Deploy on server ─────────────────────────────────────────────────────
echo ""
echo -e "${CYN}→ Deploying on server...${RST}"
$SSH "$REMOTE" << 'DEPLOY_EOF'
set -e

echo "  Loading image..."
sudo docker load < ~/limelight-image.tar.gz

echo "  Stopping old container..."
sudo docker stop limelight 2>/dev/null || true
sudo docker rm limelight 2>/dev/null || true

echo "  Starting new container..."
sudo docker run -d \
    --name limelight \
    --restart unless-stopped \
    -p 80:80 \
    -v limelight-hub:/app/hub/files \
    -v limelight-shows:/app/portal/shows \
    -v limelight-work:/app/portal/work \
    -v limelight-market:/app/portal/market \
    -v limelight-showfiles:/app/portal/showfiles \
    limelight:latest

# If hub-data exists (from --data flag), copy it in
if [ -d ~/hub-data ]; then
    echo "  Copying hub data into container..."
    sudo docker cp ~/hub-data/. limelight:/app/hub/files/
    rm -rf ~/hub-data
fi

echo "  Waiting for services..."
sleep 15

# Verify
echo ""
sudo docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
echo ""
SONGS=$(curl -sf http://localhost/api/songs 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('songs',[]).__len__())" 2>/dev/null || echo "?")
echo "  Songs loaded: $SONGS"

# Clean up old images
sudo docker image prune -f 2>/dev/null || true
DEPLOY_EOF

# ── 6. Clean up local tarball ────────────────────────────────────────────────
rm -f /tmp/limelight-image.tar.gz

echo ""
echo -e "${GRN}═══════════════════════════════════════════════════════════${RST}"
echo -e "${GRN}  ✓ Deployed!${RST}"
echo ""
echo -e "  ${GRN}URL:${RST}  http://$ORACLE_IP/"
echo ""
echo -e "  ${DIM}Useful:${RST}"
echo -e "    ${DIM}./ship.sh                 rebuild & deploy${RST}"
echo -e "    ${DIM}./ship.sh --data           rebuild & deploy + sync hub data${RST}"
echo -e "    ${DIM}./ship.sh --restart-only   just restart the container${RST}"
echo -e "${GRN}═══════════════════════════════════════════════════════════${RST}"
