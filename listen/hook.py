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
import sys, os, json, re, math, unicodedata

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mapio import map_path, work_dir

MIN_WORDS, MAX_WORDS = 3, 8
MIN_GAP_S = 4.0
PUNCT_CATS = ("P", "S", "Z", "C")


def token(raw):
    r"""One transcript word, normalised, in any script.

    This was re.findall(r"[a-z0-9']+") taking the first match. On Latin text
    that is the word; on Malayalam it matched nothing at all, so a correct
    transcript looked like zero words and fell through to the rhythmic
    fallback. Widening it to \w does not fix it either: Python's \w follows
    str.isalnum(), which is False for the combining vowel signs Malayalam is
    written with, so every word split into single consonants.

    Splitting on whitespace and dropping punctuation and symbols keeps letters
    and their marks together, which is what a word is in every script here."""
    out = "".join(c for c in raw.strip().lower()
                  if not unicodedata.category(c).startswith(PUNCT_CATS))
    return out or None


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
            k = token(w.get("word") or "")
            if t is None or not k:
                continue
            out.append((float(t), k))
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


def rhythmic_hook(m):
    """The hook found by its rhythm, for a vocal no transcriber can read.

    Onsets on the separated vocal, quantised to eighths of a bar from each bar
    line, and the figure whose quantised onset set recurs most -- occurrences at
    least MIN_GAP_S apart, agreement by Jaccard, weighted by how many onsets the
    figure holds and by the energy where it lands. Windows of one, two and four
    bars are tried and the heaviest wins."""
    downs = m.get("downbeats") or []
    if len(downs) < 8:
        return None
    bar = (downs[-1] - downs[0]) / max(1, len(downs) - 1)
    ons = sorted(e["at"] for e in (((m.get("accents") or {}).get("events")) or [])
                 if e.get("of") == "vocals" and e.get("at") is not None)
    if len(ons) < 24:
        return None
    best = None
    for W in (1, 2, 4):
        sigs = []
        for k in range(len(downs) - W):
            t0 = downs[k]
            cells = frozenset(int(round(8 * (t - t0) / bar))
                              for t in ons if t0 - 0.02 <= t < t0 + W * bar)
            if len(cells) >= 3:
                sigs.append((k, cells))
        for k, sg in sigs:
            grp = [k]
            for k2, s2 in sigs:
                if k2 <= k:
                    continue
                if downs[k2] - downs[grp[-1]] < MIN_GAP_S:
                    continue
                if len(sg & s2) / max(1, len(sg | s2)) >= 0.7:
                    grp.append(k2)
            if len(grp) < 2:
                continue
            es = [energy_at(m, downs[q]) for q in grp]
            mean_e = sum(es) / len(es)
            # count x onset DENSITY x energy. Multiplying by the raw onset count
            # rewards long windows for holding more onsets, and picked a 4-bar
            # figure occurring twice over a 1-bar figure occurring six times on
            # mizhiyoram. A hook is short and frequent.
            w = len(grp) * (len(sg) / W) * mean_e
            if best is None or w > best["weight"]:
                best = {"phrase": None, "times": [round(downs[q], 3) for q in grp],
                        "count": len(grp), "span_bars": W,
                        "span_s": round(W * bar, 3), "onsets_in_figure": len(sg),
                        "mean_energy": round(mean_e, 4), "weight": round(w, 4)}
    return best


