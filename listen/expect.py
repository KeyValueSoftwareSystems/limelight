import sys, os, json, math, bisect

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mapio import map_path

KINDS = ("kick", "snare", "hat", "bass", "vocals", "guitar", "piano", "other")
LOOKBACK = 4


def bars_of(m):
    db = m.get("downbeats") or []
    if len(db) >= 4:
        return db
    beats = m.get("beats") or []
    bp = (m.get("grid") or {}).get("bar_phase") or 0
    return beats[bp::4]


def bar_features(m, bars):
    ev = ((m.get("accents") or {}).get("events")) or []
    stems = ((m.get("stems") or {}).get("sources")) or {}
    en = m.get("energy") or []
    feats = []
    ends = bars[1:] + [bars[-1] + (bars[-1] - bars[-2] if len(bars) > 1 else 2.0)]
    ev_by_t = sorted((e["at"], e.get("of")) for e in ev)
    times = [t for t, _ in ev_by_t]
    en_at = (
        [r[0] if isinstance(r, (list, tuple)) else r.get("at") for r in en]
        if en
        else []
    )
    en_v = (
        [r[1] if isinstance(r, (list, tuple)) else r.get("value") for r in en]
        if en
        else []
    )
    for i, (a, b) in enumerate(zip(bars, ends)):
        lo, hi = bisect.bisect_left(times, a), bisect.bisect_left(times, b)
        counts = dict.fromkeys(KINDS, 0.0)
        for _, of in ev_by_t[lo:hi]:
            if of in counts:
                counts[of] += 1.0
        v = [counts[k] for k in KINDS]
        for name in ("vocals", "drums", "bass", "guitar", "piano", "other"):
            seq = stems.get(name) or []
            v.append(float(seq[i]) if i < len(seq) else 0.0)
        if en_at:
            j = bisect.bisect_left(en_at, a)
            j = min(max(j, 0), len(en_v) - 1)
            v.append(float(en_v[j] or 0.0))
        else:
            v.append(0.0)
        feats.append(v)
    return feats


def _norm(v):
    n = math.sqrt(sum(x * x for x in v))
    return [x / n for x in v] if n > 1e-9 else None


def surprise(m, bars, feats):
    if len(feats) < LOOKBACK + 4:
        return None
    raw = []
    for i in range(len(feats)):
        if i < LOOKBACK:
            raw.append(None)
            continue
        prev = feats[i - LOOKBACK : i]
        pred = [sum(col) / len(col) for col in zip(*prev)]
        a, b = _norm(feats[i]), _norm(pred)
        raw.append(
            None if (a is None or b is None) else 1.0 - sum(x * y for x, y in zip(a, b))
        )
    got = [x for x in raw if x is not None]
    if not got:
        return None
    hi = max(got) or 1.0
    vals = [None if x is None else round(min(1.0, x / hi), 4) for x in raw]
    top = sorted(
        ((v, bars[i]) for i, v in enumerate(vals) if v is not None), reverse=True
    )[:8]
    return {
        "rate": "per_downbeat",
        "unit": "0-1, 1 = the biggest departure in this song",
        "how": "each bar is described by how many hits it has on each instrument, its six stem "
        "levels and its energy. That vector is predicted from the mean of the %d bars "
        "before it, and the surprise is the cosine distance between prediction and "
        "measurement." % LOOKBACK,
        "why_it_exists": "nothing else in this file says how EXPECTED a moment is, and a "
        "performance is built on expectation rather than on level. A bar that "
        "sounds exactly like the four before it needs nothing from a reader "
        "however loud it is; a bar that breaks the pattern is the whole point.",
        "not": "not novelty. novelty compares a bar to its neighbours in a learned embedding and "
        "finds boundaries. This asks whether the bar was PREDICTABLE from what came "
        "before, which is a different question and disagrees with novelty at the second "
        "and third repeat of a section -- by then it is no longer surprising.",
        "biggest_departures_s": [round(t, 3) for _, t in top],
        "at": [round(t, 3) for t in bars],
        "value": vals,
    }


