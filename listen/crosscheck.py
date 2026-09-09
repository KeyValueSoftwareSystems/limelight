import sys, os, json, collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mapio import map_path

TOL_BEATS = 0.20
MIN_VOTES = 12
LOW_CONF = 0.45


def chord_starts(m):
    segs = ((m.get("observations") or {}).get("chords") or {}).get("segments") or []
    return [
        s["from"]
        for s in segs
        if s.get("from") is not None and s.get("chord") not in (None, "N")
    ]


def chord_durations(m):
    segs = ((m.get("observations") or {}).get("chords") or {}).get("segments") or []
    return [
        s["to"] - s["from"]
        for s in segs
        if s.get("from") is not None
        and s.get("to") is not None
        and s.get("chord") not in (None, "N")
    ]


def phase_from_harmony(m):
    g = m.get("grid") or {}
    per, ph = g.get("period"), g.get("phase")
    if not per or ph is None:
        return None
    starts = chord_starts(m)
    if not starts:
        return None
    votes = collections.Counter()
    off = 0
    for t in starts:
        x = (t - ph) / per
        if abs(x - round(x)) > TOL_BEATS:
            off += 1
            continue
        votes[int(round(x)) % 4] += 1
    tot = sum(votes.values())
    if tot < MIN_VOTES:
        return {
            "verdict": "too few chord changes land on the beat grid to judge the bar line",
            "on_grid": tot,
            "off_grid": off,
            "needed": MIN_VOTES,
        }
    best, second = (
        votes.most_common(2) if len(votes) > 1 else (votes.most_common(1)[0], (None, 0))
    )
    return {
        "phase": best[0],
        "share": round(best[1] / tot, 3),
        "runner_up": second[0],
        "runner_up_share": round(second[1] / tot, 3),
        "margin": round((best[1] - second[1]) / tot, 3),
        "on_grid": tot,
        "off_grid": off,
        "votes": dict(sorted(votes.items())),
    }


def octave_from_harmony(m):
    g = m.get("grid") or {}
    per = g.get("period")
    if not per:
        return None
    durs = [d / per for d in chord_durations(m)]
    durs = [d for d in durs if 0.2 <= d <= 16]
    if len(durs) < MIN_VOTES:
        return {
            "verdict": "too few chord segments to judge the tempo octave",
            "n": len(durs),
            "needed": MIN_VOTES,
        }
    ints = sum(1 for d in durs if abs(d - round(d)) < TOL_BEATS)
    halves = sum(
        1
        for d in durs
        if abs(d * 2 - round(d * 2)) < TOL_BEATS and abs(d - round(d)) >= TOL_BEATS
    )
    doubles = sum(1 for d in durs if abs(d / 2 - round(d / 2)) < TOL_BEATS)
    if halves > ints:
        v = (
            "harmonic rhythm lands on HALF beats more often than on beats, which is what a "
            "claimed tempo twice the real one looks like"
        )
    elif ints >= 2 * halves:
        v = "harmonic rhythm sits on whole beats, consistent with the claimed tempo"
    else:
        v = (
            "harmonic rhythm is split between whole and half beats -- the octave is not "
            "settled by harmony on this record"
        )
    return {
        "n": len(durs),
        "on_whole_beats": ints,
        "on_half_beats": halves,
        "on_even_beats": doubles,
        "verdict": v,
        "octave_consistent": bool(ints >= 2 * halves),
    }


def analyse(slug, write=False):
    p = map_path(slug)
    if not p:
        return {"error": "no map"}
    m = json.load(open(p))
    g = m.get("grid") or {}
    claimed = g.get("bar_phase")
    ph = phase_from_harmony(m)
    oc = octave_from_harmony(m)
    if ph is None and oc is None:
        return {"error": "no chords to cross-check against"}

    agree = None
    if ph and "phase" in ph and claimed is not None:
        agree = ph["phase"] == claimed

    out = {
        "what": "the bar line and the tempo octave, checked against harmony instead of drums",
        "why": "grid.bar_phase comes from where the drum pattern repeats and listen/meter.py "
        "confirms beats-per-bar from the same drum pattern, which is drums grading "
        "drums. Chord boundaries come from ChordMini, a harmonic model that shares no "
        "code and no feature family with the percussive path, and a chord change lands "
        "on a bar line far more often than not.",
        "bar_phase_claimed": claimed,
        "bar_phase_from_harmony": ph,
        "tempo_octave_from_harmony": oc,
        "agree": agree,
        "not": "this does not pick a winner. A disagreement means the bar line is not settled, "
        "and the honest response is to say so in confidence rather than to choose "
        "silently between two methods that each have a case.",
    }

    conf = m.setdefault("confidence_by_field", {})
    before = conf.get("downbeats")
    if agree is False:
        conf["downbeats"] = min(LOW_CONF, before if before is not None else LOW_CONF)
        out["confidence_downbeats"] = {
            "was": before,
            "now": conf["downbeats"],
            "why": "harmony puts the bar line on phase %s and this file claims %s"
            % (ph.get("phase"), claimed),
        }
    elif agree is True:
        out["confidence_downbeats"] = {
            "was": before,
            "now": before,
            "why": "harmony and the drums agree, so confidence is "
            "left where the writer put it",
        }
    if oc and oc.get("octave_consistent") is False:
        out["octave_flag"] = (
            "the tempo octave is not corroborated by harmony. A confidently "
            "wrong tempo makes every time in this file wrong at once, so it "
            "is flagged here rather than left silent."
        )

    m.setdefault("observations", {})["grid_crosscheck"] = out
    if write:
        json.dump(m, open(p, "w"), indent=1, ensure_ascii=False)
        open(p, "a").write("\n")
    return {
        "slug": slug,
        "claimed": claimed,
        "harmony": ph,
        "octave": oc,
        "agree": agree,
        "conf": conf.get("downbeats"),
        "path": p,
    }


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    write = "--write" in sys.argv
    for slug in args or ["levels", "starlight", "mizhiyoram", "dont-look-down"]:
        r = analyse(slug, write)
        if "error" in r:
            print("  %-16s %s" % (slug, r["error"]))
            continue
        h = r["harmony"] or {}
        oc = r["octave"] or {}
        if "phase" in h:
            print(
                "  %-16s claims phase %s, harmony says %s (%.0f%% of %d changes, margin %+.0f%%)  %s"
                % (
                    slug,
                    r["claimed"],
                    h["phase"],
                    100 * h["share"],
                    h["on_grid"],
                    100 * h["margin"],
                    "AGREE"
                    if r["agree"]
                    else "DISAGREE -> confidence %.2f" % (r["conf"] or 0),
                )
            )
        else:
            print("  %-16s %s" % (slug, h.get("verdict", "no harmonic verdict")))
        print("  %-16s octave: %s" % ("", oc.get("verdict", "-")))
