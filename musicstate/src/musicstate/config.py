"""Central configuration: signal constants, model ids, and environment resolution.

The heavy backends (Essentia, allin1) live in sibling conda envs and are reached
by subprocess. All the path/env logic that used to be duplicated across analyzers
lives here, so there is exactly one place that knows how to find them.
"""
from __future__ import annotations

import os

# --- signal / framing ---
SAMPLE_RATE = 22050
HOP_LENGTH = 512
N_FFT = 2048

# --- models ---
MERT_MODEL = "m-a-p/MERT-v1-95M"
CLAP_MODEL = "laion/clap-htsat-unfused"
DEMUCS_MODEL = "htdemucs"
ESSENTIA_EMBEDDING = "discogs-effnet-bs64-1.pb"

_REPO_MODELS = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", "models", "essentia"))


def _sibling_env_python(env_name: str, override_var: str) -> str:
    """Path to a sibling conda env's python (…/envs/<env_name>/bin/python)."""
    override = os.environ.get(override_var)
    if override:
        return override
    conda_prefix = os.environ.get("CONDA_PREFIX")
    if conda_prefix:
        candidate = os.path.join(os.path.dirname(conda_prefix), env_name, "bin", "python")
        if os.path.exists(candidate):
            return candidate
    return "python"


def essentia_python() -> str:
    return _sibling_env_python("limelight-ess", "LIMELIGHT_ESS_PY")


def allin1_python() -> str:
    return _sibling_env_python("limelight-allin1", "LIMELIGHT_ALLIN1_PY")


def essentia_models_dir() -> str:
    return os.environ.get("LIMELIGHT_ESS_MODELS", _REPO_MODELS)
