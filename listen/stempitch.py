#!/usr/bin/env python3
"""The bass line, note by note, from the separated bass stem. Stdlib + ffmpeg.

    python3 listen/stempitch.py levels [--write]

The root the bass is playing is the strongest single statement a record makes
about its harmony, and it is the one thing chroma over a full mix is worst at:
a kick drum lands in the same bins. the-nights got this from the isolated stem
and our four songs had nothing.

Autocorrelation, not FFT. A bass note at 41 Hz has a period of 24 ms, so an FFT
window long enough to resolve it is long enough to smear two notes together.
Autocorrelation finds the period directly and stays sharp.

The band is 38-420 Hz, so lags of 5-58 samples once the signal is decimated to
2205 Hz -- which also makes the search cheap enough to run in Python. A beat with
no clear periodicity gets null rather than the nearest note; an unvoiced beat is
a fact and a guessed one is not (rule 2).
"""
import json, os, subprocess, sys, array, math

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
STEMS = "/tmp/claude-1001/stems/htdemucs_6s"
SR = 2205
LO_HZ, HI_HZ = 38.0, 420.0
NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
CLARITY_FLOOR = 0.34          # peak autocorrelation, normalised. Below it: null.


def stem_path(slug, stem):
    for ext in (".mp3", ".wav"):
        p = os.path.join(STEMS, slug, stem + ext)
        if os.path.exists(p):
            return p
    return None


def decode_mono(path, sr):
    out = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-ac", "1",
                          "-ar", str(sr), "-f", "s16le", "-"],
                         stdout=subprocess.PIPE, check=True).stdout
    a = array.array("h"); a.frombytes(out)
    return a


def f0(win, sr):
    """Normalised autocorrelation peak in the bass band. Returns (hz, clarity)."""
    n = len(win)
    mean = sum(win) / n
    x = [v - mean for v in win]
    e0 = sum(v * v for v in x)
    if e0 < 1e-6:
        return None, 0.0
    lo = max(2, int(sr / HI_HZ)); hi = min(n - 2, int(sr / LO_HZ))
    if hi <= lo:
        return None, 0.0
    best, blag = 0.0, 0
    for lag in range(lo, hi + 1):
        s = 0.0
        for i in range(0, n - lag, 2):        # every other sample: plenty at this rate
            s += x[i] * x[i + lag]
        s *= 2.0
        if s > best:
            best, blag = s, lag
    if not blag:
        return None, 0.0
    clarity = best / e0
    if clarity < CLARITY_FLOOR:
        return None, clarity
    return sr / blag, clarity


def name_of(hz):
    if not hz or hz <= 0:
        return None
    midi = 69 + 12 * math.log(hz / 440.0, 2)
    k = int(round(midi))
    return "%s%d" % (NAMES[k % 12], k // 12 - 1)


def map_path(slug):
    for c in (os.path.join(ROOT, "maps", "model", slug + ".full.map.json"),
              os.path.join(ROOT, "maps", "model", slug + ".map.json")):
        if os.path.exists(c):
            return c
    return None


def analyse(slug, write=False):
    sp = stem_path(slug, "bass"); mp = map_path(slug)
    if not sp or not mp:
        return {"song": slug, "error": "no bass stem or no map"}
    m = json.load(open(mp))
    beats = m.get("beats") or []
    if len(beats) < 4:
        return {"song": slug, "error": "no beats"}
    x = decode_mono(sp, SR)
    per = (m.get("grid") or {}).get("period") or 0.5
    win = int(SR * min(0.28, per * 0.85))
    notes, clar = [], []
    for b in beats:
        i0 = int(b * SR)
        seg = x[i0:i0 + win]
        if len(seg) < win // 2:
            notes.append(None); clar.append(0.0); continue
        hz, c = f0(seg, SR)
        notes.append(name_of(hz)); clar.append(round(c, 3))
    voiced = sum(1 for v in notes if v)
    obs = {
        "rate": "per_beat",
        "how": "autocorrelation f0 on the %g-%g Hz band of the separated bass stem"
               % (LO_HZ, HI_HZ),
        "unvoiced": "null",
        "not": ("the note the BASS is playing, which is not always the root of the "
                "chord and never the chord itself. A beat whose autocorrelation "
                "peak is below %.2f is null rather than the nearest note"
                % CLARITY_FLOOR),
        "voiced_beats": voiced, "total_beats": len(notes),
        "clarity": clar,
        "notes": notes,
    }
    if write:
        m.setdefault("observations", {})["bass_notes"] = obs
        json.dump(m, open(mp, "w"), indent=1); open(mp, "a").write("\n")
    from collections import Counter
    top = Counter(v[:-1] for v in notes if v).most_common(5)
    return {"song": slug, "voiced": voiced, "beats": len(notes), "top": top,
            "wrote": os.path.relpath(mp, ROOT) if write else None}


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    write = "--write" in sys.argv
    for slug in (args or ["levels", "starlight", "mizhiyoram", "dont-look-down"]):
        r = analyse(slug, write)
        if "error" in r:
            print("  %-16s %s" % (slug, r["error"])); continue
        print("  %-16s %4d/%4d beats voiced   most played: %s%s"
              % (slug, r["voiced"], r["beats"],
                 " ".join("%s x%d" % t for t in r["top"]),
                 "  -> " + r["wrote"] if r["wrote"] else ""))
