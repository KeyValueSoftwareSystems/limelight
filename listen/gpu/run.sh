#!/usr/bin/env bash
# One song or a whole folder, end to end, including the second opinion.
set -euo pipefail
cd "$(dirname "$0")"
TARGET="${1:-wav/}"

export PATH="$PWD/venv/bin:$PATH"          # sglang needs ninja from here
export SGLANG_DISABLE_CUDNN_CHECK=1

echo "== scoring $TARGET =="
./venv/bin/python -u pipeline.py "$TARGET"

echo "== songformer second opinion =="
./sfvenv/bin/python sfrun.py

echo "== merging =="
./venv/bin/python merge_songformer.py score-out songformer-out

echo "== finishing =="
./venv/bin/python finish.py score-out/*.score

echo "done -> score-out/"
