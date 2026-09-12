import sys

import numpy as np


def walk(times):
    gaps = np.diff(times)
    step = float(np.median(gaps))
    spans = np.maximum(1, np.rint(gaps / step)).astype(int)
    return np.concatenate([[0], np.cumsum(spans)])


def index(times, period):
    return np.rint((times - times[0]) / period).astype(int)


def solve(times):
    idx = walk(times)
    period, offset, resid = fit(times, idx)
    for _ in range(8):
        nxt = index(times, period)
        if len(np.unique(nxt)) != len(nxt):
            break
        p, o, r = fit(times, nxt)
        moved = abs(p - period)
        idx, period, offset, resid = nxt, p, o, r
        if moved < 1e-9:
            break
    return idx, period, offset, resid


def fit(times, idx):
    a = np.vstack([idx.astype(float), np.ones(len(idx))]).T
    (period, offset), *_ = np.linalg.lstsq(a, times, rcond=None)
    return float(period), float(offset), times - (period * idx + offset)


def meter(times, idx, downs):
    if len(downs) < 2:
        return None, 0.0, None, None
    at = np.abs(times[None, :] - downs[:, None]).argmin(axis=1)
    apart = float(np.median(np.abs(times[at] - downs)) * 1000)
    steps = np.diff(idx[at])
    steps = steps[steps > 0]
    if not len(steps):
        return None, 0.0, int(idx[at][0]), apart
    vals, counts = np.unique(steps, return_counts=True)
    return int(vals[counts.argmax()]), float(counts.max() / counts.sum()), int(idx[at][0]), apart


def drift(times, idx):
    half = len(times) // 2
    out = []
    for part in (slice(0, half), slice(half, None)):
        period, _, _ = fit(times[part], idx[part] - idx[part][0])
        out.append(60.0 / period)
    return out[0], out[1]


def steady(times, window=16, tol=0.015, least=0.45):
    if len(times) < window * 3:
        return 0, len(times)
    bpm = 60.0 / np.diff(times)
    local = np.array([np.median(bpm[max(0, i - window):i + window]) for i in range(len(bpm))])
    mid = float(np.median(local))
    ok = np.abs(local - mid) / mid < tol
    best, run, start = (0, 0), 0, 0
    for i in range(len(ok) + 1):
        if i < len(ok) and ok[i]:
            if run == 0:
                start = i
            run += 1
        else:
            if run > best[1] - best[0]:
                best = (start, i + 1)
            run = 0
    if best[1] - best[0] < least * len(times):
        return 0, len(times)
    return best


def pieces(times, window=12, tol=0.035, least=10):
    gaps = np.diff(times)
    n = len(gaps)
    if n < least * 2:
        return [(0, len(times))]
    local = np.array([float(np.median(gaps[max(0, i - window):min(n, i + window + 1)]))
                      for i in range(n)])
    runs, start = [], 0
    for i in range(1, n + 1):
        if i == n:
            runs.append((start, i))
            break
        held = float(np.median(local[start:i]))
        if held > 0 and abs(local[i] - held) / held > tol:
            runs.append((start, i))
            start = i
    while len(runs) > 1:
        short = [k for k, (a, b) in enumerate(runs) if b - a < least]
        if not short:
            break
        k = min(short, key=lambda k: runs[k][1] - runs[k][0])
        a, b = runs[k]
        near = []
        if k > 0:
            near.append(k - 1)
        if k < len(runs) - 1:
            near.append(k + 1)
        mine = float(np.median(local[a:b]))
        pick = min(near, key=lambda j: abs(float(np.median(local[runs[j][0]:runs[j][1]])) - mine))
        lo = min(runs[k][0], runs[pick][0])
        hi = max(runs[k][1], runs[pick][1])
        runs[min(k, pick)] = (lo, hi)
        runs.pop(max(k, pick))
    return [(a, b + 1) for a, b in runs]


LEVELS = (1.0 / 3, 0.5, 1.0, 2.0, 3.0)


def fold(runs, tol=0.04):
    if len(runs) < 2:
        return runs
    lead = max(runs, key=lambda r: r["beats"])["period"]
    for r in runs:
        ratio = r["period"] / lead
        near = min(LEVELS, key=lambda L: abs(ratio - L) / L)
        if abs(ratio - near) / near <= tol:
            r["period"] = lead
    out = [runs[0]]
    for r in runs[1:]:
        if abs(r["period"] - out[-1]["period"]) / out[-1]["period"] <= tol:
            out[-1]["to_s"] = r["to_s"]
            out[-1]["beats"] += r["beats"]
        else:
            out.append(r)
    return out


def tempos(times, spans):
    out = []
    for a, b in spans:
        part = times[a:b]
        if len(part) < 2:
            continue
        idx = walk(part)
        period, offset, _ = fit(part, idx)
        if period <= 0:
            continue
        out.append({"at": offset, "period": period, "beats": int(idx[-1]) + 1,
                    "from_s": float(part[0]), "to_s": float(part[-1])})
    return out


def ladder(runs, first):
    out = [{"from_beat": 0, "at_s": round(first, 4),
            "bpm": round(60.0 / runs[0]["period"], 3)}]
    at, n = first, 0
    for i in range(len(runs) - 1):
        step = max(1, int(round((runs[i + 1]["from_s"] - at) / runs[i]["period"])))
        at += step * runs[i]["period"]
        n += step
        out.append({"from_beat": n, "at_s": round(at, 4),
                    "bpm": round(60.0 / runs[i + 1]["period"], 3)})
    return out


