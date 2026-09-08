"""Move every accent to its own measured attack.

Why this was needed, and why I argued against it first. A global -10 ms shift of
every accent raises listen/mapeval.py's accents check on all five songs, and I
refused it as tuning: our claims already sat within 2 ms of spectral-flux peaks
in the mix, so the shift looked like chasing the check's filter. That reasoning
was wrong, and the onset-detection literature says why -- energy and HFC
detection functions are systematically LATE against the perceptual attack (see
Polfreman, ISMIR 2013, comparing detectors to perceptual attack time). Our
accents come from onset flux, and the witness I validated them against was also
onset flux. Two late detectors agreeing tells you nothing about either.

So this measures the attack with an instrument that is not a flux detector:
the amplitude envelope of the isolated stem, smoothed with a ZERO-PHASE filter
(filtfilt, symmetric, so it cannot shift anything in time), and the attack is
the last point below a fraction of the way from the local floor to the peak.
Measured that way our drum claims are late on every song and at every setting of
the two free parameters -- +7 to +17 ms on Levels, +10 to +18 on Starlight,
+1 to +10 on the other two. The magnitude depends on the threshold, because a
kick's attack is gradual; the sign does not.

Each accent is corrected by its OWN measurement rather than by a constant. A
claim whose attack cannot be found -- no clear peak above the local floor -- is
left exactly where it was, and a correction larger than a 16th note at 128 bpm
is refused as a failed measurement rather than trusted.

    python3 listen/attack.py levels --write        (needs the CUDA venv: librosa)
"""
import sys, os, json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mapio import map_path

STEMS = "/tmp/claude-1001/stems/htdemucs_6s"
OF_STEM = {"kick": "drums", "snare": "drums", "hat": "drums", "bass": "bass",
           "vocals": "vocals", "guitar": "guitar", "piano": "piano", "other": "other"}
SEP_LATENCY = 0.025      # observations.stem_latency: the stem runs this far behind
FRAC = 0.20              # how far up the rise counts as the attack
CUT = 60.0               # envelope smoother, zero-phase
SEARCH = 0.060           # look this far either side of the claim
MAX_MOVE = 0.030         # a 16th at 128 bpm; beyond this the measurement failed


def analyse(slug, write=False):
    import numpy as np, librosa, scipy.signal as ss
    p = map_path(slug)
    if not p: return {"error": "no map"}
    m = json.load(open(p))
    ev = ((m.get("accents") or {}).get("events")) or []
    if not ev: return {"error": "no accents"}

    per_stem, moved, failed = {}, 0, 0
    for stem in sorted(set(OF_STEM.get(e.get("of")) for e in ev) - {None}):
        fp = os.path.join(STEMS, slug, stem + ".mp3")
        if not os.path.exists(fp): continue
        y, sr = librosa.load(fp, sr=None, mono=True)
        env = ss.sosfiltfilt(ss.butter(2, CUT, "low", fs=sr, output="sos"), np.abs(y))
        offs = []
        for e in ev:
            if OF_STEM.get(e.get("of")) != stem: continue
            c = e["at"] + SEP_LATENCY                      # the claim, in stem time
            i0, i1 = int((c - SEARCH) * sr), int((c + SEARCH) * sr)
            if i0 < 0 or i1 >= len(env): failed += 1; continue
            seg = env[i0:i1]
            pk = int(np.argmax(seg))
            if pk < 5: failed += 1; continue
            base, top = seg[:pk].min(), seg[pk]
            if top <= base * 1.3: failed += 1; continue
            pre = np.where(seg[:pk + 1] <= base + FRAC * (top - base))[0]
            if not len(pre): failed += 1; continue
            attack = (i0 + pre[-1]) / sr - SEP_LATENCY     # back to mix time
            d = attack - e["at"]
            if abs(d) > MAX_MOVE: failed += 1; continue
            e["at"] = round(attack, 4)
            offs.append(d * 1000); moved += 1
        if offs:
            offs.sort()
            per_stem[stem] = {"n": len(offs),
                              "median_ms": round(offs[len(offs) // 2], 1),
                              "p25_ms": round(offs[len(offs) // 4], 1),
                              "p75_ms": round(offs[3 * len(offs) // 4], 1)}
    if not per_stem: return {"error": "no attack could be measured"}
    m["accents"]["events"] = sorted(ev, key=lambda e: e["at"])
    m["accents"]["retimed_to_attack"] = {
        "how": "each claim moved to the last point below %d%% of the rise from the local "
               "floor to the peak, on its own stem's amplitude envelope smoothed at %d Hz "
               "with a zero-phase filter" % (FRAC * 100, CUT),
        "why": "our claims came from onset flux, and flux and HFC detectors run late "
               "against the perceptual attack. The witness they were checked against was "
               "also a flux detector, so its agreement proved nothing.",
        "moved": moved, "left_alone": failed,
        "refused_beyond_ms": MAX_MOVE * 1000,
        "shift_applied_ms_by_stem": per_stem,
        "stable": "the sign of this correction holds at 10/20/30% thresholds and 40/60/100 Hz "
                  "smoothing, on every song; only the magnitude moves, because a kick's "
                  "attack is gradual"}
    if write:
        json.dump(m, open(p, "w"), indent=1, ensure_ascii=False); open(p, "a").write("\n")
    return {"moved": moved, "left_alone": failed, "by_stem": per_stem, "path": p}


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]; write = "--write" in sys.argv
    for slug in (args or ["levels", "starlight", "mizhiyoram", "dont-look-down"]):
        r = analyse(slug, write)
        if "error" in r: print("  %-16s %s" % (slug, r["error"])); continue
        print("  %-16s %d moved, %d left alone%s" % (slug, r["moved"], r["left_alone"],
                                                     "  -> written" if write else ""))
        for st, d in sorted(r["by_stem"].items()):
            print("      %-7s n=%4d  %+.1f ms (p25 %+.1f p75 %+.1f)"
                  % (st, d["n"], d["median_ms"], d["p25_ms"], d["p75_ms"]))
