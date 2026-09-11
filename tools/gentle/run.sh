#!/usr/bin/env bash
# Run a heavy job without taking the machine with it.
#
#   bash tools/gentle/run.sh work/vision/bin/python assets/index.py ...
#
# Three limits, because one is never enough:
#   nice 19 + ionice idle  -- anything the person is doing always wins
#   *_NUM_THREADS=2        -- numpy/BLAS stay off the other ten cores
#   sitecustomize          -- OpenCV has its OWN pool and ignores the above
#
# Also caps address space, so a runaway decode is killed instead of taking the
# desktop down with it.
set -uo pipefail
cd "$(dirname "$0")/../.."
N="${LIMELIGHT_THREADS:-2}"
ulimit -v $((6 * 1024 * 1024)) 2>/dev/null || true
export LIMELIGHT_THREADS="$N"
export PYTHONPATH="$PWD/tools/gentle${PYTHONPATH:+:$PYTHONPATH}"
export OMP_NUM_THREADS="$N" OPENBLAS_NUM_THREADS="$N" MKL_NUM_THREADS="$N"
export NUMEXPR_NUM_THREADS="$N" VECLIB_MAXIMUM_THREADS="$N"
export TOKENIZERS_PARALLELISM=false
exec nice -n 19 ionice -c 3 "$@"