def spans(tempo, bpb, length_s):
    n, at = 0, tempo[0]["at_s"]
    for i, seg in enumerate(tempo):
        period = 60.0 / seg["bpm"]
        upto = tempo[i + 1]["from_beat"] if i + 1 < len(tempo) else None
        if upto is None:
            return n + int((length_s - seg["at_s"]) // (period * bpb)) * bpb
        n = upto
    return n


def grid(times, downs, length_s, report=None):
    lo, hi = steady(times)
    if report is not None and (lo, hi) != (0, len(times)):
        report["fitted_from_s"] = round(float(times[lo]), 3)
        report["fitted_to_s"] = round(float(times[min(hi, len(times) - 1)]), 3)
        report["fitted_share"] = round((hi - lo) / len(times), 3)
    floor_at = float(times[0])
    whole = times
    times = times[lo:hi]
    idx, period, offset, resid = solve(times)
    bpb, agreement, first_down, apart = meter(times, idx, downs)
    bpb = bpb or 4

    bar = period * bpb
    found = offset + period * first_down if first_down is not None else offset
    floor = max(0.0, floor_at - period / 2)
    first = found
    while first - bar >= floor:
        first -= bar

    bpm = 60.0 / period
    early, late = drift(times, idx)
    if report is not None:
        report["seed_bpm"] = round(60.0 / fit(times, walk(times))[0], 3)

    if report is not None:
        rms = float(np.sqrt(np.mean(resid**2)) * 1000)
        worst = float(np.max(np.abs(resid)) * 1000)
        loose = int(np.sum(np.abs(resid) > 0.070))
        report.update(
            beats=len(times),
            downbeats=len(downs),
            residual_ms=round(rms, 1),
            worst_ms=round(worst, 1),
            loose=loose,
            meter_agreement=round(agreement, 3),
            downbeat_offset_ms=round(apart, 1) if apart is not None else None,
            first_downbeat_heard=round(found, 4),
            bars_back=round((found - first) / bar),
            bpm_early=round(early, 3),
            bpm_late=round(late, 3),
            drift_pct=round(abs(early - late) / bpm * 100, 3),
        )

    runs = fold(tempos(whole, pieces(whole)))
    tempo = ladder(runs, first)
    out = {
        "bpm": round(bpm, 3),
        "first_beat_s": round(first, 4),
        "beats_per_bar": bpb,
        "bars": int(spans(tempo, bpb, length_s) // bpb) + 1,
        "tempo": tempo,
    }
    if report is not None:
        report["tempo_segments"] = len(tempo)
    if report is not None and "fitted_share" in report:
        out["holds_from_s"] = report["fitted_from_s"]
        out["holds_to_s"] = report["fitted_to_s"]
        out["holds_measured"] = True
    else:
        out["holds_from_s"] = round(first, 4)
        out["holds_to_s"] = round(length_s, 4)
        out["holds_measured"] = False
    return out


def show(slug, g, r, second_opinion=None):
    w = sys.stderr
    print(f"  {slug}", file=w)
    print(f"    beats          {r['beats']}   downbeats {r['downbeats']}", file=w)
    line = f"    bpm            {g['bpm']:.3f}"
    if second_opinion:
        for who, val in second_opinion.items():
            line += f"   {who} {val:.3f}"
    print(line, file=w)
    print(f"    beats_per_bar  {g['beats_per_bar']}   "
          f"{r['meter_agreement'] * 100:.0f}% of downbeat gaps agree   "
          f"downbeats sit {r['downbeat_offset_ms']:.0f} ms off the nearest beat", file=w)
    print(f"    first_beat_s   {g['first_beat_s']:.4f}   "
          f"first beat heard {r['first_beat_heard']:.4f} (madmom calls it beat {r['first_position']})   "
          f"first downbeat heard {r['first_downbeat_heard']:.4f}, {r['bars_back']} bars back", file=w)
    print(f"    residual       {r['residual_ms']:.1f} ms rms   worst {r['worst_ms']:.0f} ms   "
          f"{r['loose']}/{r['beats']} beats over 70 ms", file=w)
    print(f"    drift          {r['bpm_early']:.2f} -> {r['bpm_late']:.2f} bpm "
          f"({r['drift_pct']:.2f}% across the song)", file=w)
    if "moved_by_ear" in r:
        print(f"    by ear         downbeat moved {r['moved_by_ear']:+d} beat"
              f"{'s' if abs(r['moved_by_ear']) != 1 else ''} (truth/)", file=w)
    if "fitted_share" in r:
        print(f"    fitted to     {r['fitted_share'] * 100:.0f}% of the beats, "
              f"{r['fitted_from_s']:.1f}s to {r['fitted_to_s']:.1f}s "
              f"(the rest is not on this grid)", file=w)
    if "beats_listed" in r:
        print(f"    beats listed   {r['beats_listed']} with weight and confidence "
              f"(mean {r['mean_sure']:.2f})   {r['releases']} releases", file=w)
    if "parts" in r:
        print(f"    parts          {r['parts']}   {', '.join(r['kinds'])}", file=w)
    if "events" in r:
        print(f"    events         {r['events']}   {', '.join(r['event_kinds'])}", file=w)
