#!/usr/bin/env python3
"""Fields that follow from fields already measured. Stdlib, no audio.

    python3 listen/derive.py synth/maps/amal/*.map.json

Everything here is a second look at a measurement that is already in the file,
so it needs no recording and it cannot invent anything the map did not already
claim. Provenance stays whatever the source field's provenance was, and each
derived field says which field it came from -- so if the source turns out to be
wrong, everything downstream of it is identifiable and can be dropped.

One writer per fact: a field already present is left alone.

Why phrases. observations.lyrics carries word timings from Whisper and its own
note says the WORDS are unreliable on a sung separated stem and the TIMES are
what to trust. A reader that lights individual words is reading the half that is
wrong, and an ablation put lyrics at 0.002% of the show -- unused. What a
lighting designer actually cues on is the phrase: a vocal line starts, it runs,
and there is a gap before the next one. The gap is where a look can change
without cutting the singer off mid-sentence.
"""
import json, os, statistics, sys

# A sung line runs about two bars. At 1.2 beats the threshold merged three and
# four lines into one 6.3 s "phrase", which is a verse, not a phrase. Expressed
# in beats rather than seconds so it holds at any tempo.
PHRASE_GAP_BEATS = 0.8      # silence longer than this ends a phrase
PHRASE_GAP_FLOOR = 0.30     # ...but never call a shorter pause a phrase break
PHRASE_MIN_WORDS = 2


def period_of(m):
    grid = m.get("grid") or {}
    if grid.get("period"):
        return grid["period"]
    beats = m.get("beats") or []
    if len(beats) > 2:
        return statistics.median(beats[i + 1] - beats[i] for i in range(len(beats) - 1))
    return 0.5


def phrases_from_lyrics(m):
    lyr = (m.get("observations") or {}).get("lyrics") or {}
    words = [w for w in (lyr.get("words") or [])
             if isinstance(w, dict) and isinstance(w.get("at"), (int, float))]
    if len(words) < PHRASE_MIN_WORDS * 2:
        return None
    words.sort(key=lambda w: w["at"])
    gap = max(PHRASE_GAP_FLOOR, period_of(m) * PHRASE_GAP_BEATS)

    runs, cur = [], [words[0]]
    for w in words[1:]:
        prev = cur[-1]
        end = prev.get("to") if isinstance(prev.get("to"), (int, float)) else prev["at"]
        if w["at"] - max(end, prev["at"]) > gap:
            runs.append(cur); cur = [w]
        else:
            cur.append(w)
    runs.append(cur)

    out = []
    for r in runs:
        if len(r) < PHRASE_MIN_WORDS:
            continue
        last = r[-1]
        end = last.get("to") if isinstance(last.get("to"), (int, float)) else last["at"]
        end = max(end, last["at"] + 0.15)
        out.append({"at": round(r[0]["at"], 3), "to": round(end, 3), "words": len(r)})
    if not out:
        return None
    lens = [p["to"] - p["at"] for p in out]
    return {
        "from": "observations.lyrics.words",
        "how": ("runs of words separated by more than %.2f s of silence "
                "(%.1f beats at this tempo, floored at %.2f s)"
                % (gap, PHRASE_GAP_BEATS, PHRASE_GAP_FLOOR)),
        "not": ("this is where the voice is, not what it says. The word text is "
                "the unreliable half of the source and none of it is used here"),
        "count": len(out),
        "median_s": round(statistics.median(lens), 2),
        "events": out,
    }


PHRASE_BAR_CANDIDATES = (2, 4, 8, 16)


