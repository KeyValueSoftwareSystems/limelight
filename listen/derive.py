#!/usr/bin/env python3
"""Fields that follow from fields already measured. Stdlib, no audio.

    python3 listen/derive.py maps/model/*.map.json

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


DERIVED = (("phrases", phrases_from_lyrics),)

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
            wrote.append("%s %d (median %.2fs)" % (name, got["count"], got["median_s"]))
        json.dump(m, open(p, "w"), indent=1); open(p, "a").write("\n")
        print("  %-26s %s" % (os.path.basename(p), "; ".join(wrote)))
