#!/usr/bin/env bash
# Start all Limelight services in one terminal.
#   ./start.sh          start hub + portal + ui
#   ./start.sh --stop   kill any running instances
#
# Services:
#   hub      python3 serve.py              :8770  (protocol + shared files)
#   portal   python3 portal/server.py      :8800  (creator/venue API)
#   ui       npm run dev (limelight-ui)    :3000  (Next.js frontend)

set -euo pipefail
cd "$(dirname "$0")"

RED='\033[0;31m'
GRN='\033[0;32m'
YLW='\033[0;33m'
CYN='\033[0;36m'
DIM='\033[2m'
RST='\033[0m'

PIDFILE=".start.pids"

stop_all() {
  if [[ -f "$PIDFILE" ]]; then
    while IFS='=' read -r name pid; do
      if kill -0 "$pid" 2>/dev/null; then
        kill "$pid" 2>/dev/null && echo -e "${YLW}stopped${RST} $name (pid $pid)" || true
      fi
    done < "$PIDFILE"
    rm -f "$PIDFILE"
  fi
  # also kill by port in case pidfile is stale
  for port in 8770 8800; do
    pid=$(lsof -ti :"$port" 2>/dev/null || true)
    if [[ -n "$pid" ]]; then
      kill "$pid" 2>/dev/null && echo -e "${YLW}stopped${RST} process on :$port (pid $pid)" || true
    fi
  done
}

if [[ "${1:-}" == "--stop" ]]; then
  stop_all
  echo -e "${GRN}all services stopped${RST}"
  exit 0
fi

# clean up previous run
stop_all
sleep 1

mkdir -p logs

# ── hub (:8770) ──────────────────────────────────────────────────────────────
echo -e "${CYN}starting hub${RST} on :8770 …"
python3 serve.py > logs/hub.log 2>&1 &
HUB_PID=$!
echo "hub=$HUB_PID" >> "$PIDFILE"

# ── portal (:8800) ──────────────────────────────────────────────────────────
echo -e "${CYN}starting portal${RST} on :8800 …"
python3 portal/server.py --no-net > logs/portal.log 2>&1 &
PORTAL_PID=$!
echo "portal=$PORTAL_PID" >> "$PIDFILE"

# wait for backends before starting the UI
for i in $(seq 1 20); do
  hub_ok=false; portal_ok=false
  curl -sf http://127.0.0.1:8770/hub/?json >/dev/null 2>&1 && hub_ok=true
  curl -sf http://127.0.0.1:8800/api/songs  >/dev/null 2>&1 && portal_ok=true
  if $hub_ok && $portal_ok; then break; fi
  sleep 0.5
done

if ! $hub_ok; then
  echo -e "${RED}hub failed to start${RST} — check logs/hub.log"
  cat logs/hub.log | tail -20
  stop_all
  exit 1
fi
if ! $portal_ok; then
  echo -e "${RED}portal failed to start${RST} — check logs/portal.log"
  cat logs/portal.log | tail -20
  stop_all
  exit 1
fi

echo -e "${GRN}hub${RST}      http://localhost:8770    ${DIM}pid $HUB_PID${RST}"
echo -e "${GRN}portal${RST}   http://localhost:8800    ${DIM}pid $PORTAL_PID${RST}"

# ── ui (:3000) ──────────────────────────────────────────────────────────────
echo -e "${CYN}starting ui${RST} on :3000 …"
cd limelight-ui
npm run dev > ../logs/ui.log 2>&1 &
UI_PID=$!
cd ..
echo "ui=$UI_PID" >> "$PIDFILE"

# wait for Next.js to compile
for i in $(seq 1 30); do
  curl -sf http://127.0.0.1:3000 >/dev/null 2>&1 && break
  sleep 1
done

echo -e "${GRN}ui${RST}       http://localhost:3000    ${DIM}pid $UI_PID${RST}"
echo ""
echo -e "${GRN}all services running${RST}  —  ${DIM}logs in logs/  |  ./start.sh --stop to shut down${RST}"
echo ""

# keep the script alive so Ctrl+C stops everything
cleanup() {
  echo ""
  echo -e "${YLW}shutting down…${RST}"
  stop_all
  exit 0
}
trap cleanup INT TERM

# tail all logs interleaved
tail -f logs/hub.log logs/portal.log logs/ui.log 2>/dev/null &
TAIL_PID=$!
echo "tail=$TAIL_PID" >> "$PIDFILE"
wait $TAIL_PID 2>/dev/null || true
