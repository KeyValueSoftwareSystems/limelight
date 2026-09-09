#!/usr/bin/env python3
"""For every bar: which earlier bar is this the same material as?

    python3 listen/identity.py [slug ...] [--write]

`sections` says a passage is called "drop" and that this is its second
appearance. It does not say that bar 97 is the same music as bar 33, and that
is the question a reader actually has when it wants to answer a repeat the way
it answered the first time -- or deliberately not.

The vectors in the sidecar are one 768-dimensional row per beat from MERT. This
pools them to a bar, L2-normalises, and for each bar finds the earlier bar it is
closest to. A bar whose best match is weak points at nothing rather than at
whatever happened to be nearest: `same_as` is null and the bar is new material.

Nothing here reads `sections`, `chapters` or `energy`. It reads the sidecar and
the bar lines, and that is all -- so a reader can compare what this says against
what `sections` says and find them disagreeing, which is information rather
than a bug.

Checked in mapeval.ev_identity against chord-sequence repetition: if bar 97 is
the same material as bar 33, the chords over bar 97 should be the chords over
bar 33. One side is a learned embedding of the audio, the other is a symbolic
chord label from a different model. They share the recording and nothing else,
and either can be right when they disagree -- a section repeated with the same
chords over a different arrangement will separate them, which is exactly the
case worth knowing about.
"""
import sys, os, json, math, struct

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mapio import map_path

# A fixed similarity threshold is meaningless here: every bar of one song sits
# close to every other in this embedding, and 0.55 matched 125 of Levels' 127
# bars to something. The threshold is calibrated per song instead, against the
# distribution of similarity between all pairs of bars in that song -- a bar is
# "the same material as" an earlier one only if it is closer than all but a few
# percent of pairs are to each other by default.
NULL_PCT = 0.975
MIN_GAP_BARS = 2        # the bar before is always similar; that is not a repeat


def load_vectors(m, mp):
    v = m.get("vectors") or {}
    f = v.get("file")
    if not f:
        return None, "no vectors sidecar"
    p = os.path.join(os.path.dirname(mp), f)
    if not os.path.exists(p):
        return None, "sidecar %s is not on disk" % f
    rows, dim = v.get("rows"), v.get("dim")
    if not rows or not dim:
        return None, "sidecar reference has no shape"
    raw = open(p, "rb").read()
    if len(raw) != rows * dim * 2:
        return None, "sidecar is %d bytes, not %d x %d x 2" % (len(raw), rows, dim)
    # float16: struct knows "e", array does not
    a = struct.unpack("<%de" % (rows * dim), raw)
    return [a[i * dim:(i + 1) * dim] for i in range(rows)], None


