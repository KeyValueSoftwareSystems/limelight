#!/usr/bin/env python3
"""Per-stem brightness and envelope, from the separated stems. Stdlib + ffmpeg.

    python3 listen/stemshape.py levels [--write]

Two fields the-nights carries and ours did not.

brightness  spectral centroid per stem, per bar, normalised within the stem.
            This is what a filter sweep looks like from outside: a build opens
            the low-pass and the centroid climbs, and nothing else in the map
            shows it. Normalised per stem because a hi-hat is always brighter
            than a bass and the interesting thing is each part's own movement.

envelope    per stem, per beat, in dB below that stem's own 99th percentile.
            Says when a part is present and how hard, on a scale where silence
            is unambiguous rather than a small number.

Both are measured on the isolated stems, so "the vocal got brighter" means the
vocal and not the cymbals bleeding into the same band.
"""
import json, math, os, subprocess, sys, array

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import ear

STEMS = "/tmp/claude-1001/stems/htdemucs_6s"
ALL = ("vocals", "drums", "bass", "guitar", "piano", "other")
SR = 11025
N = 1024
FLOOR_DB = -60.0


def decode(path, sr):
    out = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-ac", "1",
                          "-ar", str(sr), "-f", "s16le", "-"],
                         stdout=subprocess.PIPE, check=True).stdout
    a = array.array("h"); a.frombytes(out)
    return a


def hann(n):
    return [0.5 - 0.5 * math.cos(2 * math.pi * i / (n - 1)) for i in range(n)]


def centroid(sig, i0, i1, win):
    """Energy-weighted mean frequency over one bar."""
    num = den = 0.0
    p, hops = i0, 0
    while p + N <= i1 and hops < 8:
        spec = ear._fft([complex(sig[p + i] * win[i], 0.0) for i in range(N)])
        for k in range(2, N // 2):
            mag = abs(spec[k])
            num += mag * (k * SR / N); den += mag
        p += N; hops += 1
    return (num / den) if den > 1e-9 else None


def rms_db(sig, i0, i1, ref):
    if i1 <= i0: return FLOOR_DB
    s = 0.0; step = max(1, (i1 - i0) // 2000); c = 0
    for k in range(i0, i1, step):
        v = sig[k] / 32768.0; s += v * v; c += 1
    if not c: return FLOOR_DB
    r = math.sqrt(s / c)
    if r <= 1e-7 or ref <= 1e-9: return FLOOR_DB
    return max(FLOOR_DB, round(20 * math.log10(r / ref), 1))


def pct(vals, q):
    v = sorted(x for x in vals if x is not None)
    if not v: return 0.0
    return v[min(len(v) - 1, int(len(v) * q))]


def map_path(slug):
    for c in (os.path.join(ROOT, "maps", "model", slug + ".full.map.json"),
              os.path.join(ROOT, "maps", "model", slug + ".map.json")):
        if os.path.exists(c): return c
    return None


def analyse(slug, write=False):
    mp = map_path(slug)
    if not mp: return {"song": slug, "error": "no map"}
    m = json.load(open(mp))
    downs = m.get("downbeats") or []; beats = m.get("beats") or []
    if len(downs) < 2 or len(beats) < 4:
        return {"song": slug, "error": "needs beats and downbeats"}
    win = hann(N)
    bright, env = {}, {}
    for st in ALL:
        p = None
        for ext in (".mp3", ".wav"):
            q = os.path.join(STEMS, slug, st + ext)
            if os.path.exists(q): p = q; break
        if not p: continue
        sig = decode(p, SR)
        n = len(sig)
        # brightness per bar
        edges = list(downs) + [downs[-1] + (downs[-1] - downs[-2])]
        cs = []
        for i in range(len(downs)):
            i0, i1 = int(edges[i] * SR), min(n, int(edges[i + 1] * SR))
            cs.append(centroid(sig, i0, i1, win))
        lo, hi = pct([c for c in cs if c], 0.05), pct([c for c in cs if c], 0.95)
        rng = max(1e-6, hi - lo)
        bright[st] = [None if c is None else round(min(1.0, max(0.0, (c - lo) / rng)), 3)
                      for c in cs]
        # envelope per beat, referenced to this stem's own 99th percentile
        raw = []
        for b in beats:
            i0 = int(b * SR); i1 = min(n, i0 + int(SR * 0.25))
            if i1 <= i0: raw.append(0.0); continue
            s = 0.0; step = max(1, (i1 - i0) // 1200); c = 0
            for k in range(i0, i1, step):
                v = sig[k] / 32768.0; s += v * v; c += 1
            raw.append(math.sqrt(s / c) if c else 0.0)
        ref = pct(raw, 0.99) or 1e-9
        env[st] = [max(FLOOR_DB, round(20 * math.log10(r / ref), 1)) if r > 1e-7 else FLOOR_DB
                   for r in raw]
    if not bright:
        return {"song": slug, "error": "no stems"}
    obs_b = {"rate": "per_downbeat", "of": "spectral centroid per stem, normalised",
             "how": ("energy-weighted mean frequency per bar on each separated stem, "
                     "mapped to 0-1 between that stem's own 5th and 95th percentile"),
             "not": ("a filter cutoff. It moves when a filter opens and also when the "
                     "part changes register, and it cannot tell those apart"),
             "sources": bright}
    obs_e = {"of": "per stem", "rate": "per_beat",
             "unit": "dB below each stem's 99th percentile",
             "how": "RMS over the first quarter second of each beat on the separated stem",
             "sources": env}
    if write:
        o = m.setdefault("observations", {})
        o["brightness"] = obs_b; o["envelope"] = obs_e
        json.dump(m, open(mp, "w"), indent=1); open(mp, "a").write("\n")
    return {"song": slug, "stems": len(bright), "bars": len(next(iter(bright.values()))),
            "beats": len(next(iter(env.values()))),
            "wrote": os.path.relpath(mp, ROOT) if write else None}


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    write = "--write" in sys.argv
    for slug in (args or ["levels", "starlight", "mizhiyoram", "dont-look-down"]):
        r = analyse(slug, write)
        if "error" in r: print("  %-16s %s" % (slug, r["error"])); continue
        print("  %-16s %d stems  %d bars  %d beats%s"
              % (slug, r["stems"], r["bars"], r["beats"],
                 "  -> " + r["wrote"] if r["wrote"] else ""))
