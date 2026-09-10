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

# Stereo. Four of the five real songs are a mono 32 kHz downmix in synth/out,
# which cannot carry pan at all, so `pan` needs its own source: stereo stems
# from the release file, and a low-rate stereo mix for the scorer's own side of
# the check. Both are gitignored like every other piece of audio here.
stereo() {
  have audio || { echo "run 'bash tools/setup.sh audio' first"; return 1; }
  mkdir -p "$WORK/stems-stereo"
  shopt -s nullglob
  for f in *.mp3 synth/incoming/*.mp3; do
    slug=""
    case "$f" in
      *Levels*)     slug=levels;;
      *Starlight*)  slug=starlight;;
      *"Don't Look Down"*) slug=dont-look-down;;
      *Mizhiyoram*) slug=mizhiyoram;;
      *Nights*)     slug=the-nights;;
      *) continue;;
    esac
    # the scorer's side: a small stereo wav it can read with the stdlib
    out="synth/out/$slug.stereo.wav"
    [ -f "$out" ] || ffmpeg -v error -y -i "$f" -ac 2 -ar 16000 "$out"
    # the writer's side: stereo stems
    if [ ! -d "$WORK/stems-stereo/htdemucs_6s/$slug" ]; then
      cp "$f" "$WORK/$slug.src.mp3"
      "$WORK/audio/bin/python" -m demucs -n htdemucs_6s --mp3 \
          -o "$WORK/stems-stereo" "$WORK/$slug.src.mp3"
      mv "$WORK/stems-stereo/htdemucs_6s/$slug.src" \
         "$WORK/stems-stereo/htdemucs_6s/$slug" 2>/dev/null || true
      rm -f "$WORK/$slug.src.mp3"
    fi
    echo "  stereo: $slug"
  done
  shopt -u nullglob
}

# A fourth environment, for one field on one song. MOSS-Music reads a vocal
# whisper-small cannot: on mizhiyoram it returned zero segments from the stem
# and invented Korean and Chinese glyphs from the mix. It is separate because
# it pins transformers 4.57.1 while the audio env pins 4.44.2, and CPU-only
# because 18.1 GB of bf16 will not fit a 4 GB card.
#
# It is used for LYRICS ONLY. The same model also does chord, key and tempo
# reasoning and structural analysis, and taking any of those would put one
# model on both sides of a check in listen/mapeval.py.
moss() {
  have moss && { echo "moss env exists"; return; }
  python3 -m venv "$WORK/moss"
  "$WORK/moss/bin/pip" -q install --upgrade pip
  "$WORK/moss/bin/pip" -q install --index-url https://download.pytorch.org/whl/cpu torch torchaudio
  "$WORK/moss/bin/pip" -q install "transformers==4.57.1" accelerate safetensors \
      soundfile librosa tiktoken einops scipy tqdm
  [ -d "$WORK/MOSS-Music/.git" ] || git clone -q --depth 1 \
      https://github.com/OpenMOSS/MOSS-Music "$WORK/MOSS-Music"
  echo "moss env: $WORK/moss"
  echo "  weights (18.1 GB) are NOT downloaded automatically:"
  echo "    \"$WORK/moss/bin/python\" -c \"from huggingface_hub import snapshot_download as d; \\"
  echo "      d('OpenMOSS-Team/MOSS-Music-8B-Instruct', local_dir='$WORK/moss-weights')\""
  echo "  the transcript it produced is committed at"
  echo "    listen/transcripts/mizhiyoram.moss-music-8b-instruct.txt"
  echo "  so the map is reproducible without a 35-minute CPU run."
}

# The corpus `percentile` is measured against: real recordings, never the
# generator in synth/. FMA-small is 8000 Creative Commons tracks as 30-second
# excerpts; 500 of them, converted to the same 32 kHz mono WAV that synth/out
# holds, is enough for the stability gate to pass with a 3-6 point swing.
corpus() {
  local zip="$WORK/fma_small.zip" dst="$WORK/corpus"
  if [ -d "$dst" ] && [ "$(ls -1 "$dst"/*.wav 2>/dev/null | wc -l)" -ge 200 ]; then
    echo "corpus exists: $(ls -1 "$dst"/*.wav | wc -l) tracks"; return
  fi
  mkdir -p "$dst"
  [ -f "$zip" ] || curl -sSL -C - -o "$zip" https://os.unil.cloud.switch.ch/fma/fma_small.zip
  python3 tools/mkcorpus.py "$zip" "$dst"
  echo "  then: python3 listen/percentile.py --corpus $dst --write"
}

vision() {
  # The video lane. Small on purpose: opencv + numpy and one 230 kB detector.
  say "vision: opencv (shot boundaries, optical flow, faces)"
  python3 -m venv "$WORK/vision"
  "$WORK/vision/bin/pip" -q install --upgrade pip
  "$WORK/vision/bin/pip" -q install opencv-python-headless numpy
  mkdir -p "$WORK/vision/models"
  # YuNet. OpenCV 5 dropped the Haar cascades this was first written against;
  # YuNet is the replacement and is a better detector, but it is a different
  # one, so face counts from the two are not comparable.
  if [ ! -s "$WORK/vision/models/yunet.onnx" ]; then
    curl -sL -o "$WORK/vision/models/yunet.onnx" \
      "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx"
  fi
  "$WORK/vision/bin/python" -c "import cv2,numpy;print('  cv2',cv2.__version__)"
}

clips() {
  say "clips: 90 CC-licensed stock clips + the generated answer-sheet set"
  python3 assets/fetch.py --n 90 --quality 720
  "$WORK/vision/bin/python" assets/make-clips.py
  "$WORK/vision/bin/python" assets/index.py --stock --generated
}

heldout() {
  say "heldout: full-length CC recordings nobody here has tuned against"
  python3 tools/mkheldout.py --n 12
  python3 tools/heldout_maps.py
}

case "${1:-all}" in
  audio) audio;; basicpitch) basicpitch;; mir) mir;; chordmini) chordmini;; stems) stems;;
  stereo) stereo;; moss) moss;; corpus) corpus;;
  vision) vision;; clips) clips;; heldout) heldout;;
  video) vision; clips;;
  all) audio; basicpitch || true; mir || true; chordmini; stems; stereo || true;
       vision || true; clips || true;;
  *) echo "usage: bash tools/setup.sh [audio|basicpitch|mir|chordmini|stems|stereo|moss|corpus|vision|clips|heldout|video|all]"; exit 2;;
esac
