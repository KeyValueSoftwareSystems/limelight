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


def grid(times, downs, length_s, report=None):
    idx, period, offset, resid = solve(times)
    bpb, agreement, first_down, apart = meter(times, idx, downs)
    bpb = bpb or 4

    bar = period * bpb
    found = offset + period * first_down if first_down is not None else offset
    floor = max(0.0, times[0] - period / 2)
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

    return {
        "bpm": round(bpm, 3),
        "first_beat_s": round(first, 4),
        "beats_per_bar": bpb,
        "bars": int((length_s - first) // bar) + 1,
    }


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
    if "parts" in r:
        print(f"    parts          {r['parts']}   {', '.join(r['kinds'])}", file=w)
    if "events" in r:
        print(f"    events         {r['events']}   {', '.join(r['event_kinds'])}", file=w)
