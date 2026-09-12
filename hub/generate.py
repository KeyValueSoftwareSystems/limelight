"""Background MP3 → .score generation for the hub.

One worker drains a queue. The hub page polls snapshot() for progress.
Build is injectable (LIMELIGHT_SCORE_BUILDER=stub) so tests need no madmom.

Real builds run in a subprocess with the listen venv (LIMELIGHT_SCORE_PYTHON
or <repo>/.venv/bin/python) so serve.py can stay on system Python.
"""
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import uuid

from . import versions as V

ACTIVE = ("queued", "generating", "storing")
_CAP = 20
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FFMPEG_BIN = os.path.join(REPO, "tools", "bin")

_lock = threading.Lock()
_jobs = []          # oldest first; public snapshot reverses
_worker = None


def _now():
    return time.time()


def _public(job):
    return {
        "id": job["id"],
        "name": job["name"],
        "mp3": job["mp3"],
        "score_name": job["score_name"],
        "dir": job["dir"],
        "status": job["status"],
        "error": job["error"],
        "version": job["version"],
        "created": job["created"],
        "updated": job["updated"],
    }


def _score_python():
    env = os.environ.get("LIMELIGHT_SCORE_PYTHON")
    if env:
        return env
    venv_py = os.path.join(REPO, ".venv", "bin", "python")
    if os.path.isfile(venv_py) and os.access(venv_py, os.X_OK):
        return venv_py
    return sys.executable


_SCORE_SCRIPT = r"""
import json, sys
sys.path.insert(0, sys.argv[1])
from score import read
path, stem, out = sys.argv[2], sys.argv[3], sys.argv[4]
# Demucs (and friends) print progress on stdout; keep the score off that stream.
with open(out, "w", encoding="utf-8") as f:
    json.dump(read(path, stem), f)
"""


def build_score(mp3_path, stem):
    """Turn an MP3 into a score object. Override via LIMELIGHT_SCORE_BUILDER=stub."""
    delay = os.environ.get("LIMELIGHT_SCORE_BUILDER_DELAY_MS")
    if delay:
        time.sleep(int(delay) / 1000.0)
    if os.environ.get("LIMELIGHT_SCORE_BUILDER") == "stub":
        return {"score": stem, "version": 0, "grid": {"bpm": 120}, "source": os.path.basename(mp3_path)}

    listen_dir = os.path.join(REPO, "listen")
    py = _score_python()
    env = os.environ.copy()
    # Prefer the repo's static ffmpeg when present (no root apt needed).
    if os.path.isdir(FFMPEG_BIN):
        env["PATH"] = FFMPEG_BIN + os.pathsep + env.get("PATH", "")
    fd, out_path = tempfile.mkstemp(prefix="limelight-score-", suffix=".json")
    os.close(fd)
    try:
        proc = subprocess.run(
            [py, "-c", _SCORE_SCRIPT, listen_dir, mp3_path, stem, out_path],
            cwd=REPO,
            env=env,
            capture_output=True,
            text=True,
        )
        if proc.returncode != 0:
            err = (proc.stderr or proc.stdout or "").strip() or f"score builder exited {proc.returncode}"
            # Keep the message short enough for the hub UI strip.
            raise RuntimeError(err[-2000:])
        try:
            with open(out_path, encoding="utf-8") as f:
                return json.load(f)
        except (OSError, json.JSONDecodeError) as e:
            noise = ((proc.stdout or "") + "\n" + (proc.stderr or "")).strip()
            raise RuntimeError(f"score builder returned non-JSON: {e}\n{noise[:500]}") from e
    finally:
        try:
            os.remove(out_path)
        except OSError:
            pass


def _set(job, **fields):
    job.update(fields)
    job["updated"] = _now()


def _run_one(job):
    mp3_path = job["mp3_path"]
    score_path = job["score_path"]
    stem = job["stem"]
    try:
        with _lock:
            _set(job, status="generating")
        obj = build_score(mp3_path, stem)
        with _lock:
            _set(job, status="storing")
        body = (json.dumps(obj, indent=2) + "\n").encode("utf-8")
        n = V.store(score_path, body)
        with _lock:
            _set(job, status="done", version=n, error=None)
    except Exception as e:
        with _lock:
            _set(job, status="error", error=str(e))


def _loop():
    global _worker
    while True:
        with _lock:
            nxt = next((j for j in _jobs if j["status"] == "queued"), None)
            if nxt is None:
                _worker = None
                return
        _run_one(nxt)


def _ensure_worker():
    global _worker
    if _worker is not None and _worker.is_alive():
        return
    _worker = threading.Thread(target=_loop, name="hub-generate", daemon=True)
    _worker.start()


def enqueue(score_dir_path, mp3_path):
    """Queue generation for an existing .mp3. Returns the public job dict.

    The mp3 lives under hub audio/; the .score is written under score_dir_path
    (normally hub/files/score/). Raises ValueError for bad input (caller maps
    to 400) or Conflict for a score already queued/generating/storing (409).
    """
    score_dir_path = os.path.abspath(score_dir_path)
    mp3_path = os.path.abspath(mp3_path)
    name = os.path.basename(mp3_path)
    if not name.lower().endswith(".mp3"):
        raise ValueError("only .mp3 files can be generated from")
    if not os.path.isfile(mp3_path):
        raise ValueError(f"no {name}")
    stem = name[:-4]
    if not stem:
        raise ValueError("mp3 name is empty")
    score_name = stem + ".score"
    score_path = os.path.join(score_dir_path, score_name)

    with _lock:
        for j in _jobs:
            if j["score_name"] == score_name and j["dir"] == score_dir_path and j["status"] in ACTIVE:
                raise Conflict(f"{score_name} is already {j['status']}")
        job = {
            "id": uuid.uuid4().hex[:12],
            "name": name,
            "mp3": name,
            "mp3_path": mp3_path,
            "score_name": score_name,
            "score_path": score_path,
            "stem": stem,
            "dir": score_dir_path,
            "status": "queued",
            "error": None,
            "version": None,
            "created": _now(),
            "updated": _now(),
        }
        _jobs.append(job)
        # keep a bounded history of finished jobs
        while len(_jobs) > _CAP:
            drop = next((i for i, j in enumerate(_jobs) if j["status"] not in ACTIVE), None)
            if drop is None:
                break
            _jobs.pop(drop)
        out = _public(job)
        _ensure_worker()
        return out


def snapshot(dir_path=None):
    """Jobs for a hub folder (or all), newest first."""
    with _lock:
        rows = list(_jobs)
    if dir_path is not None:
        dir_path = os.path.abspath(dir_path)
        rows = [j for j in rows if j["dir"] == dir_path]
    rows.sort(key=lambda j: j["created"], reverse=True)
    return {"jobs": [_public(j) for j in rows[:_CAP]]}


class Conflict(Exception):
    """Same score already in flight."""
