#!/usr/bin/env python3
"""The line the room sings back, and when it comes round.

    $LIMELIGHT_PY_AUDIO listen/hook.py [slug ...] [--write]

`sections` says the chorus is at 61 s. It does not say which four seconds of it
everybody in the room already knows, and those are not the same thing -- the
hook is usually a phrase inside the chorus, and it usually lands in other
sections too.

Whisper transcribes the isolated vocal stem with word timestamps. Every phrase
of three to eight words that occurs more than once, with its occurrences at
least four seconds apart, is a candidate. Each is weighted by the energy where
it lands, because a line repeated three times in the intro is not the hook and
the same line over the drop is.

Checked in mapeval.ev_hook against melodic contour repetition: if a phrase is
the hook, the tune it is sung to should be the same tune each time. The two
sides run on the same separated vocal -- which is a shared input and is said
here rather than hidden -- but one is a speech model reading words and the
other is a polyphonic pitch tracker reading notes, and a phrase that recurs as
TEXT without recurring as CONTOUR is a phrase, not a hook.
"""
import sys, os, json, re, math

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mapio import map_path, work_dir

MIN_WORDS, MAX_WORDS = 3, 8
MIN_GAP_S = 4.0
WORD = re.compile(r"[a-z0-9']+")


def lyrics_dir():
    return os.environ.get("LIMELIGHT_LYRICS", os.path.join(work_dir(), "lyrics"))


def words_of(slug):
    p = os.path.join(lyrics_dir(), slug + ".json")
    if not os.path.exists(p):
        return None
    d = json.load(open(p))
    out = []
    for seg in d.get("segments") or []:
        for w in seg.get("words") or []:
            t = w.get("start")
            k = WORD.findall((w.get("word") or "").lower())
            if t is None or not k:
                continue
            out.append((float(t), k[0]))
    out.sort()
    return out


def energy_at(m, t):
    en = m.get("energy") or []
    if not en:
        return 0.5
    best, bv = None, 1e9
    for a, v in en:
        d = abs(a - t)
        if d < bv:
            bv, best = d, v
    return best if best is not None else 0.5


def analyse(slug, write=False):
    mp = map_path(slug)
    if not mp:
        return {"error": "no map"}
    ws = words_of(slug)
    if ws is None:
        return {"error": "no transcript at %s -- run whisper on the vocal stem" % lyrics_dir()}
    m = json.load(open(mp))
    if len(ws) < 12:
        m.setdefault("observations", {})["hook"] = {
            "value": None,
            "provenance": "unmeasured",
            "why_null": "the transcriber returned %d usable words from this vocal. Whisper "
                        "was run with automatic language detection and reported English; "
                        "this recording is not in English, and a transcript of the wrong "
                        "language cannot be searched for a repeated phrase." % len(ws),
            "what_would_settle_it": "run the transcriber with the language given rather than "
                                    "detected. The hook is audible and repeated in this song; "
                                    "the tool was pointed at the wrong language, which is a "
                                    "fixable mistake and not a property of the record.",
            "model": "openai-whisper small, on the separated vocal stem",
        }
        if write:
            json.dump(m, open(mp, "w"), indent=1, ensure_ascii=False)
            open(mp, "a").write("\n")
        return {"error": "only %d words transcribed -- written as a labelled null" % len(ws)}

    seen = {}
    for n in range(MIN_WORDS, MAX_WORDS + 1):
        for i in range(len(ws) - n + 1):
            phrase = " ".join(w for _, w in ws[i:i + n])
            seen.setdefault(phrase, []).append(ws[i][0])

    cands = []
    for phrase, times in seen.items():
        keep = []
        for t in sorted(times):
            if not keep or t - keep[-1] >= MIN_GAP_S:
                keep.append(t)
        if len(keep) < 2:
            continue
        es = [energy_at(m, t) for t in keep]
        mean_e = sum(es) / len(es)
        nwords = len(phrase.split())
        cands.append({
            "phrase": phrase,
            "times": [round(t, 3) for t in keep],
            "count": len(keep),
            "words": nwords,
            "mean_energy": round(mean_e, 4),
            "weight": round(len(keep) * nwords * mean_e, 4),
        })
    if not cands:
        return {"error": "no phrase of %d-%d words repeats more than %.0f s apart"
                         % (MIN_WORDS, MAX_WORDS, MIN_GAP_S)}
    cands.sort(key=lambda c: -c["weight"])
    # drop candidates that are a sub-phrase of a better one at the same times
    top, used = [], []
    for c in cands:
        # a sub-phrase of something already kept is the same hook, said shorter
        if any(c["phrase"] in t["phrase"] for t in top):
            continue
        top.append(c)
        if len(top) >= 5:
            break

    m.setdefault("observations", {})["hook"] = {
        "rate": "per_song",
        "how": "phrases of %d to %d words that recur at least %.0f s apart in the Whisper "
               "transcript of the separated vocal, weighted by count, length and the energy "
               "where they land" % (MIN_WORDS, MAX_WORDS, MIN_GAP_S),
        "why_it_exists": "sections says where the chorus is. It does not say which four "
                         "seconds of it the room already knows, and the hook usually lands "
                         "outside the chorus too.",
        "not": "not the most frequent phrase. A line repeated three times in the intro is not "
               "the hook and the same line over the drop is, which is what the energy weight "
               "is for.",
        "model": "openai-whisper small, word timestamps, on the separated vocal stem",
        "provenance": "measured",
        "checked_against": "melodic contour repetition in mapeval.ev_hook. Same separated "
                           "vocal on both sides -- a shared input, said rather than hidden -- "
                           "but one side is a speech model reading words and the other a "
                           "pitch tracker reading notes.",
        "hook": top[0],
        "runners_up": top[1:],
        "candidates_considered": len(cands),
    }
    if write:
        json.dump(m, open(mp, "w"), indent=1, ensure_ascii=False)
        open(mp, "a").write("\n")
    return {"slug": slug, "top": top[:3], "n": len(cands), "wrote": write}


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    write = "--write" in sys.argv
    for slug in args or ["levels", "starlight", "mizhiyoram", "dont-look-down", "the-nights"]:
        r = analyse(slug, write)
        if "error" in r:
            print("  %-16s %s" % (slug, r["error"]))
            continue
        print("  %-16s %d candidates%s" % (slug, r["n"], "  -> written" if write else ""))
        for c in r["top"]:
            print("     x%d  e=%.2f  w=%5.1f  %r at %s"
                  % (c["count"], c["mean_energy"], c["weight"], c["phrase"],
                     ", ".join("%.0f" % t for t in c["times"][:6])))