def phrase_grid(m):
    """Where the song turns over, measured rather than assumed.

    chapters name a handful of sections -- 11 across 220 s on Don't Look Down --
    but the novelty peaks in that same map sit 7.5 s apart, which at its tempo is
    four bars. A show whose looks change only on chapter boundaries is holding
    one look for thirty seconds through a song that turns over every eight, and
    that is what "why is this showing up now?" feels like from the audience.

    Four bars is the pop and dance default, and defaults are exactly what rule 2
    forbids writing down as if measured. So every candidate length and every
    offset is scored against the novelty peaks the map already carries, and the
    winner is emitted with the fraction of peaks that support it. A grid nothing
    supports is not written at all.
    """
    downs = m.get("downbeats") or []
    if len(downs) < 8:
        return None
    nv = (m.get("observations") or {}).get("novelty") or {}
    at, val = nv.get("at") or [], nv.get("value") or []
    if len(at) < 6 or len(val) != len(at):
        return None
    top = max(val) or 1.0
    peaks = [at[i] for i in range(1, len(val) - 1)
             if val[i] >= val[i - 1] and val[i] > val[i + 1] and val[i] >= 0.55 * top]
    if len(peaks) < 4:
        return None

    per = (m.get("grid") or {}).get("period") or 0.5
    tol = per * 1.0                      # within a beat is the same boundary
    best = None
    for bars in PHRASE_BAR_CANDIDATES:
        if len(downs) < bars * 2:
            continue
        for off in range(bars):
            marks = downs[off::bars]
            if len(marks) < 3:
                continue
            hit = 0
            for x in peaks:
                lo, hi = 0, len(marks) - 1
                near = None
                while lo <= hi:
                    mid = (lo + hi) // 2
                    d = marks[mid] - x
                    if near is None or abs(d) < abs(near):
                        near = d
                    if d < 0: lo = mid + 1
                    else:     hi = mid - 1
                if near is not None and abs(near) <= tol:
                    hit += 1
            support = hit / len(peaks)
            # A 2-bar grid has four times the marks of an 8-bar one, so it
            # catches four times as many peaks by pure luck. Scoring raw support
            # picks the shortest grid every time. What matters is how far above
            # chance it is: with a tolerance of one beat either side, a random
            # peak lands on a mark 2*tol/(bars*beats_per_bar*period) of the time.
            chance = min(0.99, 2.0 * tol / (bars * 4 * per))
            score = (support - chance) / (1.0 - chance)
            if best is None or score > best[0]:
                best = (score, bars, off, support, marks, chance)
    if best is None or best[0] < 0.35:
        return None
    lift, bars, off, support, marks, chance = best
    return {
        "from": "downbeats + observations.novelty",
        "how": ("every phrase length in %s bars and every offset scored against "
                "the novelty peaks; the best-supported one wins" % (list(PHRASE_BAR_CANDIDATES),)),
        "not": ("this is the FINEST boundary grid the music supports, not the "
                "phrase length a musician would name. A 2-bar grid contains "
                "every 4-bar mark, so support can only rise as the grid gets "
                "finer, and scoring against chance narrows that bias without "
                "removing it. Read it as: the song offers a boundary here this "
                "often. Four bars is the pop default and a default written down "
                "is indistinguishable from a measurement, which is why nothing "
                "is assumed and a grid beating chance by less than 0.35 is not "
                "written at all"),
        "bars": bars,
        "offset_bars": off,
        "support": round(support, 3),
        "expected_by_chance": round(chance, 3),
        "above_chance": round(lift, 3),
        "count": len(marks),
        "at": [round(x, 3) for x in marks],
    }


DERIVED = (("phrases", phrases_from_lyrics), ("phrase_grid", phrase_grid))

if __name__ == "__main__":
    paths = sys.argv[1:]
    if not paths:
        print(__doc__); raise SystemExit(2)
    for p in paths:
        m = json.load(open(p))
        obs = m.setdefault("observations", {})
        wrote = []
        for name, fn in DERIVED:
            if obs.get(name):
                wrote.append("%s already present" % name); continue
            got = fn(m)
            if got is None:
                wrote.append("%s not derivable" % name); continue
            obs[name] = got
            if "median_s" in got:
                wrote.append("%s %d (median %.2fs)" % (name, got["count"], got["median_s"]))
            elif "bars" in got:
                wrote.append("%s %d bars, offset %d, support %.0f%% (%d marks)"
                             % (name, got["bars"], got["offset_bars"],
                                100 * got["support"], got["count"]))
            else:
                wrote.append("%s %d" % (name, got.get("count", 0)))
        json.dump(m, open(p, "w"), indent=1); open(p, "a").write("\n")
        print("  %-26s %s" % (os.path.basename(p), "; ".join(wrote)))
