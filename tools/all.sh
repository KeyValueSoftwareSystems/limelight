#!/bin/bash
cd "$(dirname "$0")/.."
export OMP_NUM_THREADS=4 MKL_NUM_THREADS=4 OPENBLAS_NUM_THREADS=4
ls -1 work/wav/*.wav | xargs -P 3 -I{} ./work/allin1/bin/python listen/score.py {} >> work/all.log 2>&1
