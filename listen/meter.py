import sys, os, json, math, wave, array, bisect

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mapio import map_path

HOP_S = 0.005
LAGS = 16
WINDOWS = 8
DRIFT_RANGE = 0.02
KINDS = ("kick", "snare", "hat")


def low_envelope(path):
    with wave.open(path, "rb") as w:
        sr, n, ch = w.getframerate(), w.getnframes(), w.getnchannels()
        raw = w.readframes(n)
    a = array.array("h")
    a.frombytes(raw[: len(raw) - (len(raw) % 2)])
    if ch > 1:
        a = a[::ch]
    hop = max(1, int(sr * HOP_S))
    al = math.exp(-2 * math.pi * 130.0 / sr)
    out, y = [], 0.0
    for i in range(0, len(a) - hop, hop):
        pk = 0.0
        for v in a[i : i + hop]:
            y = (1 - al) * v + al * y
            if abs(y) > pk:
                pk = abs(y)
        out.append(pk)
    return out


def at(env, t, w=1):
    i = int(round(t / HOP_S))
    seg = env[max(0, i - w) : i + w + 1]
    return max(seg) if seg else 0.0


def _cos(a, b):
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    if na < 1e-9 or nb < 1e-9:
        return None
    return sum(x * y for x, y in zip(a, b)) / (na * nb)


def bar_length(m):
    beats = m.get("beats") or []
    ev = ((m.get("accents") or {}).get("events")) or []
    if len(beats) < 32 or not ev:
        return None
    vecs = [[0.0] * len(KINDS) for _ in beats]
    for e in ev:
        k = e.get("of")
        if k not in KINDS:
            continue
        j = bisect.bisect(beats, e["at"]) - 1
        if 0 <= j < len(beats):
            vecs[j][KINDS.index(k)] += 1.0
    if sum(sum(v) for v in vecs) < len(beats) * 0.5:
        return None

    curve = {}
    for lag in range(1, LAGS + 1):
        vals = [
            c
            for c in (_cos(vecs[i], vecs[i + lag]) for i in range(len(vecs) - lag))
            if c is not None
        ]
        if len(vals) > 8:
            curve[lag] = sum(vals) / len(vals)
    if not curve:
        return None

    def support(n):
        got = [curve[k] for k in (n, 2 * n, 3 * n) if k in curve]
        return sum(got) / len(got) if got else 0.0

    cands = {n: round(support(n), 4) for n in (2, 3, 4, 5, 6, 7)}
    best = max(cands, key=lambda n: cands[n])
    if best == 2 and cands.get(4, 0) > cands[2] * 0.92:
        best = 4
    runner = max((n for n in cands if n != best), key=lambda n: cands[n])
    return {
        "beats_per_bar": best,
        "next_best": runner,
        "margin_over_next_best": round(cands[best] - cands[runner], 4),
        "support_by_candidate": cands,
        "self_similarity_by_lag": {k: round(v, 4) for k, v in sorted(curve.items())},
        "how": "hits per beat on kick, snare and hat as a 3-vector per beat; mean cosine "
        "similarity at every lag out to %d beats; each candidate judged on itself "
        "and its multiples, since a bar of N peaks at N, 2N and 3N" % LAGS,
        "why_recorded": "beats_per_bar=4 is a default argument in ear.py that nothing has "
        "ever checked, and every downbeat, chapter and bar-phase argument "
        "in this repo rests on it",
        "not": "not the notated time signature. It is the period the DRUMS repeat on, which "
        "is what a reader needs and what ear.py assumes is four. A song whose drums "
        "and score disagree will read here as the drums.",
    }


