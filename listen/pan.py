#!/usr/bin/env python3
"""Where each accent sits between the speakers, from the separated stems.

    $LIMELIGHT_PY_AUDIO listen/pan.py [slug ...] [--write]

`accents` says a hat was struck at 41.28 s. It does not say the hat is on the
right, and a rig with fixtures on both sides has no way to answer "which side
answers this hit" without guessing. That is the whole reason for this field.

Measured from the STEREO stems, which is why this needed new separation work:
synth/out/*.wav is a mono 32 kHz downmix for four of the five songs and cannot
carry the answer at all. The stems come from the release file instead, and
tools/setup.sh has a `stereo` target that produces both those stems and the
low-rate stereo mix the scorer needs for its own side.

pan = (R energy - L energy) / (R + L) over 40 ms from the accent, on the stem
that accent's label belongs to, with the same +25 ms separator latency
correction the rest of the stem work uses.

Checked in the scorer against the raw mix's own L-R at the same instants -- see
ev_pan. The two sides share the recording and nothing else: this reads six
separated stereo files, that reads the unseparated release. The correlation
comes out +0.20 to +0.37 on the five songs, and it is diluted rather than
strong for a reason worth writing down: at the instant a hat on the right is
struck, the mix also contains a centred kick and a centred bass, so the mix's
own L-R is pulled toward the middle. A hard-panned accent still moves it.
"""
import sys, os, json, math, collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mapio import map_path, work_dir

SR = 22050
WIN_S = 0.040
STEM_LATENCY_S = 0.025
STEM_OF = {"kick": "drums", "snare": "drums", "hat": "drums", "tom": "drums",
           "clap": "drums", "ride": "drums", "guitar": "guitar", "piano": "piano",
           "vocal": "vocals", "vocals": "vocals", "bass": "bass", "other": "other"}


def stereo_stems_dir():
    return os.environ.get("LIMELIGHT_STEMS_STEREO",
                          os.path.join(work_dir(), "stems-stereo", "htdemucs_6s"))


def load_stereo(path):
    import librosa
    y, _ = librosa.load(path, sr=SR, mono=False)
    if getattr(y, "ndim", 1) == 1:
        return y, y, True
    return y[0], y[1], False


def pan_at(L, R, t, lat=STEM_LATENCY_S):
    a = int((t + lat) * SR)
    b = min(len(L), a + int(WIN_S * SR))
    if b <= a:
        return None, 0.0
    el = float(sum(float(v) * float(v) for v in L[a:b]))
    er = float(sum(float(v) * float(v) for v in R[a:b]))
    if el + er < 1e-9:
        return None, 0.0
    return (er - el) / (er + el), el + er


def analyse(slug, write=False):
    mp = map_path(slug)
    if not mp:
        return {"error": "no map"}
    d = os.path.join(stereo_stems_dir(), slug)
    if not os.path.isdir(d):
        return {"error": "no stereo stems at %s -- run tools/setup.sh stereo" % d}
    m = json.load(open(mp))
    ev = ((m.get("accents") or {}).get("events")) or []
    if not ev:
        return {"error": "no accents to place"}

    import numpy as np
    cache, mono_stems = {}, []
    out, by = [], collections.defaultdict(list)
    for e in ev:
        st = STEM_OF.get(e.get("of"))
        if not st:
            continue
        if st not in cache:
            hit = [f for f in os.listdir(d) if f.startswith(st + ".")]
            if not hit:
                cache[st] = None
            else:
                L, R, is_mono = load_stereo(os.path.join(d, hit[0]))
                cache[st] = (np.asarray(L), np.asarray(R))
                if is_mono:
                    mono_stems.append(st)
        if cache[st] is None:
            continue
        L, R = cache[st]
        a = int((e["at"] + STEM_LATENCY_S) * SR)
        b = min(len(L), a + int(WIN_S * SR))
        if b <= a:
            continue
        el = float(np.sum(L[a:b] ** 2)); er = float(np.sum(R[a:b] ** 2))
        if el + er < 1e-9:
            continue
        p = (er - el) / (er + el)
        out.append({"at": round(e["at"], 3), "of": e.get("of"), "pan": round(p, 3)})
        by[e.get("of")].append(p)

    if len(out) < 30:
        return {"error": "only %d accents could be placed" % len(out)}

    spread = {}
    for lab, v in by.items():
        v2 = sorted(v)
        spread[lab] = {
            "n": len(v),
            "mean": round(sum(v) / len(v), 3),
            "p10": round(v2[int(0.10 * (len(v2) - 1))], 3),
            "p90": round(v2[int(0.90 * (len(v2) - 1))], 3),
        }

    m.setdefault("observations", {})["pan"] = {
        "rate": "per_accent",
        "unit": "-1 = fully left, 0 = centre, +1 = fully right",
        "how": "(R energy - L energy) / (R + L) over %d ms from the accent, on the stereo "
               "stem that accent's label belongs to, with the +%d ms separator latency "
               "correction applied" % (int(1000 * WIN_S), int(1000 * STEM_LATENCY_S)),
        "why_it_exists": "accents say a hat was struck; they do not say the hat is on the right. A reader that can place anything to the left or the right of the audience cannot decide which side answers a hit without this, and defaulting to the middle throws away every left-right decision the record already made.",
        "not": "a claim about where the instrument was recorded. It is where the mix puts it, "
               "which is a production decision and can change between sections.",
        "source": "stereo stems separated from the release file, NOT from synth/out, which is "
                  "a mono downmix for four of these five songs and cannot carry pan",
        "provenance": "measured",
        "checked_against": "the raw release mix's own L-R at the same instants, in "
                           "mapeval.ev_pan. Shares the recording and no code: one side is six "
                           "separated stereo files, the other is the unseparated release.",
        "mono_stems": mono_stems or None,
        "spread_by_label": dict(sorted(spread.items())),
        "entries": out,
    }
    if write:
        json.dump(m, open(mp, "w"), indent=1, ensure_ascii=False)
        open(mp, "a").write("\n")
    return {"slug": slug, "n": len(out), "labels": spread, "wrote": write}


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    write = "--write" in sys.argv
    for slug in args or ["levels", "starlight", "mizhiyoram", "dont-look-down", "the-nights"]:
        r = analyse(slug, write)
        if "error" in r:
            print("  %-16s %s" % (slug, r["error"]))
            continue
        print("  %-16s %4d accents placed%s" % (slug, r["n"], "  -> written" if write else ""))
        for lab, s in sorted(r["labels"].items()):
            print("     %-7s n=%4d  mean %+0.2f  p10 %+0.2f  p90 %+0.2f"
                  % (lab, s["n"], s["mean"], s["p10"], s["p90"]))
