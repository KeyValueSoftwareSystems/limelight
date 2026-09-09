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

# --- grid refine (rigid kick-locked clock) ---
GRID_FMAX = 150.0                                   # Hz; the kick band the grid locks to
GRID_PHASE_STEP = 0.004                             # s; phase search resolution
GRID_PERIOD_TOL = (-0.003, -0.0015, 0.0, 0.0015, 0.003)  # fractional period window around the tempo

# --- bar-line phase (kick band) ---
BAR_PHASE_FMAX = 150.0      # Hz; the kick lives below this
BAR_PHASE_MARGIN = 0.15     # ratio-units the kick phase must beat allin1's phase by to override

# --- moment derivation (allin1 label vocabulary, grouped by what a show does) ---
DROP_LABELS = {"chorus", "drop", "hook", "refrain", "inst", "instrumental", "solo"}
QUIET_LABELS = {"break", "breakdown", "bridge", "intro", "outro", "quiet", "start", "end", "ambient"}

# --- moment re-timing (drops/stops -> the loudness step) ---
MOMENT_SEARCH_BEATS = 8            # two bars either side of the candidate
MOMENT_SHOULDERS_S = (0.5, 1.0, 1.5, 2.0)
MOMENT_HALF_BAR_OVERRIDE = 1.20    # an off-metre beat must beat the best on-metre step by this
MOMENT_STEP_HOP_S = 0.005          # RMS envelope hop

# --- models ---
MERT_MODEL = "m-a-p/MERT-v1-95M"
DEMUCS_MODEL = "htdemucs"
ESSENTIA_EMBEDDING = "discogs-effnet-bs64-1.pb"

_REPO_MODELS = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", "models", "essentia"))

# where `--versioned` builds land: <repo-root>/maps/generator-pipeline (three levels up
# from this file: musicstate/ -> src/ -> musicstate-generator/ -> repo root)
_GENERATOR_MAPS = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "maps", "generator-pipeline"))


def pipeline_maps_dir() -> str:
    """Root for versioned generator-pipeline maps. Overridable for tests / relocation."""
    return os.environ.get("LIMELIGHT_GENERATOR_MAPS", _GENERATOR_MAPS)


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
