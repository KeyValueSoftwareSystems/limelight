#!/usr/bin/env bash
# Put the portal on a shared screen, safely.
#
#   bash synth/share.sh
#
# Two things happen here and both matter. The server binds to every interface so
# a tunnel can reach it, and it starts READ-ONLY -- the buttons that generate
# songs, score listeners or rebuild frames are refused. An endpoint that runs a
# job is a remote shell however friendly the button looks, and this URL is about
# to be public. Everything else works: every page, every song, both rooms, the
# universe view, the board.
#
# Generate and score on your own machine, on the normal local instance.
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${PORT:-8770}"

if ! command -v ngrok >/dev/null; then
  echo "ngrok is not installed. https://ngrok.com/download"; exit 1
fi
if [ ! -f "$HOME/.config/ngrok/ngrok.yml" ]; then
  echo "ngrok needs a token once:  ngrok config add-authtoken <your token>"; exit 1
fi

pkill -f "[s]ynth/serve.py" 2>/dev/null || true
sleep 1
LIMELIGHT_READONLY=1 HOST=0.0.0.0 PORT="$PORT" python3 synth/serve.py &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
sleep 2

echo "starting tunnel ..."
ngrok http "$PORT" --log stdout --log-format logfmt > /tmp/limelight-ngrok.log 2>&1 &
NG=$!
trap 'kill $SERVER $NG 2>/dev/null || true' EXIT
sleep 4

URL="$(grep -oE 'url=https://[^ ]+' /tmp/limelight-ngrok.log | tail -1 | cut -d= -f2- || true)"
if [ -z "$URL" ]; then
  echo "tunnel did not come up. Last lines:"; tail -5 /tmp/limelight-ngrok.log; exit 1
fi

cat <<EOF

  ------------------------------------------------------------------
  Share this:   $URL/game
  Big screen:   $URL/rooms
  ------------------------------------------------------------------
  Read-only. Anyone with the link can watch everything and change
  nothing. Ctrl-C here takes it down.

EOF
wait $SERVER
