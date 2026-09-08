#!/usr/bin/env python3
"""Chords from the separated harmonic stems, with the bass as the root prior.

    python3 listen/stemchords.py levels [--write]

Two estimates already exist and they agree on 11-31% of bars: chroma over the
full mix (listen/ear.py) and per-semitone Goertzel over the full mix
(listen/harmony.py). Both read a mix in which a kick drum lands in the same
twelve bins as the harmony, and both are weak for the same reason.

This reads bass, piano, guitar and other -- the stems that actually carry the
harmony -- and takes the root from observations.bass_notes, which is measured by
autocorrelation on the isolated bass and validates against the songs we can check
by ear (Levels comes out A, E, C#, B, which is its progression). Given the root,
only the QUALITY has to be decided, which is a far easier question than finding
root and quality together.

A bar whose stems are too quiet, or whose bass gave no note, carries no chord.
"""
import json, math, os, subprocess, sys, array

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import ear

try:
    from mapio import stems_dir
except ImportError:
    import sys as _s, os as _o
    _s.path.insert(0, _o.path.dirname(_o.path.abspath(__file__)))
    from mapio import stems_dir
STEMS = stems_dir()
HARMONIC = ("bass", "piano", "guitar", "other")
SR = 8820
N = 2048
LO_HZ, HI_HZ = 60.0, 2000.0
NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
IDX = {n: i for i, n in enumerate(NAMES)}
# thirds and sevenths, relative to the root
QUALITIES = (("",   (0, 4, 7)), ("m",  (0, 3, 7)),
             ("7",  (0, 4, 7, 10)), ("m7", (0, 3, 7, 10)),
             ("sus4", (0, 5, 7)))
WINDOW = ear.TON_WINDOW if hasattr(ear, "TON_WINDOW") else None


def decode(path, sr):
    out = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-ac", "1",
                          "-ar", str(sr), "-f", "s16le", "-"],
                         stdout=subprocess.PIPE, check=True).stdout
    a = array.array("h"); a.frombytes(out)
    return a


def hann(n):
    return [0.5 - 0.5 * math.cos(2 * math.pi * i / (n - 1)) for i in range(n)]


def chroma_of(sig, i0, i1, win):
    """Twelve pitch classes over one bar, C first."""
    acc = [0.0] * 12
    k0 = max(1, int(LO_HZ * N / SR)); k1 = min(N // 2, int(HI_HZ * N / SR))
    pcs = [int(round(12 * math.log((k * SR / N) / 440.0, 2))) % 12 for k in range(k0, k1)]
    p = i0
    hops = 0
    while p + N <= i1 and hops < 12:
        spec = ear._fft([complex(sig[p + i] * win[i], 0.0) for i in range(N)])
        for j, k in enumerate(range(k0, k1)):
            acc[pcs[j]] += abs(spec[k])
        p += N
        hops += 1
    if not hops:
        return None
    tot = sum(acc) or 1.0
    # A-based bins -> C first
    return [acc[(i - 9) % 12] / tot for i in range(12)]


def best_quality(ch, root):
    best = None
    for suf, ivs in QUALITIES:
        tmpl = [0.0] * 12
        for n_, iv in enumerate(ivs):
            tmpl[(root + iv) % 12] = 1.0 if n_ < 3 else 0.6
        r = ear._corr(ch, tmpl)
        if best is None or r > best[0]:
            best = (r, suf)
    return best


def map_path(slug):
    for c in (os.path.join(ROOT, "maps", "model", slug + ".full.map.json"),
              os.path.join(ROOT, "maps", "model", slug + ".map.json")):
        if os.path.exists(c):
            return c
    return None


def analyse(slug, write=False):
    mp = map_path(slug)
    if not mp:
        return {"song": slug, "error": "no map"}
    m = json.load(open(mp))
    downs = m.get("downbeats") or []
    beats = m.get("beats") or []
    bn = ((m.get("observations") or {}).get("bass_notes") or {}).get("notes") or []
    if len(downs) < 2 or not bn:
        return {"song": slug, "error": "needs downbeats and bass_notes"}

    sigs = []
    for st in HARMONIC:
        for ext in (".mp3", ".wav"):
            p = os.path.join(STEMS, slug, st + ext)
            if os.path.exists(p):
                sigs.append(decode(p, SR)); break
    if not sigs:
        return {"song": slug, "error": "no harmonic stems"}
    n = min(len(s) for s in sigs)
    mix = array.array("h", [0]) * 0
    mix = [0.0] * n
    for s in sigs:
        for i in range(n):
            mix[i] += s[i]
    win = hann(N)

    import bisect, collections
    events, unknown = [], 0
    edges = list(downs) + [downs[-1] + (downs[-1] - downs[-2])]
    for bi in range(len(downs)):
        a, b = edges[bi], edges[bi + 1]
        i0, i1 = int(a * SR), min(n, int(b * SR))
        if i1 - i0 < N:
            unknown += 1; continue
        # the root the bass played most in this bar
        j0 = bisect.bisect_left(beats, a); j1 = bisect.bisect_left(beats, b)
        roots = [bn[j][:-1] for j in range(j0, min(j1, len(bn))) if j < len(bn) and bn[j]]
        if not roots:
            unknown += 1; continue
        root_name = collections.Counter(roots).most_common(1)[0][0]
        root = IDX.get(root_name)
        if root is None:
            unknown += 1; continue
        ch = chroma_of(mix, i0, i1, win)
        if ch is None:
            unknown += 1; continue
        r, suf = best_quality(ch, root)
        if r < 0.15:
            unknown += 1; continue
        events.append({"at": round(a, 3), "chord": root_name + suf,
                       "confidence": round(max(0.0, min(1.0, r)), 3)})
    if not events:
        return {"song": slug, "error": "nothing confident"}
    obs = {
        "rate": "per_bar",
        "how": ("chroma over the separated bass+piano+guitar+other stems, with the "
                "root taken from observations.bass_notes and only the quality "
                "matched (maj, min, 7, m7, sus4)"),
        "not": ("still an estimate. It is better than chroma over a full mix "
                "because a kick drum is not in these stems and because the root "
                "is measured rather than inferred, but nobody has checked it "
                "against an instrument"),
        "bars_named": len(events), "bars_total": len(downs), "unknown": unknown,
        "events": events,
    }
    if write:
        m.setdefault("observations", {})["chords_stem"] = obs
        json.dump(m, open(mp, "w"), indent=1); open(mp, "a").write("\n")
    from collections import Counter
    top = Counter(e["chord"] for e in events).most_common(5)
    return {"song": slug, "named": len(events), "total": len(downs), "top": top,
            "wrote": os.path.relpath(mp, ROOT) if write else None}


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    write = "--write" in sys.argv
    for slug in (args or ["levels", "starlight", "mizhiyoram", "dont-look-down"]):
        r = analyse(slug, write)
        if "error" in r:
            print("  %-16s %s" % (slug, r["error"])); continue
        print("  %-16s %3d/%-3d bars   %s%s"
              % (slug, r["named"], r["total"],
                 "  ".join("%s x%d" % t for t in r["top"]),
                 "  -> " + r["wrote"] if r["wrote"] else ""))
