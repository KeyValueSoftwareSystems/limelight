import numpy as np

RISE = 0.010
FALL = -0.010
HOLD = 2
SLAM = 0.18
EBB = 0.16


def clean(v):
    return np.asarray([0.0 if x is None else float(x) for x in (v or [])], dtype=float)


def smooth(v, span=3):
    if len(v) < span or span < 2:
        return v
    pad = np.concatenate([np.full(span // 2, v[0]), v, np.full(span // 2, v[-1])])
    k = np.ones(span) / span
    return np.convolve(pad, k, mode="valid")[: len(v)]


def slope(v, look=4):
    out = np.zeros(len(v))
    for i in range(len(v)):
        a = v[max(0, i - look + 1) : i + 1]
        if len(a) < 3:
            continue
        n = len(a)
        xm = (n - 1) / 2.0
        ym = a.mean()
        den = ((np.arange(n) - xm) ** 2).sum() or 1.0
        out[i] = ((np.arange(n) - xm) * (a - ym)).sum() / den
    return out


def moving(bars, look=4, hold=HOLD):
    loud = smooth(clean(bars.get("intensity")))
    if not len(loud):
        return []
    s = slope(loud, look)
    raw = np.where(s > RISE, 1, np.where(s < FALL, -1, 0))
    out = []
    state = 0
    run = 0
    for x in raw:
        if x == state:
            run = 0
        else:
            run += 1
            if run >= hold:
                state = x
                run = 0
        out.append(state)
    return ["rising" if x > 0 else "falling" if x < 0 else "steady" for x in out]


def winding(bars):
    floor = clean(bars.get("floor"))
    noisy = clean(bars.get("noisy"))
    n = max(len(floor), len(noisy))
    if not n:
        return []

    def fit(v):
        if not len(v):
            return np.zeros(n)
        return np.pad(v, (0, n - len(v)), mode="edge") if len(v) < n else v[:n]

    v = 0.7 * (1.0 - fit(floor)) + 0.3 * fit(noisy)
    lo, hi = float(v.min()), float(v.max())
    if hi <= lo:
        return [0.0] * n
    return [round(float(x), 3) for x in (v - lo) / (hi - lo)]


def told(bars, span=8):
    v = winding(bars)
    pts = [x["bar"] for x in slams(bars) if x["big"]]
    if not v or not pts or len(v) <= span:
        return None
    wins = [float(np.mean(v[i : i + span])) for i in range(0, len(v) - span)]
    if not wins:
        return None
    seen = []
    for d in pts:
        if d < span or d >= len(v):
            continue
        mine = float(np.mean(v[d - span : d]))
        seen.append(100.0 * sum(1 for x in wins if x < mine) / len(wins))
    if not seen:
        return None
    return round(sum(seen) / len(seen), 1)


def slams(bars, look=4, apart=8, least=SLAM):
    loud = clean(bars.get("intensity"))
    return _steps(loud, look, apart, least, up=True)


def ebbs(bars, look=4, apart=8, least=EBB):
    loud = clean(bars.get("intensity"))
    return _steps(loud, look, apart, least, up=False)


def _steps(loud, look, apart, least, up):
    n = len(loud)
    found = []
    for i in range(look, n - look):
        before = loud[i - look : i].mean()
        after = loud[i : i + look].mean()
        jump = (after - before) if up else (before - after)
        if jump >= least:
            found.append((float(jump), i))
    found.sort(reverse=True)
    kept = []
    for jump, i in found:
        if all(abs(i - j) >= apart for _, j in kept):
            kept.append((jump, i))
    kept.sort(key=lambda x: x[1])
    if not kept:
        return []
    big = max(j for j, _ in kept)
    return [{"bar": i, "by": round(j, 3), "big": bool(j >= 0.5 * big)} for j, i in kept]


def spans(labels, first_bar=1):
    out = []
    for i, name in enumerate(labels):
        if out and out[-1]["doing"] == name:
            out[-1]["to_bar"] = first_bar + i
        else:
            out.append(
                {"from_bar": first_bar + i, "to_bar": first_bar + i, "doing": name}
            )
    return out


def reading(bars, first_bar=1):
    move = moving(bars)
    wind = winding(bars)
    if not move and not wind:
        return None
    return {
        "per": "bar",
        "from_bar": first_bar,
        "moving": move,
        "winding": wind,
        "spans": spans(move, first_bar),
        "tells": told(bars),
        "slams": [dict(x, bar=x["bar"] + first_bar) for x in slams(bars)],
        "ebbs": [dict(x, bar=x["bar"] + first_bar) for x in ebbs(bars)],
    }
