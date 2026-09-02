#!/usr/bin/env python3
"""The bench. One command, three numbers.

    python3 bench/bench.py truth/the-nights.truth.json maps/the-nights.map.json

Compares a candidate map against a truth file and prints what the machine got
right. Stdlib only, no model, no audio. Deterministic: same inputs, same numbers.

Metrics and their tolerances are stated in BENCH.md and are not negotiable
mid-experiment -- moving a tolerance to make a number look better is the one
form of cheating this file cannot detect, so it is on you.
"""
import json, sys, math, argparse

BEAT_TOL      = 0.070   # seconds. Standard in the beat-tracking literature
BOUNDARY_TOLS = (0.5, 3.0)
MOMENT_TOL    = 1.0
SPAN_IOU_PASS = 0.70


def f_measure(truth, cand, tol):
    """Greedy one-to-one matching within tol. Returns (p, r, f, matched)."""
    if not truth and not cand: return (1.0, 1.0, 1.0, 0)
    if not truth or not cand:  return (0.0, 0.0, 0.0, 0)
    used, matched = set(), 0
    for t in truth:
        best, bd = None, tol + 1
        for j, c in enumerate(cand):
            if j in used: continue
            d = abs(c - t)
            if d <= tol and d < bd: best, bd = j, d
        if best is not None:
            used.add(best); matched += 1
    p = matched / len(cand)
    r = matched / len(truth)
    f = 0.0 if p + r == 0 else 2 * p * r / (p + r)
    return (p, r, f, matched)


def octave_check(truth_beats, cand_beats):
    """Tempo octave errors. A tracker locked to half or double tempo scores
    respectably against the beats it does hit, and looks fine to the eye."""
    out = {}
    out["as_given"] = f_measure(truth_beats, cand_beats, BEAT_TOL)[2]
    out["truth_halved"] = f_measure(truth_beats[::2], cand_beats, BEAT_TOL)[2]
    if len(cand_beats) > 1:
        doubled = []
        for i in range(len(cand_beats) - 1):
            doubled += [cand_beats[i], (cand_beats[i] + cand_beats[i + 1]) / 2]
        doubled.append(cand_beats[-1])
        out["cand_doubled"] = f_measure(truth_beats, doubled, BEAT_TOL)[2]
    else:
        out["cand_doubled"] = 0.0
    return out


def boundaries(chapters):
    return sorted({round(c["at"], 3) for c in chapters if c["at"] > 0})


def moment_report(truth, cand):
    """Also reports holds error on stops. A stop 300 ms short reads as a
    mistake in the room, and onset accuracy alone is blind to it."""
    rows, used = [], set()
    for m in truth:
        best, bd = None, MOMENT_TOL + 1
        for j, c in enumerate(cand):
            if j in used or c["kind"] != m["kind"]: continue
            d = abs(c["at"] - m["at"])
            if d <= MOMENT_TOL and d < bd: best, bd = j, d
        if best is None:
            rows.append((m["kind"], m["at"], None, None, None)); continue
        used.add(best)
        he = None
        if m["kind"] == "stop" and "holds" in m and "holds" in cand[best]:
            he = cand[best]["holds"] - m["holds"]
        rows.append((m["kind"], m["at"], cand[best]["at"], cand[best]["at"] - m["at"], he))
    extra = [cand[j] for j in range(len(cand)) if j not in used]
    return rows, extra


def span_iou(a, b):
    lo, hi = max(a["from"], b["from"]), min(a["to"], b["to"])
    inter = max(0.0, hi - lo)
    union = (a["to"] - a["from"]) + (b["to"] - b["from"]) - inter
    return 0.0 if union <= 0 else inter / union


def span_report(truth, cand):
    rows, used = [], set()
    for s in truth:
        best, bi = 0.0, None
        for j, c in enumerate(cand):
            if j in used or c["kind"] != s["kind"]: continue
            v = span_iou(s, c)
            if v > best: best, bi = v, j
        if bi is None:
            rows.append((s["kind"], s["from"], s["to"], None, 0.0, None)); continue
        used.add(bi)
        rows.append((s["kind"], s["from"], s["to"], cand[bi], best,
                     cand[bi].get("rise") == s.get("rise")))
    return rows


def interp(curve, t):
    if not curve: return None
    if t <= curve[0][0]: return curve[0][1]
    if t >= curve[-1][0]: return curve[-1][1]
    lo, hi = 0, len(curve) - 1
    while lo <= hi:
        m = (lo + hi) // 2
        if curve[m][0] <= t: lo = m + 1
        else: hi = m - 1
    k = hi
    f = (t - curve[k][0]) / (curve[k + 1][0] - curve[k][0])
    return curve[k][1] + f * (curve[k + 1][1] - curve[k][1])


def pearson(xs, ys):
    n = len(xs)
    if n < 3: return None
    mx, my = sum(xs) / n, sum(ys) / n
    num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    dx = math.sqrt(sum((x - mx) ** 2 for x in xs))
    dy = math.sqrt(sum((y - my) ** 2 for y in ys))
    return None if dx == 0 or dy == 0 else num / (dx * dy)


