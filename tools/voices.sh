#!/usr/bin/env bash
set -u
cd "$(dirname "$0")/.."
for w in work/wav/*.wav; do
  slug=$(basename "$w" .wav)
  if [ -f "work/heard/$slug.voice.npy" ] && [ -f "work/heard/$slug.pitch.npy" ]; then
    continue
  fi
  ./work/allin1/bin/python -c "
import sys; sys.path.insert(0,'listen')
from voice import clean
e, f = clean('$w', '$slug')
print('$slug', 'env-ok' if e is not None else 'ENV-FAILED', 'pitch-ok' if f is not None else 'PITCH-FAILED', flush=True)
" 2>&1 | grep -viE "warning|deprecat|info -"
done
echo "extraction finished"