def tempo_stability(m, env):
    beats = m.get("beats") or []
    per = (m.get("grid") or {}).get("period")
    ev = ((m.get("accents") or {}).get("events")) or []
    kicks = sorted(e["at"] for e in ev if e.get("of") == "kick")
    if not per or len(beats) < 64 or len(kicks) < 24:
        return None

    offs = []
    for t in kicks:
        i = bisect.bisect(beats, t)
        cands = [beats[j] for j in (i - 1, i) if 0 <= j < len(beats)]
        if not cands:
            continue
        b = min(cands, key=lambda x: abs(x - t))
        d = t - b
        if abs(d) < per * 0.25:
            offs.append((t, d))
    if len(offs) < 24:
        return None

    span = beats[-1] - beats[0]
    nb = 8
    per_window = []
    for w in range(nb):
        t0, t1 = beats[0] + span * w / nb, beats[0] + span * (w + 1) / nb
        got = sorted(d for t, d in offs if t0 <= t < t1)
        if len(got) < 5:
            per_window.append(None)
            continue
        per_window.append(got[len(got) // 2])
    seen = [(i, v) for i, v in enumerate(per_window) if v is not None]
    if len(seen) < 4:
        return None

    n = len(seen)
    mx = sum(i for i, _ in seen) / n
    my = sum(v for _, v in seen) / n
    den = sum((i - mx) ** 2 for i, _ in seen)
    slope = (sum((i - mx) * (v - my) for i, v in seen) / den) if den else 0.0
    drift_per_window = slope
    vals = [v for _, v in seen]
    implied_bpm_err = 0.0
    if span > 0:
        total_drift = drift_per_window * (n - 1)
        implied_bpm_err = -(total_drift / span) * (60.0 / per)

    flat = abs(total_drift) < per * 0.10
    return {
        "claimed_period_s": round(per, 6),
        "claimed_bpm": round(60.0 / per, 3),
        "how": "the signed offset between every kick and its nearest grid beat, median per "
        "eighth of the song, then a straight line through those medians. A rigid grid "
        "at the wrong tempo cannot stay level: the kicks walk away from it. Fitting a "
        "period per window was tried first and is the wrong instrument -- 64 beats "
        "against a 2 percent range read 1.85 percent of drift on two records made in "
        "a DAW, which was the estimator's own resolution, not the music.",
        "kicks_used": len(offs),
        "median_offset_ms_by_eighth": [None if v is None else round(v * 1000, 1) for v in per_window],
        "drift_ms_per_eighth": round(drift_per_window * 1000, 2),
        "total_drift_ms": round(total_drift * 1000, 1),
        "implied_tempo_error_bpm": round(implied_bpm_err, 4),
        "rigid_grid_justified": bool(flat),
        "verdict": (
            "machine-steady: the kicks do not walk away from the grid over the whole "
            "record, so one period and one phase describe it exactly"
            if flat
            else "the kicks WALK: a single period does not hold, and every time in this "
            "file inherits the error"
        ),
        "why_recorded": "ear.py fills the song with phase + i * period, which is exact for a "
        "record made in a DAW and wrong for anything played by people. "
        "Nothing in this file said which kind of recording it was.",
    }


def analyse(slug, write=False):
    p = map_path(slug)
    wav = os.path.join(ROOT, "synth", "out", slug + ".wav")
    if not p or not os.path.exists(wav):
        return {"error": "no map or no audio"}
    m = json.load(open(p))
    env = low_envelope(wav)
    out = {}
    bl = bar_length(m)
    if bl:
        out["meter"] = bl
    ts = tempo_stability(m, env)
    if ts:
        out["tempo_stability"] = ts
    if not out:
        return {"error": "nothing measurable"}
    if "meter" in out:
        # grid.beats_per_bar is interface tier because a reader breaks without
        # it: readers/src/derive.js has to lay out bar lines to answer anything
        # in bars, and with the number only in observations it was assuming 4.
        # The evidence and the provenance stay in observations.meter; the grid
        # carries the one number a reader needs.
        n = out["meter"].get("beats_per_bar")
        if n:
            m.setdefault("grid", {})["beats_per_bar"] = n
        out["meter"]["provenance"] = "measured"
        out["meter"]["measured_how"] = (
            "self-similarity of the drum pattern at each candidate lag, judged on the lag and "
            "its double. This is a PERCUSSIVE measurement, so it must not be checked against "
            "another percussive one -- mapeval's ev_meter checks it against the spacing of the "
            "chord changes instead, which comes from a harmonic model sharing no code with "
            "this path.")
        out["meter"]["margin_is_thin"] = (
            abs(out["meter"].get("margin_over_next_best") or 0.0) < 0.05)
    if "tempo_stability" in out:
        out["tempo_stability"]["provenance"] = "measured"
    m.setdefault("observations", {}).update(out)
    if write:
        json.dump(m, open(p, "w"), indent=1, ensure_ascii=False)
        open(p, "a").write("\n")
    return {"slug": slug, **out, "path": p}


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    write = "--write" in sys.argv
    for slug in args or ["levels", "starlight", "mizhiyoram", "dont-look-down"]:
        r = analyse(slug, write)
        if "error" in r:
            print("  %-16s %s" % (slug, r["error"]))
            continue
        mt, ts = r.get("meter"), r.get("tempo_stability")
        if mt:
            print(
                "  %-16s bar = %d beats (next best %d, margin %+.3f)"
                % (
                    slug,
                    mt["beats_per_bar"],
                    mt["next_best"],
                    mt["margin_over_next_best"],
                )
            )
        if ts:
            print(
                "  %-16s %.2f BPM | %d kicks | drift %+.1f ms over the song "
                "= %+.3f BPM | %s"
                % (
                    "",
                    ts["claimed_bpm"],
                    ts["kicks_used"],
                    ts["total_drift_ms"],
                    ts["implied_tempo_error_bpm"],
                    "rigid grid ok" if ts["rigid_grid_justified"] else "KICKS WALK",
                )
            )
        if write:
            print("  %-16s -> written" % "")
