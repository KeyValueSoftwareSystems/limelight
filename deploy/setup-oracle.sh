#!/usr/bin/env bash
# ─── Oracle Free Tier Setup Script ───────────────────────────────────────────
# Run this ON the Oracle instance after SSH-ing in.
#
# Usage:
#   ssh -i <key> ubuntu@<PUBLIC_IP>
#   curl -sSL <this-script> | bash
#   — or —
#   scp this file to the instance and run: bash setup-oracle.sh
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

echo "═══════════════════════════════════════════════════════════"
echo "  Limelight — Oracle Free Tier Setup"
echo "═══════════════════════════════════════════════════════════"
echo ""

# ── 1. System updates ────────────────────────────────────────────────────────
echo "→ Updating system packages..."
sudo apt-get update -qq
sudo apt-get upgrade -y -qq

# ── 2. Install Docker ────────────────────────────────────────────────────────
if ! command -v docker &>/dev/null; then
    echo "→ Installing Docker..."
    curl -fsSL https://get.docker.com | sudo sh
    sudo usermod -aG docker "$USER"
    echo "  ✓ Docker installed. You may need to log out and back in for group changes."
else
    echo "  ✓ Docker already installed"
fi

# ── 3. Install Docker Compose plugin ────────────────────────────────────────
if ! docker compose version &>/dev/null; then
    echo "→ Installing Docker Compose plugin..."
    sudo apt-get install -y docker-compose-plugin
else
    echo "  ✓ Docker Compose already available"
fi

# ── 4. Open firewall for HTTP (port 80) ─────────────────────────────────────
echo "→ Configuring iptables for port 80..."
# Oracle Linux images have iptables rules that block traffic by default
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT 2>/dev/null || true
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT 2>/dev/null || true

# Persist iptables rules
if command -v netfilter-persistent &>/dev/null; then
    sudo netfilter-persistent save 2>/dev/null || true
elif [ -f /etc/iptables/rules.v4 ]; then
    sudo iptables-save | sudo tee /etc/iptables/rules.v4 >/dev/null
fi

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  ✓ System ready!"
echo ""
echo "  IMPORTANT: You also need to open port 80 in the Oracle"
echo "  Cloud Console under:"
echo ""
echo "    Networking → Virtual Cloud Networks → <your VCN>"
echo "    → Security Lists → Default Security List"
echo "    → Add Ingress Rule:"
echo "        Source CIDR:  0.0.0.0/0"
echo "        Destination Port: 80"
echo ""
echo "  Next steps:"
echo "    1. Clone/upload your repo to this machine"
echo "    2. cd limelight/deploy"
echo "    3. docker compose up -d --build"
echo "    4. Open http://<YOUR_PUBLIC_IP>/ in your browser"
echo "═══════════════════════════════════════════════════════════"
