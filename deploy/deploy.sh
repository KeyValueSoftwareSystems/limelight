#!/usr/bin/env bash
# ─── Deploy Limelight to a remote server ─────────────────────────────────────
# Builds locally, pushes the image, runs it on the server.
#
# Usage:
#   ./deploy.sh <PUBLIC_IP> [SSH_KEY_PATH]
#
# Examples:
#   ./deploy.sh 129.153.xx.xx                         # default key
#   ./deploy.sh 129.153.xx.xx ~/.ssh/oracle_key       # specific key
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

IP="${1:?Usage: ./deploy.sh <PUBLIC_IP> [SSH_KEY_PATH]}"
KEY="${2:-~/.ssh/id_rsa}"
USER="${DEPLOY_USER:-ubuntu}"
REMOTE="$USER@$IP"
SSH="ssh -i $KEY -o StrictHostKeyChecking=accept-new"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"

echo "═══════════════════════════════════════════════════════════"
echo "  Deploying Limelight to $IP"
echo "═══════════════════════════════════════════════════════════"
echo ""

# ── Option A: Build on the server (simpler, slower first time) ───────────────
echo "→ Syncing code to server..."
rsync -avz --delete \
    --exclude node_modules \
    --exclude .next \
    --exclude .git \
    --exclude __pycache__ \
    --exclude '*.pyc' \
    --exclude '.venv*' \
    --exclude 'logs/' \
    --exclude 'synth/' \
    --exclude 'models/' \
    --exclude 'assets/' \
    --exclude 'renders/' \
    --exclude 'work/' \
    --exclude 'tools/' \
    --exclude 'listen/' \
    --exclude 'portal/work/' \
    --exclude '*.wav' \
    --exclude '*.mp3' \
    --exclude '*.flac' \
    --exclude '*.pt' \
    --exclude '*.pth' \
    --exclude '*.safetensors' \
    -e "$SSH" \
    "$REPO_DIR/" "$REMOTE:~/limelight/"

echo ""
echo "→ Building and starting on server..."
$SSH "$REMOTE" << 'EOF'
cd ~/limelight/deploy
docker compose up -d --build
echo ""
echo "→ Waiting for services to start..."
sleep 10
docker compose ps
docker compose logs --tail=20
EOF

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  ✓ Deployed!"
echo ""
echo "  Open: http://$IP/"
echo ""
echo "  Useful commands (on the server):"
echo "    docker compose logs -f         # live logs"
echo "    docker compose restart          # restart"
echo "    docker compose down && docker compose up -d  # full restart"
echo "═══════════════════════════════════════════════════════════"
