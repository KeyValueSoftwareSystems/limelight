"""synccheck in the suite: bake a show, check it against audio, fail on slide.

A synced show is not something to eyeball once and hope. This bakes a score,
plays it against a click track built on the same grid, and asserts the bars line
up -- then drifts the clicks on purpose and asserts synccheck catches it. So the
check has teeth: it passes a good pairing and fails a sliding one.

Needs numpy + soundfile + node (bake.js). Run with the music_sync venv python.
"""
import json
import os
import subprocess
import sys
import tempfile

import numpy as np
import soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from synccheck import onset_env, analyse   # noqa: E402

SR = 44100
BPM = 120.0
FIRST = 0.5
BPB = 4
BARS = 12
BAR_S = BPB * 60.0 / BPM          # 2.0 s per bar
BEAT_S = 60.0 / BPM               # 0.5 s per beat

SCORE = {
    "score": "click",
    "grid": {"bpm": BPM, "first_beat_s": FIRST, "beats_per_bar": BPB,
             "bars": BARS, "first_bar": 0, "last_bar": BARS - 1},
    "sections": [
        {"from": {"bar": 0, "beat": 1}, "to": {"bar": 6, "beat": 1}, "name": "intro"},
        {"from": {"bar": 6, "beat": 1}, "to": {"bar": 12, "beat": 1}, "name": "drop"},
    ],
    "energy": {"per": "bar", "from_bar": 0,
               "values": [0.05, 0.05, 0.06, 0.05, 0.07, 0.06] + [0.9] * 6},
}


def click_track(path, rate=1.0):
    """A percussive kick on every downbeat (a bar line), quieter ticks on the
    other beats -- so a bar line carries more onset than the beats between two of
    them, which is what synccheck's on/off ratio measures. `rate` > 1 makes the
    clicks drift ahead of the grid over time -- a sound running slightly fast, the
    exact fault a counting clock cannot survive and synccheck must catch."""
    dur = FIRST + BARS * BAR_S + 1.0
    x = np.zeros(int(dur * SR), dtype="float32")
    click = (np.hanning(int(0.004 * SR)) *
             np.sin(2 * np.pi * 2000 * np.arange(int(0.004 * SR)) / SR)).astype("float32")
    for b in range(BARS * BPB):
        t = FIRST + b * BEAT_S * rate
        k = int(t * SR)
        amp = 1.0 if (b % BPB == 0) else 0.15   # downbeats loud, other beats faint
        if 0 <= k < len(x) - len(click):
            x[k:k + len(click)] += amp * click
    sf.write(path, x, SR, subtype="PCM_16")


def bake(score_path, out_path):
    r = subprocess.run(["node", os.path.join(HERE, "bake.js"), score_path, "1", "--lights", out_path],
                       capture_output=True, text=True, timeout=180)
    if r.returncode != 0:
        raise RuntimeError((r.stderr or r.stdout)[-400:])


out = []
def ok(name, cond, detail=""):
    out.append((bool(cond), name, detail))


tmp = tempfile.mkdtemp(prefix="synccheck-")
score_file = os.path.join(tmp, "click.score.json")
open(score_file, "w").write(json.dumps(SCORE))
lights_file = os.path.join(tmp, "click.lights.json")
bake(score_file, lights_file)
downbeats = json.load(open(lights_file))["downbeats"]

# --- a matching click track: the bars must lock -----------------------------
matched = os.path.join(tmp, "matched.wav")
click_track(matched, rate=1.0)
data, sr = sf.read(matched, dtype="float32")
env, fps = onset_env(data, sr)
r = analyse(env, fps, downbeats)
ok("a matching click track locks to the baked bars", r["match_ratio"] > 1.5,
   f"ratio {r['match_ratio']:.2f}")
ok("a matching track has no meaningful slide", abs(r["drift_s"]) < 0.05,
   f"{r['drift_s'] * 1000:+.0f} ms")

# --- clicks that run fast: synccheck must see the slide ----------------------
drifting = os.path.join(tmp, "drift.wav")
click_track(drifting, rate=1.004)          # 0.4% fast -> ~100 ms over the song
data2, sr2 = sf.read(drifting, dtype="float32")
env2, fps2 = onset_env(data2, sr2)
r2 = analyse(env2, fps2, downbeats)
ok("synccheck catches a track that slides against the grid", abs(r2["drift_s"]) > 0.03,
   f"{r2['drift_s'] * 1000:+.0f} ms across the song")

import shutil
shutil.rmtree(tmp, ignore_errors=True)

bad = 0
for passed, name, detail in out:
    print(f"  {'pass' if passed else 'FAIL'}  {name}{'   ' + detail if detail else ''}")
    bad += not passed
print(f"\nall {len(out)} checks pass" if not bad else f"\n{bad} FAILED")
sys.exit(1 if bad else 0)