def anticipation(m, bars):
    mo = [x for x in (m.get("moments") or []) if isinstance(x, dict) and "at" in x]
    if not mo or len(bars) < 4:
        return None
    per = (m.get("grid") or {}).get("period") or 0.5
    bar_s = per * 4
    mo = sorted(mo, key=lambda x: x["at"])
    ts = [x["at"] for x in mo]
    spans = [
        s
        for s in (m.get("spans") or [])
        if isinstance(s, dict) and "from" in s and "to" in s
    ]
    rows = []
    for t in bars:
        j = bisect.bisect_left(ts, t + 1e-6)
        nxt = mo[j] if j < len(mo) else None
        k = j - 1
        prv = mo[k] if k >= 0 else None
        inside = None
        for s in spans:
            if s["from"] - 1e-6 <= t < s["to"]:
                width = max(1e-6, s["to"] - s["from"])
                inside = {
                    "kind": s.get("kind"),
                    "through": round((t - s["from"]) / width, 3),
                }
                break
        rows.append(
            {
                "at": round(t, 3),
                "to_next": None if not nxt else round((nxt["at"] - t) / bar_s, 2),
                "next_kind": None if not nxt else nxt.get("kind"),
                "since_prev": None if not prv else round((t - prv["at"]) / bar_s, 2),
                "prev_kind": None if not prv else prv.get("kind"),
                "inside": inside,
            }
        )
    warned = [r for r in rows if r["next_kind"] == "drop" and r["inside"]]
    return {
        "rate": "per_downbeat",
        "unit": "bars",
        "how": "for every bar: how many bars to the next moment and what kind it is, how many "
        "since the last one, and whether this bar sits inside a declared rise and how "
        "far through it",
        "why_it_exists": "every other field in this file is retrospective -- it says what IS at a "
        "time, never what is COMING. A reader asked for a frame at t=18 cannot "
        "know a drop is 1.9 s away without walking `moments` itself, so every "
        "reader reimplements anticipation and they will not agree. A show is "
        "mostly anticipation: the ramp has to start before the event.",
        "derived_from": "moments and spans already in this file, so it adds no new measurement "
        "and cannot disagree with them",
        "bars_of_warning_before_a_drop": sorted({r["to_next"] for r in warned})[:6],
        "entries": rows,
    }


LABEL_STEM = {"kick": "drums", "snare": "drums", "hat": "drums", "bass": "bass",
              "vocals": "vocals", "guitar": "guitar", "piano": "piano", "other": "other"}


def absolute_gain(m):
    by = (((m.get("accents") or {}).get("stem_levels") or {}).get("by_label")) or {}
    out = {}
    for label, d in by.items():
        stem = LABEL_STEM.get(label)
        db = d.get("stem_level_db_re_mix")
        if stem and db is not None:
            out[stem] = max(out.get(stem, -999.0), float(db))
    return {k: 10.0 ** (v / 20.0) for k, v in out.items()}