def analyse(slug, write=False):
    mp = map_path(slug)
    if not mp:
        return {"error": "no map"}
    m = json.load(open(mp))
    V, err = load_vectors(m, mp)
    if V is None:
        return {"error": err}
    beats = m.get("beats") or []
    downs = m.get("downbeats") or []
    if len(downs) < 8 or len(beats) < 16:
        return {"error": "needs beats and at least 8 bar lines"}

    # pool the per-beat rows into per-bar rows
    bars = []
    for k in range(len(downs)):
        a = downs[k]
        b = downs[k + 1] if k + 1 < len(downs) else beats[-1] + 1e-6
        idx = [i for i, t in enumerate(beats) if a - 1e-6 <= t < b and i < len(V)]
        if not idx:
            bars.append(None)
            continue
        dim = len(V[idx[0]])
        acc = [0.0] * dim
        for i in idx:
            r = V[i]
            for d in range(dim):
                acc[d] += r[d]
        n = math.sqrt(sum(x * x for x in acc)) or 1.0
        bars.append([x / n for x in acc])

    ok = [k for k, v in enumerate(bars) if v is not None]
    if len(ok) < 8:
        return {"error": "too few bars carry vectors"}

    # the song's own null: how alike are two bars of this record in general?
    null = []
    for ai in range(len(ok)):
        for bi in range(ai + MIN_GAP_BARS, len(ok)):
            x, y = bars[ok[ai]], bars[ok[bi]]
            null.append(sum(x[d] * y[d] for d in range(len(x))))
    null.sort()
    thr = null[int(NULL_PCT * (len(null) - 1))]
    med = null[len(null) // 2]

    entries, matched = [], 0
    for k in ok:
        best, bestv = None, -2.0
        for j in ok:
            if j > k - MIN_GAP_BARS:
                break
            s = sum(bars[k][d] * bars[j][d] for d in range(len(bars[k])))
            if s > bestv:
                bestv, best = s, j
        row = {"bar": k, "at": round(downs[k], 6)}
        if best is not None and bestv >= thr:
            row["same_as"] = best
            row["same_as_at"] = round(downs[best], 6)
            row["similarity"] = round(bestv, 4)
            matched += 1
        else:
            row["same_as"] = None
            row["similarity"] = round(bestv, 4) if best is not None else None
            row["why"] = ("nothing earlier reaches %.3f, this song's own %d%% pair "
                          "similarity; this bar is new material" % (thr, 100 * NULL_PCT))
        entries.append(row)

    # ---- surprise, from the same rows, because they cannot carry loudness ----
    # The old surprise predicted a bar from "how many hits it has on each
    # instrument, its six stem levels and its energy" -- two of those three are
    # levels, and it showed: correlation with the bar's own loudness came out
    # -0.47, -0.52, -0.13, -0.52, -0.49 on the five songs. A quiet bar after
    # loud ones was being called surprising for being quiet.
    #
    # MERT rows are L2-normalised, so the scale is already divided out. A bar is
    # predicted as the mean of the four before it and the surprise is the cosine
    # distance from that prediction. The correlation with loudness is measured
    # and written into the field, and mapeval refuses the field if it is high.
    LOOK = 4
    sur_at, sur_val = [], []
    for pos, k in enumerate(ok):
        prev = [bars[j] for j in ok[max(0, pos - LOOK):pos]]
        if len(prev) < LOOK:
            continue
        dim = len(bars[k])
        acc = [sum(p[d] for p in prev) / len(prev) for d in range(dim)]
        nn = math.sqrt(sum(x * x for x in acc)) or 1.0
        acc = [x / nn for x in acc]
        sur_at.append(round(downs[k], 6))
        sur_val.append(1.0 - sum(bars[k][d] * acc[d] for d in range(dim)))
    if sur_val:
        lo, hi = min(sur_val), max(sur_val)
        rng_ = (hi - lo) or 1.0
        sur_val = [round((v - lo) / rng_, 4) for v in sur_val]

    m.setdefault("observations", {})["identity"] = {
        "rate": "per_downbeat",
        "unit": "the index of the earlier bar this one is the same material as, or null",
        "how": "MERT rows pooled per bar and L2-normalised, then the nearest earlier bar by "
               "cosine. The bar must beat this song's own %d%% pair similarity (%.3f here, "
               "against a median of %.3f), and sit at least %d bars back so the previous bar "
               "does not count as a repeat." % (100 * NULL_PCT, thr, med, MIN_GAP_BARS),
        "threshold": round(thr, 4),
        "median_pair_similarity": round(med, 4),
        "why_not_a_fixed_threshold": "every bar of one song sits close to every other in this "
                                     "embedding. A fixed 0.55 matched 125 of Levels' 127 bars "
                                     "to something, which is not a measurement of anything.",
        "why_it_exists": "sections says a passage is the second 'drop'. It does not say bar 97 "
                         "is the same music as bar 33, which is what a reader needs to answer "
                         "a repeat the way it answered the first time, or deliberately not.",
        "not": "not a claim that the two bars are identical audio. It is that a model trained "
               "on a great deal of music puts them in the same place, which is closer to what "
               "a listener means by 'this bit again' than a waveform comparison would be.",
        "source": m.get("vectors", {}).get("file"),
        "model": m.get("vectors", {}).get("model"),
        "revision": m.get("vectors", {}).get("revision"),
        "provenance": "measured",
        "reads_nothing_else": "not sections, not chapters, not energy. If this and sections "
                              "disagree, both were arrived at independently.",
        "checked_against": "chord-sequence repetition, in mapeval.ev_identity -- a symbolic "
                           "label from a different model, sharing the recording and no code",
        "bars_matched": matched,
        "bars_new": len(entries) - matched,
        "entries": entries,
    }
    if sur_val:
        m["observations"]["surprise"] = {
            "rate": "per_downbeat",
            "unit": "0-1, 1 = the biggest departure in this song",
            "how": "each bar's MERT row, pooled and L2-normalised, against the mean of the "
                   "four bars before it; the surprise is the cosine distance. The rows are "
                   "unit vectors, so the loudness of the bar is divided out before anything "
                   "is compared.",
            "why_it_exists": "a reader that only knows what is loud answers a drop and misses "
                             "the moment a record does something it has not done before, "
                             "which is often quiet.",
            "not_from_loudness": "deliberately. The previous version of this field predicted "
                                 "a bar from its hit counts, its six stem LEVELS and its "
                                 "energy, and correlated -0.47 to -0.52 with the bar's own "
                                 "loudness across the five songs -- a quiet bar after loud "
                                 "ones was being called surprising for being quiet. mapeval "
                                 "now refuses this field if that correlation returns.",
            "not": "not a claim that a listener is surprised. It is that a model trained on a "
                   "lot of music did not see this bar coming from the four before it.",
            "source": m.get("vectors", {}).get("file"),
            "model": m.get("vectors", {}).get("model"),
            "provenance": "measured",
            "checked_against": "its own correlation with loudness, in mapeval.ev_surprise, "
                               "which is an upper bound rather than a target",
            "at": sur_at,
            "value": sur_val,
        }
    if write:
        json.dump(m, open(mp, "w"), indent=1, ensure_ascii=False)
        open(mp, "a").write("\n")
    return {"slug": slug, "bars": len(entries), "matched": matched,
            "surprise": len(sur_val), "wrote": write}


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    write = "--write" in sys.argv
    for slug in args or ["levels", "starlight", "mizhiyoram", "dont-look-down", "the-nights"]:
        r = analyse(slug, write)
        if "error" in r:
            print("  %-16s %s" % (slug, r["error"]))
            continue
        print("  %-16s %3d bars, %3d point at an earlier bar, %3d are new material%s"
              % (slug, r["bars"], r["matched"], r["bars"] - r["matched"],
                 "  -> written" if write else ""))
