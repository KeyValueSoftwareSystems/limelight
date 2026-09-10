#!/usr/bin/env python3
"""Stereo width and pan, per downbeat. Standard library plus ffmpeg to decode.

    python3 listen/stereo.py levels [--write]

Why this needs its own decode. synth/out/*.wav is MONO at 32 kHz, so the whole
analysis chain is downstream of a downmix: every tool in listen/ is structurally
incapable of seeing stereo, and everything above 16 kHz is gone as well. The
information is not weakly represented, it is absent. So this reads the stereo
source directly and is the only thing here that does.

What it measures, per bar:
  width  0 = mono, 1 = entirely side. The classic build move is a stereo widen
         into the drop and a hard collapse to mono on the hit, and no field in
         the map could show that.
  pan    -1 left, +1 right, from the energy difference between channels.

Mid/side rather than correlation: M = (L+R)/2, S = (L-R)/2, and width is
|S| / (|M| + |S|). It is bounded, it needs no windowed normalisation, and it
does the right thing on silence (0, not undefined).
"""
import json, os, subprocess, sys, wave, array, math

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SR = 22050

# The release each map was built from now lives in mapio.RELEASES, because this
# file and listen/identify.py each used to carry their own copy of the same five
# names -- and a held-out track fetched into synth/incoming was visible to
# neither. find_source stays as a name so nothing else in this file moves.
from mapio import release_path as find_source


def decode_stereo(path):
    """Two channels, and say so if the source is mono rather than inventing width."""
    out = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path, "-ac", "2", "-ar", str(SR),
         "-f", "s16le", "-"],
        stdout=subprocess.PIPE, check=True).stdout
    a = array.array("h"); a.frombytes(out)
    L = a[0::2]; R = a[1::2]
    return L, R


try:
    from mapio import map_path
except ImportError:
    import sys as _s, os as _o
    _s.path.insert(0, _o.path.dirname(_o.path.abspath(__file__)))
    from mapio import map_path


def analyse(slug, write=False):
    src = find_source(slug)
    mp = map_path(slug)
    if not src or not mp:
        return {"song": slug, "error": "no stereo source or no map"}
    m = json.load(open(mp))
    downs = m.get("downbeats") or []
    if len(downs) < 2:
        return {"song": slug, "error": "no downbeats to bin against"}

    L, R = decode_stereo(src)
    n = min(len(L), len(R))
    if n < SR:
        return {"song": slug, "error": "decode too short"}

    width, pan = [], []
    edges = list(downs) + [downs[-1] + (downs[-1] - downs[-2])]
    for i in range(len(downs)):
        i0 = max(0, int(edges[i] * SR)); i1 = min(n, int(edges[i + 1] * SR))
        if i1 <= i0:
            width.append(0.0); pan.append(0.0); continue
        sm = ss = sl = sr_ = 0.0
        step = max(1, (i1 - i0) // 4000)          # a few thousand samples is plenty
        cnt = 0
        for k in range(i0, i1, step):
            l = L[k] / 32768.0; r = R[k] / 32768.0
            sm += abs((l + r) * 0.5); ss += abs((l - r) * 0.5)
            sl += l * l; sr_ += r * r; cnt += 1
        if not cnt:
            width.append(0.0); pan.append(0.0); continue
        w = ss / (sm + ss) if (sm + ss) > 1e-9 else 0.0
        p = ((sr_ - sl) / (sr_ + sl)) if (sr_ + sl) > 1e-12 else 0.0
        width.append(round(w, 4)); pan.append(round(max(-1.0, min(1.0, p)), 4))

    mono = max(width) < 0.01
    obs = {
        "rate": "per_downbeat",
        "width": "0=mono, 1=fully side",
        "pan": "-1=left, +1=right",
        "how": ("mid/side on the STEREO source decoded straight from the release, "
                "not from synth/out which is mono 32 kHz and cannot carry this. "
                "width = |S|/(|M|+|S|) with M=(L+R)/2, S=(L-R)/2"),
        "not": ("a stereo measurement of a mix, not of any instrument. A wide bar "
                "says the production opened up, not which part moved"),
        "source": os.path.basename(src),
        "mix": {"width": width, "pan": pan},
    }
    if mono:
        obs["warning"] = "the source decoded as effectively mono; width is not meaningful"
    if write:
        m.setdefault("observations", {})["stereo"] = obs
        json.dump(m, open(mp, "w"), indent=1); open(mp, "a").write("\n")
    span = (min(width), max(width))
    return {"song": slug, "bars": len(width), "width_min": span[0], "width_max": span[1],
            "width_mean": round(sum(width) / len(width), 4),
            "pan_mean": round(sum(pan) / len(pan), 4),
            "wrote": os.path.relpath(mp, ROOT) if write else None}


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    write = "--write" in sys.argv
    for slug in (args or sorted(SOURCES)):
        r = analyse(slug, write)
        if "error" in r:
            print("  %-16s %s" % (slug, r["error"])); continue
        print("  %-16s %3d bars  width %.3f-%.3f (mean %.3f)  pan %+.3f%s"
              % (slug, r["bars"], r["width_min"], r["width_max"], r["width_mean"],
                 r["pan_mean"], "  -> " + r["wrote"] if r["wrote"] else ""))
