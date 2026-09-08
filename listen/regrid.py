#!/usr/bin/env python3
"""Refine the beat grid against the isolated drums. Stdlib + ffmpeg.

    python3 listen/regrid.py levels [--write]

grid is the heaviest field in listen/mapeval.py and the one everything else sits
on: a wrong grid makes every downstream field wrong however well measured it is.
Ours scores 0.46-0.75, meaning the kick is 1.4-1.6x louder on our beats than on
average when a well-placed grid on this audio reaches 1.8x.

The measurement, and the trap. mapeval scores against the low band of the MIX,
so refining the grid against the low band of the mix would be fitting the check
rather than measuring the song -- the score would rise and nothing would be more
true. This reads the SEPARATED DRUMS STEM instead, which is a different signal:
no bass note, no kick-drum-shaped synth, just the kit. If the grid improves there
AND mapeval independently agrees, the improvement is real.

What it searches: a phase offset within half a beat, and a small proportional
correction to the period, maximising kick-band energy at the beat times. Nothing
per-beat is moved -- these are machine-timed records and a rigid grid is the
right model for them; a per-beat snap would raise the number by fitting noise.
"""
import json, math, os, subprocess, sys, array

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
try:
    from mapio import stems_dir
except ImportError:
    import sys as _s, os as _o
    _s.path.insert(0, _o.path.dirname(_o.path.abspath(__file__)))
    from mapio import stems_dir
STEMS = stems_dir()
SR = 2000
KICK_LO, KICK_HI = 30.0, 140.0


def decode(path, sr):
    out = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-ac", "1",
                          "-ar", str(sr), "-f", "s16le", "-"],
                         stdout=subprocess.PIPE, check=True).stdout
    a = array.array("h"); a.frombytes(out)
    return [v / 32768.0 for v in a]


def band_env(x, sr, lo, hi):
    """One-pole band-pass then a rectified envelope. Cheap and good enough: we
    are looking for where energy ARRIVES, not for its exact spectrum."""
    a_hi = math.exp(-2 * math.pi * hi / sr)
    a_lo = math.exp(-2 * math.pi * lo / sr)
    y1 = y2 = 0.0
    out = [0.0] * len(x)
    for i, v in enumerate(x):
        y1 = (1 - a_hi) * v + a_hi * y1        # low-pass at hi
        y2 = (1 - a_lo) * y1 + a_lo * y2       # low-pass at lo
        out[i] = abs(y1 - y2)                  # what is between them
    # short smoothing so a single sample does not decide anything
    k = max(1, int(sr * 0.004))
    acc, sm = 0.0, [0.0] * len(out)
    for i, v in enumerate(out):
        acc += v
        if i >= k: acc -= out[i - k]
        sm[i] = acc / min(k, i + 1)
    return sm


def score_grid(env, sr, phase, period, n, dur):
    tot = cnt = 0.0
    t = phase
    while t < dur and cnt < n:
        i = int(t * sr)
        if 0 <= i < len(env):
            tot += env[i]; cnt += 1
        t += period
    return (tot / cnt) if cnt else 0.0


def map_path(slug):
    for c in (os.path.join(ROOT, "maps", "model", slug + ".full.map.json"),
              os.path.join(ROOT, "maps", "model", slug + ".map.json")):
        if os.path.exists(c): return c
    return None


TIMED = [("beats", None), ("downbeats", None)]


def analyse(slug, write=False):
    mp = map_path(slug)
    p = None
    for ext in (".mp3", ".wav"):
        q = os.path.join(STEMS, slug, "drums" + ext)
        if os.path.exists(q): p = q; break
    if not mp or not p:
        return {"song": slug, "error": "no map or no drums stem"}
    m = json.load(open(mp))
    g = m.get("grid") or {}
    per0, ph0 = g.get("period"), g.get("phase")
    beats = m.get("beats") or []
    if not per0 or ph0 is None or len(beats) < 8:
        return {"song": slug, "error": "no grid"}
    x = decode(p, SR)
    env = band_env(x, SR, KICK_LO, KICK_HI)
    dur = len(x) / SR
    mean = sum(env) / max(1, len(env))
    n = len(beats)

    base = score_grid(env, SR, ph0, per0, n, dur)
    best = (base, 0.0, 1.0)
    # phase within half a beat, period within a quarter percent
    for dp in [i * 0.002 for i in range(-int(per0 * 250), int(per0 * 250) + 1)]:
        for kper in (0.9985, 0.999, 0.9995, 1.0, 1.0005, 1.001, 1.0015):
            s = score_grid(env, SR, ph0 + dp, per0 * kper, n, dur)
            if s > best[0]:
                best = (s, dp, kper)
    s, dp, kper = best
    lift = s / base if base > 0 else 1.0
    out = {"song": slug, "base_ratio": round(base / mean, 3),
           "new_ratio": round(s / mean, 3), "shift_ms": round(dp * 1000, 1),
           "period_scale": kper, "lift": round(lift, 3)}
    if write and (lift > 1.005 or abs(dp) > 0.0005):
        newper, newph = per0 * kper, ph0 + dp
        # every timed thing that was DERIVED from the grid moves with it, so the
        # map stays internally consistent (bars must not regress)
        def remap(t):
            k = round((t - ph0) / per0)
            return round(newph + k * newper, 6)
        m["beats"] = [remap(t) for t in beats]
        if m.get("downbeats"):
            m["downbeats"] = [remap(t) for t in m["downbeats"]]
        for key in ("chapters", "moments"):
            for r in (m.get(key) or []):
                if isinstance(r.get("at"), (int, float)): r["at"] = remap(r["at"])
        for r in (m.get("spans") or []):
            for k2 in ("from", "to"):
                if isinstance(r.get(k2), (int, float)): r[k2] = remap(r[k2])
        sec = m.get("sections")
        rows = sec.get("entries") if isinstance(sec, dict) else sec
        for r in (rows or []):
            if isinstance(r, dict) and isinstance(r.get("at"), (int, float)):
                r["at"] = remap(r["at"])
        g["period"], g["phase"] = round(newper, 6), round(newph, 6)
        g["regrid"] = {
            "how": ("phase and period refined against the kick band of the "
                    "SEPARATED DRUMS stem, not the mix -- mapeval scores against "
                    "the mix, so fitting the mix would be fitting the check"),
            "shift_ms": round(dp * 1000, 1), "period_scale": kper,
            "kick_energy_on_beats": {"before": round(base / mean, 3),
                                     "after": round(s / mean, 3)},
            "not": "a per-beat snap. These are machine-timed records and a rigid grid is the model",
        }
        json.dump(m, open(mp, "w"), indent=1); open(mp, "a").write("\n")
        out["wrote"] = os.path.relpath(mp, ROOT)
    return out


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    write = "--write" in sys.argv
    for slug in (args or ["levels", "starlight", "mizhiyoram", "dont-look-down"]):
        r = analyse(slug, write)
        if "error" in r: print("  %-16s %s" % (slug, r["error"])); continue
        print("  %-16s drums-stem kick on beats %.3f -> %.3f  (shift %+.1f ms, period x%.4f)%s"
              % (slug, r["base_ratio"], r["new_ratio"], r["shift_ms"], r["period_scale"],
                 "  -> " + r["wrote"] if r.get("wrote") else ""))
