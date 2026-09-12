#!/bin/bash
cd "$(dirname "$0")/.."
export OMP_NUM_THREADS=3 MKL_NUM_THREADS=3 OPENBLAS_NUM_THREADS=3
ls -1 work/wav/*.wav | xargs -P 3 -I{} ./work/allin1/bin/python listen/lead.py {} \
  >> work/leads.log 2>&1