def run(truth, cand, quiet=False):
    say = (lambda *a: None) if quiet else print
    T, C = truth, cand
    name = T.get("song", {}).get("title", "?")
    say(f"\n  {name}   truth by {T.get('made_by',{}).get('who','?')}"
        f"   candidate by {C.get('made_by',{}).get('how','?')}\n")

    tb, cb = T.get("beats", []), C.get("beats", [])
    p, r, f, m = f_measure(tb, cb, BEAT_TOL)
    oct_ = octave_check(tb, cb)
    say(f"  BEATS       F={f:.3f}   P={p:.3f} R={r:.3f}   {m}/{len(tb)} within {BEAT_TOL*1000:.0f} ms")
    if oct_["truth_halved"] > f + 0.15 or oct_["cand_doubled"] > f + 0.15:
        say(f"              !! tempo octave error: halved={oct_['truth_halved']:.3f} "
            f"doubled={oct_['cand_doubled']:.3f}  -- you are not on the right pulse")

    td, cd = T.get("downbeats", []), C.get("downbeats", [])
    _, _, fd, md = f_measure(td, cd, BEAT_TOL)
    say(f"  DOWNBEATS   F={fd:.3f}                       {md}/{len(td)} within {BEAT_TOL*1000:.0f} ms")

    bt, bc = boundaries(T.get("chapters", [])), boundaries(C.get("chapters", []))
    bl = []
    for tol in BOUNDARY_TOLS:
        _, _, fb, mb = f_measure(bt, bc, tol)
        bl.append(fb)
        say(f"  CHAPTERS    F={fb:.3f} at {tol:>3.1f}s              {mb}/{len(bt)} boundaries"
            f"   ({len(bc)} proposed)")

    rows, extra = moment_report(T.get("moments", []), C.get("moments", []))
    hits = [x for x in rows if x[2] is not None]
    holds_err = [x[4] for x in rows if x[4] is not None]
    mae = sum(abs(x[3]) for x in hits) / len(hits) if hits else None
    say(f"  MOMENTS     {len(hits)}/{len(rows)} hit within {MOMENT_TOL:.1f}s"
        f"   {len(extra)} false"
        + (f"   mean error {mae*1000:.0f} ms" if mae is not None else ""))
    for kind, at, got, err, he in rows:
        line = f"                {kind:<10} truth {at:8.3f}  " + (
            f"got {got:8.3f}   {err*1000:+7.0f} ms" if got is not None else "MISSED")
        if he is not None:
            line += f"   holds {he*1000:+.0f} ms" + ("  !! audible" if abs(he) > 0.1 else "")
        say(line)
    for e in extra:
        say(f"                {e['kind']:<10} {'':8}  false alarm at {e['at']:8.3f}")

    sr = span_report(T.get("spans", []), C.get("spans", []))
    if sr:
        ok = sum(1 for x in sr if x[4] >= SPAN_IOU_PASS)
        say(f"  SPANS       {ok}/{len(sr)} with IoU >= {SPAN_IOU_PASS:.2f}")
        for kind, fr, to, got, iou, rise_ok in sr:
            if got is None:
                say(f"                {kind:<10} {fr:7.1f}->{to:7.1f}  MISSED")
            else:
                rise = "rise ok" if rise_ok else f"rise wrong ({got.get('rise')})"
                say(f"                {kind:<10} {fr:7.1f}->{to:7.1f}  got "
                    f"{got['from']:7.1f}->{got['to']:7.1f}  IoU={iou:.2f}  {rise}")

    ec, tc_ = C.get("energy") or [], T.get("energy") or []
    corr = None
    if tc_ and ec:
        ts = [t for t, _ in tc_]
        corr = pearson([v for _, v in tc_], [interp(ec, t) for t in ts])
        say(f"  ENERGY      r={corr:.3f}" if corr is not None
            else "  ENERGY      undefined (one curve is flat)")
    else:
        say("  ENERGY      absent")

    say(f"\n  confidence claimed: {C.get('confidence')}   "
        f"vectors: {'yes' if C.get('vectors') else 'no'}\n")
    return {"beats_f": f, "downbeats_f": fd, "boundary_f": bl,
            "moments_hit": len(hits), "moments_total": len(rows),
            "moments_false": len(extra), "moment_mae": mae,
            "holds_max_err": max((abs(h) for h in holds_err), default=None),
            "spans_ok": sum(1 for x in sr if x[4] >= SPAN_IOU_PASS), "spans_total": len(sr),
            "energy_r": corr, "octave": oct_}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("truth"); ap.add_argument("candidate")
    ap.add_argument("--json", action="store_true", help="machine-readable only")
    a = ap.parse_args()
    T = json.load(open(a.truth)); C = json.load(open(a.candidate))
    res = run(T, C, quiet=a.json)
    if a.json: print(json.dumps(res, indent=2))
