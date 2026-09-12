import warnings

import numpy as np

warnings.filterwarnings("ignore")

RATE = 100


def at(env, lo, hi):
    a, b = int(lo * RATE), int(hi * RATE)
    part = env[max(0, a):max(0, b)]
    return float(part.mean()) if len(part) else 0.0


def weights(times, stems):
    hit = np.zeros(len(times))
    for name in ("drums", "bass"):
        v = stems.get(name)
        if v is None:
            continue
        top = np.percentile(v, 98) or 1.0
        hit += np.array([at(v / top, t, t + 0.09) for t in times])
    top = np.percentile(hit, 95) or 1.0
    return np.clip(hit / top, 0.0, 1.0)


def confidence(times, grid):
    period = 60.0 / grid["bpm"]
    k = np.rint((times - grid["first_beat_s"]) / period)
    off = np.abs(times - (grid["first_beat_s"] + k * period))
    return np.clip(1.0 - off / (period * 0.25), 0.0, 1.0)


def tension(bright, busy, stems, times):
    low = stems.get("bass")
    weight = np.zeros(len(times))
    if low is not None:
        top = np.percentile(low, 95) or 1.0
        weight = np.clip(np.array([at(low / top, t, t + 0.2) for t in times]), 0, 1)
    b = np.asarray(bright, dtype=float).ravel()[: len(times)]
    if len(b) < len(times):
        b = np.pad(b, (0, len(times) - len(b)), mode="edge")
    lo, hi = np.percentile(b, 5), np.percentile(b, 95)
    b = np.clip((b - lo) / max(hi - lo, 1e-6), 0, 1)
    k = 2
    pad = np.pad(b, (k, k), mode="edge")
    smooth = np.array([pad[i:i + 2 * k + 1].mean() for i in range(len(b))])

    look = 8
    climb = np.zeros(len(smooth))
    for i in range(len(smooth)):
        back = smooth[max(0, i - look):i + 1]
        climb[i] = max(0.0, smooth[i] - back.min())
    top = np.percentile(climb, 95) or 1.0
    climb = np.clip(climb / top, 0, 1)

    held = np.clip(smooth - weight, 0, 1)
    return np.clip(0.45 * held + 0.55 * climb, 0, 1)


def releases(times, hits, pull, bpb, least=0.35):
    found = []
    for i in range(8, len(times)):
        before = float(hits[max(0, i - 8):i].mean())
        jump = float(hits[i] - before)
        if jump < least or hits[i] < 0.70:
            continue
        back = pull[max(0, i - 16):i]
        lead = 0
        if len(back) > 2:
            m = int(np.argmax(back))
            j = int(np.argmin(back[:m + 1]))
            if float(back[m] - back[j]) > 0.08:
                lead = len(back) - j
        found.append({"beat_index": int(i), "at_s": round(float(times[i]), 3),
                      "lead_beats": int(lead),
                      "size": round(float(min(1.0, jump)), 3)})

    out = []
    for r in sorted(found, key=lambda x: -x["size"]):
        if all(abs(r["beat_index"] - o["beat_index"]) >= bpb * 4 for o in out):
            out.append(r)
    return sorted(out, key=lambda x: x["beat_index"])


def pulse(path, grid, times, positions, onsets, stems, report=None):
    from parts import features_at

    period = 60.0 / grid["bpm"]
    edges = np.concatenate([times, [times[-1] + period]])
    _, _, busy, bright = features_at(path, edges)

    hits = weights(times, stems)
    sure = confidence(times, grid)
    pull = tension(bright, busy, stems, times)
    gone = releases(times, hits, pull, grid["beats_per_bar"])

    holds_from = grid.get("holds_from_s")
    holds_to = grid.get("holds_to_s")

    beats = []
    for i, t in enumerate(times):
        on = True
        if holds_from is not None:
            on = holds_from - 0.05 <= t <= holds_to + 0.05
        beats.append({
            "t": round(float(t), 4),
            "downbeat": bool(positions[i] == 1),
            "weight": round(float(hits[i]), 3),
            "sure": round(float(sure[i] if on else sure[i] * 0.5), 3),
        })

    if report is not None:
        report["beats_listed"] = len(beats)
        report["releases"] = len(gone)
        report["mean_sure"] = round(float(sure.mean()), 3)

    return beats, [round(float(x), 3) for x in pull], gone
