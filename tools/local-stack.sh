#!/usr/bin/env bash
# Everything on one machine: the hub, the scores, their audio, and the panel.
#
# Written when the shared hub went away and one person had to carry the whole
# stack. It is idempotent -- run it as often as you like.
#
#   tools/local-stack.sh            start the hub and the panel
#   tools/local-stack.sh stop       stop both
#   tools/local-stack.sh seed       (re)load scores and audio into the hub
set -uo pipefail
cd "$(dirname "$0")/.."
REPO="$PWD"
HUB_PORT="${HUB_PORT:-8770}"
PANEL_PORT="${PANEL_PORT:-8766}"
HUB="http://127.0.0.1:$HUB_PORT"

say() { printf '  %s\n' "$*"; }

stop() {
  fuser -k "$HUB_PORT/tcp" 2>/dev/null
  fuser -k "$PANEL_PORT/tcp" 2>/dev/null
  sleep 1
  say "stopped hub :$HUB_PORT and panel :$PANEL_PORT"
}

wait_for() {  # url, seconds
  local i=0
  until curl -s -m 2 -o /dev/null "$1"; do
    i=$((i+1)); [ "$i" -gt "${2:-15}" ] && return 1; sleep 1
  done
}

start_hub() {
  fuser -k "$HUB_PORT/tcp" 2>/dev/null; sleep 1
  PORT="$HUB_PORT" nohup python3 serve.py >/tmp/limelight-hub.log 2>&1 &
  wait_for "$HUB/hub/" 20 || { say "hub did not start -- see /tmp/limelight-hub.log"; return 1; }
  say "hub      $HUB/hub/"
}

seed() {
  # Scores we hold locally. A .score becomes a new version rather than an
  # overwrite, so running this twice does not lose anything.
  for f in scores/*.score; do
    [ -e "$f" ] || continue
    n=$(basename "$f")
    code=$(curl -s -o /dev/null -w '%{http_code}' -X PUT --data-binary "@$f" "$HUB/hub/score/$n")
    say "score    $n -> $code"
  done
  # Audio, named after the SCORE so the two cannot drift apart. wav is converted
  # to mp3 only if ffmpeg is here; the hub is happy with either.
  for f in scores/*.score; do
    [ -e "$f" ] || continue
    stem=$(basename "$f" .score)
    src=""
    for cand in "audio/$stem.mp3" "audio/$stem.wav" "synth/incoming/$stem.mp3" "synth/out/$stem.wav"; do
      [ -f "$cand" ] && { src="$cand"; break; }
    done
    [ -z "$src" ] && { say "audio    $stem -- none on this machine"; continue; }
    ext="${src##*.}"
    if [ "$ext" = "wav" ] && command -v ffmpeg >/dev/null; then
      out="/tmp/limelight-$stem.mp3"
      [ -f "$out" ] || ffmpeg -nostdin -loglevel error -y -i "$src" -b:a 192k "$out"
      src="$out"; ext="mp3"
    fi
    code=$(curl -s -o /dev/null -w '%{http_code}' -X PUT --data-binary "@$src" \
           "$HUB/hub/score/$(basename "$f")?audio=$ext")
    say "audio    $stem.$ext -> $code"
  done
}

start_panel() {
  fuser -k "$PANEL_PORT/tcp" 2>/dev/null; sleep 1
  PY="$REPO/.venv-panel/bin/python"
  if [ ! -x "$PY" ]; then
    say "making .venv-panel (numpy + soundfile)"
    python3 -m venv .venv-panel >/dev/null 2>&1
    "$REPO/.venv-panel/bin/pip" install -q --disable-pip-version-check numpy soundfile
  fi
  # LIVE=1 drives the real rig. Off by default so two people on one network
  # cannot both claim universe 0 without meaning to.
  NET_FLAG="--no-net"
  [ "${LIVE:-0}" = "1" ] && NET_FLAG=""
  HUB_URL="$HUB" nohup "$PY" readers/lights/panel/server.py \
      $NET_FLAG --host 0.0.0.0 --port "$PANEL_PORT" --gain 0.6 "$REPO/synth/out" \
      >/tmp/limelight-panel.log 2>&1 &
  wait_for "http://127.0.0.1:$PANEL_PORT/" 20 || { say "panel did not start -- see /tmp/limelight-panel.log"; return 1; }
  say "panel    http://127.0.0.1:$PANEL_PORT/   ${NET_FLAG:+(--no-net: nothing is sent to the rig)}${NET_FLAG:-(LIVE: driving the rig)}"
}

case "${1:-start}" in
  stop)  stop ;;
  seed)  seed ;;
  check) python3 tools/response.test.py ;;
  start) start_hub && seed && start_panel
         echo
         say "logs: /tmp/limelight-hub.log  /tmp/limelight-panel.log"
         say "stop: tools/local-stack.sh stop"
         say "check: tools/local-stack.sh check   (folder and hub agree)" ;;
  *) echo "usage: $0 [start|stop|seed|check]"; exit 2 ;;
esac