def lead(m, bars):
    stems = ((m.get("stems") or {}).get("sources")) or {}
    gain = absolute_gain(m)
    names = [n for n in ("vocals", "drums", "bass", "guitar", "piano", "other")
             if stems.get(n) and n in gain]
    if len(names) < 3:
        return {"unavailable": "stems.sources is normalised per stem, so the six series cannot "
                               "be compared with each other. Rescaling needs each stem's true "
                               "level, which lives in accents.stem_levels and is not in this "
                               "file yet -- run listen/attack.py, which measures it.",
                "why_it_matters": "ranking the normalised series directly makes a silent stem "
                                  "win: a guitar 43 dB below the mix is still scaled to 1.0 at "
                                  "its own loudest bar, and Starlight read as piano-led for 43 "
                                  "bars on that artefact."}
    abs_series, base, peak = {}, {}, {}
    for n in names:
        seq = [float(x) for x in stems[n]]
        mean = (sum(seq) / len(seq)) or 1e-9
        scale = gain[n] / mean
        a_seq = [x * scale for x in seq]
        abs_series[n] = a_seq
        srt = sorted(a_seq)
        base[n] = srt[len(srt) // 2] or 1e-9
        peak[n] = srt[min(len(srt) - 1, int(0.90 * len(srt)))]
    loudest = max(peak.values()) or 1e-9
    excluded = {}
    for n in list(names):
        if peak[n] < loudest * 0.12:
            excluded[n] = round(20 * math.log10(max(peak[n], 1e-9) / loudest), 1)
            names.remove(n)
    if len(names) < 2:
        return None
    rows, counts = [], {}
    for i, t in enumerate(bars):
        best, second = None, None
        for n in names:
            seq = abs_series[n]
            if i >= len(seq):
                continue
            rel = seq[i] / base[n]
            if best is None or rel > best[0]:
                second, best = best, (rel, n)
            elif second is None or rel > second[0]:
                second = (rel, n)
        if not best:
            continue
        counts[best[1]] = counts.get(best[1], 0) + 1
        rows.append({"at": round(t, 3), "of": best[1],
                     "above_its_own_normal": round(best[0], 3),
                     "margin_over_next": round(best[0] - (second[0] if second else 0.0), 3)})
    if not rows:
        return None
    return {
        "rate": "per_downbeat",
        "how": "stems.sources is normalised per stem, so each series is first rescaled by that "
               "stem's true level from accents.stem_levels to make the six comparable. Then a "
               "bar's leader is the stem furthest above its OWN median, so a quiet instrument "
               "stepping forward counts and the drums do not win every bar for being loud.",
        "why_it_exists": "the file says how loud each stem is per bar but never which one is "
                         "CARRYING the song. That is what a reader needs to decide where to "
                         "point, and it is the difference between a show that follows the music "
                         "and one that only pulses with it.",
        "the_trap_here": "ranking the normalised series directly is meaningless: every stem is "
                         "scaled to 1.0 at its own loudest bar, so a guitar 43 dB down ties with "
                         "the drums. Starlight read as piano-led for 43 bars that way, from a "
                         "stem 20 dB below the mix. A median-based presence gate then cut the "
                         "vocal hook out of Levels, because a chopped sample is silent most of "
                         "the record and intermittent is not absent.",
        "not": "not the melody and not a solo detector. It is which source is furthest above its "
               "own habit, which is usually but not always what a listener is following.",
        "bars_led_by": dict(sorted(counts.items(), key=lambda kv: -kv[1])),
        "excluded_as_not_present_db": excluded,
        "entries": rows,
    }


def arc(m, bars, feats):
    en = m.get("energy") or []
    if len(en) < 8:
        return None
    vals = [
        (r[0], r[1]) if isinstance(r, (list, tuple)) else (r.get("at"), r.get("value"))
        for r in en
    ]
    vals = [(t, v) for t, v in vals if t is not None and v is not None]
    if len(vals) < 8:
        return None
    dur = (m.get("song") or {}).get("length") or vals[-1][0]
    peak_t, peak_v = max(vals, key=lambda p: p[1])
    fifths = [[] for _ in range(5)]
    for t, v in vals:
        fifths[min(4, int(5 * t / max(1e-6, dur)))].append(v)
    shape = [round(sum(f) / len(f), 4) if f else None for f in fifths]
    quiet_t, quiet_v = min(vals, key=lambda p: p[1])
    return {
        "rate": "per_song",
        "how": "the energy curve already in this file, reduced to where it peaks and its mean "
        "over each fifth of the record",
        "why_it_exists": "a reader can see the next bar but not the whole. Without knowing the "
        "climax is at 0.81 of the way through, it cannot hold anything back for "
        "it, and a show that spends everything in the first drop has nowhere "
        "left to go.",
        "peak_at_s": round(peak_t, 3),
        "peak_at_fraction": round(peak_t / max(1e-6, dur), 4),
        "quietest_at_s": round(quiet_t, 3),
        "quietest_at_fraction": round(quiet_t / max(1e-6, dur), 4),
        "range": round(peak_v - quiet_v, 4),
        "mean_by_fifth": shape,
    }


def analyse(slug, write=False):
    p = map_path(slug)
    if not p:
        return {"error": "no map"}
    m = json.load(open(p))
    bars = bars_of(m)
    if len(bars) < 8:
        return {"error": "no bars"}
    feats = bar_features(m, bars)
    out = {}
    for name, fn in (
        ("surprise", lambda: surprise(m, bars, feats)),
        ("anticipation", lambda: anticipation(m, bars)),
        ("lead", lambda: lead(m, bars)),
        ("arc", lambda: arc(m, bars, feats)),
    ):
        v = fn()
        if v:
            out[name] = v
    if not out:
        return {"error": "nothing derivable"}
    m.setdefault("observations", {}).update(out)
    if write:
        json.dump(m, open(p, "w"), indent=1, ensure_ascii=False)
        open(p, "a").write("\n")
    return {"slug": slug, "added": sorted(out), "detail": out, "path": p}


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    write = "--write" in sys.argv
    for slug in args or ["levels", "starlight", "mizhiyoram", "dont-look-down"]:
        r = analyse(slug, write)
        if "error" in r:
            print("  %-16s %s" % (slug, r["error"]))
            continue
        d = r["detail"]
        print(
            "  %-16s %s%s"
            % (slug, ", ".join(r["added"]), "  -> written" if write else "")
        )
        if "lead" in d:
            print(
                "      led by: %s"
                % ", ".join(
                    "%s %d bars" % kv
                    for kv in list(d["lead"]["bars_led_by"].items())[:4]
                )
            )
        if "arc" in d:
            print(
                "      peak at %.0f%% through, quietest at %.0f%%, shape %s"
                % (
                    100 * d["arc"]["peak_at_fraction"],
                    100 * d["arc"]["quietest_at_fraction"],
                    d["arc"]["mean_by_fifth"],
                )
            )
        if "surprise" in d:
            print(
                "      most unexpected bars: %s"
                % d["surprise"]["biggest_departures_s"][:5]
            )
        if "anticipation" in d:
            print(
                "      warning before a drop: %s bars"
                % d["anticipation"]["bars_of_warning_before_a_drop"]
            )
