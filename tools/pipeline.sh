#!/usr/bin/env bash
# Build a map for one song, from audio to the file on the board, in the order
# the steps actually depend on each other.
#
#   bash tools/pipeline.sh levels                 # into synth/maps/amal/
#   LIMELIGHT_MAPS=synth/maps/renjith bash tools/pipeline.sh the-nights
#
# Steps that need a heavier environment are skipped with a note rather than
# failing the run, so a teammate with only stdlib still gets a usable map.
set -uo pipefail
cd "$(dirname "$0")/.."
SLUG="${1:?usage: bash tools/pipeline.sh <slug>}"
WORK="${LIMELIGHT_WORK:-$PWD/work}"
MAPS="${LIMELIGHT_MAPS:-synth/maps/amal}"
AUDIO="${LIMELIGHT_PY_AUDIO:-$WORK/audio/bin/python}"
BP="${LIMELIGHT_PY_BASICPITCH:-$WORK/basicpitch/bin/python}"
MAP="$MAPS/$SLUG.map.json"
STEMDIR="${LIMELIGHT_STEMS:-$WORK/stems/htdemucs_6s}"
export LIMELIGHT_MAPS LIMELIGHT_WORK

say()  { printf '\n== %s\n' "$1"; }
skip() { printf '   skipped: %s\n' "$1"; }
runif(){ if [ -x "$1" ]; then shift; "$@"; else skip "no $1 -- bash tools/setup.sh"; fi; }

mkdir -p "$MAPS"

say "1 grid, structure, energy  (stdlib)"
python3 listen/ear.py "synth/out/$SLUG.wav" > "$MAP"

say "2 stems -> accents, per-bar stem levels  (needs audio env)"
runif "$AUDIO" "$AUDIO" listen/separate.py "$SLUG" "$STEMDIR" "$MAP" "$MAP"

say "3 mood, novelty, lyrics  (needs audio env: MuQ + Whisper)"
runif "$AUDIO" "$AUDIO" listen/deep.py "$SLUG" "$STEMDIR/$SLUG" "$MAP" "$MAP"

say "4 bar phase from the recording"
python3 listen/barphase.py "$SLUG" --write

say "5 drops and stops moved to the measured step"
python3 listen/moments.py "$SLUG" --write

say "6 phrases, phrase grid, structure check  (stdlib)"
python3 listen/derive.py "$MAP"

say "7 sidechain pump"
runif "$AUDIO" "$AUDIO" listen/pump.py "$SLUG" --write

say "8 stereo width and pan  (from the release, not synth/out)"
python3 listen/stereo.py "$SLUG" --write

say "9 bass notes"
runif "$AUDIO" "$AUDIO" listen/stempitch.py "$SLUG" --write

say "10 chords  (ChordMini BTC large-voca)"
runif "$AUDIO" "$AUDIO" listen/chordmini.py "$SLUG" --write

say "11 melody: pyin, then basic-pitch where pyin declines"
runif "$AUDIO" "$AUDIO" listen/pyin_melody.py "$SLUG" --write
runif "$BP" "$BP" listen/notes.py "$SLUG" --write
python3 listen/melody.py "$SLUG" --write

say "12 accents moved to their own measured attack  (needs audio env)"
runif "$AUDIO" "$AUDIO" listen/attack.py "$SLUG" --write

say "13 learned vectors  (MERT)"
runif "$AUDIO" "$AUDIO" listen/vectors.py "$SLUG" --write

say "14 the two assumptions: how many beats in a bar, and does the tempo hold"
python3 listen/meter.py "$SLUG" --write

say "15 the forward-looking layer: what is coming, how expected it is, who is leading"
python3 listen/expect.py "$SLUG" --write

say "16 fields derivable from what is already in the file"
python3 synth/upgrade_map.py "$MAP" || true
rm -f "$MAP.bak"

say "17 validate, then score"
python3 validate.py "$MAP"
python3 listen/mapeval.py "$SLUG"