def analyse(slug, write=False):
    mp = map_path(slug)
    if not mp:
        return {"error": "no map"}
    ws = words_of(slug)
    if ws is None:
        # No transcript at all is the same situation as an unusable one: fall
        # through to the rhythmic search rather than refusing to answer.
        ws = []
    m = json.load(open(mp))
    if len(ws) < 12:
        # Transcription failed. The hook is still findable, because the check
        # for a hook is rhythmic repetition and rhythm is language-independent:
        # run that search as the WRITER and emit the figure as a time span with
        # no text. What it costs is stated in the field -- rhythm found it, so
        # rhythm cannot then corroborate it, and mapeval.ev_hook checks a
        # rhythm-found hook against chord-sequence repetition instead.
        r = rhythmic_hook(m)
        if r is None:
            m.setdefault("observations", {})["hook"] = {
                "value": None,
                "provenance": "unmeasured",
                "why_null": "the transcriber returned %d usable words%s, and no vocal figure "
                            "repeats often enough to stand in for a phrase."
                            % (len(ws), "" if os.path.exists(
                                os.path.join(lyrics_dir(), slug + ".json"))
                               else " (there is no transcript for this song at all)"),
                "model": "openai-whisper small, on the separated vocal stem",
            }
        else:
            r.update({
                "rate": "per_song",
                "found_by": "rhythmic repetition",
                "how": "the transcriber returned %d usable words on this recording, so the "
                       "phrase was found by its rhythm instead: onsets on the separated vocal "
                       "quantised to eighths of a bar, and the figure whose quantised onset "
                       "set recurs most, weighted by how many onsets it holds and the energy "
                       "where it lands" % len(ws),
                "why_no_text": "Whisper reported English on a recording that is not in "
                               "English and returned nothing usable; with Malayalam given "
                               "explicitly it returned zero segments, and on the raw mix it "
                               "returned invented text mixing Korean and Chinese glyphs. A "
                               "hook read out of that would be a fabricated number, so the "
                               "phrase is emitted as a time span with no words rather than "
                               "with wrong ones.",
                "costs": "rhythm found this, so rhythm cannot corroborate it. mapeval.ev_hook "
                         "checks a rhythm-found hook against chord-sequence repetition, which "
                         "shares neither the tool nor the feature family.",
                "provenance": "measured",
                "model": "onset detection on the separated vocal stem",
            })
            m.setdefault("observations", {})["hook"] = r
        if write:
            json.dump(m, open(mp, "w"), indent=1, ensure_ascii=False)
            open(mp, "a").write("\n")
        return {"slug": slug, "rhythmic": r is not None,
                "error": None if r else "no repeated vocal figure either",
                "n": 0, "top": [], "wrote": write}

    seen = {}
    for n in range(MIN_WORDS, MAX_WORDS + 1):
        for i in range(len(ws) - n + 1):
            phrase = " ".join(w for _, w in ws[i:i + n])
            seen.setdefault(phrase, []).append(ws[i][0])

    cands = {}
    for phrase, times in seen.items():
        keep = []
        for t in sorted(times):
            if not keep or t - keep[-1] >= MIN_GAP_S:
                keep.append(t)
        if len(keep) < 2:
            continue
        es = [energy_at(m, t) for t in keep]
        mean_e = sum(es) / len(es)
        cands[phrase] = {
            "phrase": phrase,
            "times": [round(t, 3) for t in keep],
            "count": len(keep),
            "words": len(phrase.split()),
            "mean_energy": round(mean_e, 4),
            "weight": round(len(keep) * mean_e, 4),
        }
    if not cands:
        return {"error": "no phrase of %d-%d words repeats more than %.0f s apart"
                         % (MIN_WORDS, MAX_WORDS, MIN_GAP_S)}

    # How often it comes round, weighted by the energy where it lands -- a line
    # repeated three times in the intro is not the hook and the same line over
    # the drop is. Length is NOT a factor, and it used to be: multiplying by
    # word count preferred a six-word couplet occurring twice over the
    # three-word line occurring three times, and on dont-look-down it chose
    # "oh oh oh oh oh oh oh oh" over "dont look down".
    best = max(cands.values(), key=lambda c: (c["weight"], c["words"]))

    # Then grow it. Dropping length entirely leaves near-identical phrases
    # competing on a rounding-level energy difference, and The Nights then
    # chose "father told me" over "my father told me" -- one word shorter,
    # which shifts every occurrence time and destroys the alignment the check
    # reads. The hook is the LONGEST phrase that recurs this often.
    grown = True
    while grown:
        grown = False
        for phrase, c in cands.items():
            if (c["count"] == best["count"] and c["words"] > best["words"]
                    and best["phrase"] in phrase):
                best, grown = c, True
                break

    top = [best]
    for c in sorted(cands.values(), key=lambda c: -c["weight"]):
        if c["phrase"] in best["phrase"] or best["phrase"] in c["phrase"]:
            continue
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
        "how_chosen": "how often it comes round, weighted by the energy where it lands, then "
                      "grown to the longest phrase that still recurs that often",
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
