#!/usr/bin/env bash
# Everything the enrichment tools need, from a fresh clone.
#
# Three separate Python environments, because they genuinely conflict:
#   audio      torch + librosa + demucs + transformers   (the workhorse)
#   basicpitch python 3.11 only -- basic-pitch pins numpy 1.23, which will not
#              build on 3.12, and it drags in its own tensorflow
#   mir        beat_this, whose torch pin fights the audio env
#
# Nothing here goes in git. It all lands in work/ (gitignored) and is rebuildable.
# Usage:  bash tools/setup.sh [audio|basicpitch|mir|chordmini|stems|all]
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
WORK="${LIMELIGHT_WORK:-$ROOT/work}"
mkdir -p "$WORK"

have() { [ -x "$WORK/$1/bin/python" ]; }

audio() {
  have audio && { echo "audio env exists"; return; }
  python3 -m venv "$WORK/audio"
  "$WORK/audio/bin/pip" -q install --upgrade pip
  # torch first and alone: let pip resolve the CUDA build for this machine
  "$WORK/audio/bin/pip" -q install torch torchaudio
  "$WORK/audio/bin/pip" -q install librosa soundfile demucs \
      "transformers==4.44.2" nnAudio mir_eval matplotlib seaborn
  echo "audio env: $WORK/audio"
}

basicpitch() {
  have basicpitch && { echo "basicpitch env exists"; return; }
  PY311="$(command -v python3.11 || true)"
  [ -n "$PY311" ] || { echo "need python3.11 for basic-pitch (numpy 1.23 will not build on 3.12)"; return 1; }
  "$PY311" -m venv "$WORK/basicpitch"
  "$WORK/basicpitch/bin/pip" -q install --upgrade pip
  "$WORK/basicpitch/bin/pip" -q install "basic-pitch[onnx]"
  echo "basicpitch env: $WORK/basicpitch"
}

mir() {
  have mir && { echo "mir env exists"; return; }
  python3 -m venv "$WORK/mir"
  "$WORK/mir/bin/pip" -q install --upgrade pip
  "$WORK/mir/bin/pip" -q install beat_this
  echo "mir env: $WORK/mir  (downbeat cross-check only; madmom is NOT installed, so no DBN)"
}

chordmini() {
  [ -d "$WORK/chordmini/.git" ] && { echo "chordmini exists"; return; }
  git clone -q --depth 1 https://github.com/ptnghia-j/ChordMini "$WORK/chordmini"
  echo "chordmini: $WORK/chordmini"
  echo "  the BTC large-vocabulary checkpoint must sit at"
  echo "  $WORK/chordmini/checkpoints/btc_model_large_voca.pt"
  echo "  (see that repo's README; it is not redistributed here)"
}

stems() {
  have audio || { echo "run 'bash tools/setup.sh audio' first"; return 1; }
  mkdir -p "$WORK/stems"
  for wav in synth/out/*.wav; do
    slug="$(basename "$wav" .wav)"
    case "$slug" in 0*|1[0-9]-*) continue;; esac      # skip the synthetic ladder
    [ -d "$WORK/stems/htdemucs_6s/$slug" ] && { echo "  stems exist: $slug"; continue; }
    echo "  separating $slug (a few minutes)"
    "$WORK/audio/bin/python" -m demucs -n htdemucs_6s --mp3 -o "$WORK/stems" "$wav"
  done
  echo "stems: $WORK/stems/htdemucs_6s"
}

case "${1:-all}" in
  audio) audio;; basicpitch) basicpitch;; mir) mir;; chordmini) chordmini;; stems) stems;;
  all) audio; basicpitch || true; mir || true; chordmini; stems;;
  *) echo "usage: bash tools/setup.sh [audio|basicpitch|mir|chordmini|stems|all]"; exit 2;;
esac
