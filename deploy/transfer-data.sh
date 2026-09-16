#!/usr/bin/env bash
# ─── Transfer hub/files data to the Oracle instance ──────────────────────────
# Sends your local hub/files/ (scores, audio) to the running container's volume.
#
# Usage:
#   ./transfer-data.sh <PUBLIC_IP> [SSH_KEY_PATH]
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

IP="${1:?Usage: ./transfer-data.sh <PUBLIC_IP> [SSH_KEY_PATH]}"
KEY="${2:-~/.ssh/id_rsa}"
USER="${DEPLOY_USER:-ubuntu}"
REMOTE="$USER@$IP"
SSH="ssh -i $KEY -o StrictHostKeyChecking=accept-new"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
HUB_FILES="$REPO_DIR/hub/files"

if [ ! -d "$HUB_FILES" ]; then
    echo "ERROR: $HUB_FILES does not exist."
    echo "  This script transfers your local hub/files/ directory to the server."
    exit 1
fi

echo "═══════════════════════════════════════════════════════════"
echo "  Transferring hub data to $IP"
echo "═══════════════════════════════════════════════════════════"

# Calculate size
SIZE=$(du -sh "$HUB_FILES" | cut -f1)
echo "→ Uploading $SIZE from hub/files/..."

# Upload to a staging directory on the server
rsync -avz --progress \
    -e "$SSH" \
    "$HUB_FILES/" "$REMOTE:~/hub-data/"

echo ""
echo "→ Copying into Docker volume..."
$SSH "$REMOTE" << 'REMOTE_EOF'
# Copy from staging into the running container's volume
docker cp ~/hub-data/. limelight:/app/hub/files/

# Restart the hub so it picks up the new files
docker exec limelight supervisorctl restart hub
docker exec limelight supervisorctl restart portal

echo "→ Cleaning up staging directory..."
rm -rf ~/hub-data/

echo ""
echo "✓ Data transferred and services restarted"
REMOTE_EOF

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  ✓ Done! Hub data is now on the server."
echo "═══════════════════════════════════════════════════════════"
