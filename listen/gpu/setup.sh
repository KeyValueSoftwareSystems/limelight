#!/usr/bin/env bash
# Rebuild both environments on a fresh GPU box. Run from this directory.
#
# Two venvs, not one: SongFormer pins numpy<2 and the pipeline's ml-dtypes
# wants numpy>=2. They cannot share an environment, and finding that out cost
# a run.
set -euo pipefail
cd "$(dirname "$0")"
HERE="$PWD"

echo "== pipeline venv =="
python3 -m venv venv
./venv/bin/pip -q install --upgrade pip wheel
./venv/bin/pip -q install "torch==2.9.1" "torchaudio==2.9.1" --index-url https://download.pytorch.org/whl/cu124
./venv/bin/pip -q install -r requirements-gpu.lock.txt
./venv/bin/python -c "import numpy,scipy.sparse,librosa,madmom,torch; \
  print('  pipeline ok: numpy',numpy.__version__,'cuda',torch.cuda.is_available())"

echo "== songformer venv =="
python3 -m venv sfvenv
./sfvenv/bin/pip -q install --upgrade pip wheel
./sfvenv/bin/pip -q install "torch==2.6.0+cu124" "torchaudio==2.6.0+cu124" --index-url https://download.pytorch.org/whl/cu124
./sfvenv/bin/pip -q install -r requirements-songformer.lock.txt
# msaf reaches for scipy.inf, removed in scipy 1.12. Only evaluation code
# touches it and inference never calls that path.
SP="$(./sfvenv/bin/python -c 'import sysconfig;print(sysconfig.get_paths()["purelib"])')"
grep -rl "from scipy import inf" "$SP/msaf/" 2>/dev/null | while read -r f; do
  sed -i 's/from scipy import inf/from numpy import inf/' "$f"
done || true
./sfvenv/bin/python -c "import muq,x_transformers,msaf,numpy; \
  print('  songformer ok: numpy',numpy.__version__)"

echo "== weights =="
echo "  moss/             MOSS-Music-8B-Instruct   (OpenMOSS-Team/MOSS-Music-8B-Instruct)"
echo "  songformer-model/ SongFormer               (ASLP-lab/SongFormer)"
echo "  mega53/           53-stem BS-RoFormer      (model.ckpt + config.yaml)"
echo
echo "Then: put wavs in wav/ and run  ./run.sh"
