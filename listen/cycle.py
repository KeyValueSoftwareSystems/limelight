import numpy as np


def pulls(v, least=2):
    v = np.asarray(v, dtype=float)
    v = v[np.isfinite(v)]
    n = len(v)
    if n < least * 3:
        return []
    v = v - v.mean()
    if not np.any(v):
        return []
    whole = float(np.dot(v, v)) or 1.0
    out = []
    for lag in range(least, n // 2 + 1):
        a, b = v[:-lag], v[lag:]
        if len(a) < least * 2:
            break
        denom = float(np.sqrt(np.dot(a, a) * np.dot(b, b))) or 1.0
        out.append((lag, float(np.dot(a, b)) / denom))
    return out


SAID = (2, 3, 4, 6, 8, 12, 16)


def cycle(lanes, least=2, floor=0.35, edge=0.12):
    # A verse that trades back and forth -- a line, an answer, the line again --
    # never steps anywhere. Its level ends where it started, so a step detector
    # reads it as noise about a stable mean and reports nothing, which is how a
    # 31-bar section with four turnovers inside it stayed one block. What an
    # alternation has is a period, so this looks for one.
    best = {}
    for name, v in lanes.items():
        for lag, fit in pulls(v, least):
            best.setdefault(lag, []).append((name, fit))
    scored = []
    for lag, hits in best.items():
        # Music alternates in phrase lengths. A period of 41 bars is not a call
        # and response, it is a slow drift that correlates with itself, and
        # experience produced exactly that across an 88-bar span.
        if lag not in SAID:
            continue
        agree = [f for _, f in hits]
        scored.append((lag, float(np.mean(agree)), hits))
    if not scored:
        return None
    scored.sort(key=lambda x: -x[1])
    lag, fit, hits = scored[0]
    if fit < floor:
        return None
    # A real period beats its neighbours; a slow drift scores well at every lag.
    near = [f for l, f, _ in scored if l != lag and abs(l - lag) <= 1]
    if near and fit - max(near) < edge / 2:
        return None
    rest = [f for l, f, _ in scored if abs(l - lag) > 1]
    if rest and fit - float(np.mean(rest)) < edge:
        return None
    return {"every_bars": int(lag), "sure": round(float(fit), 3),
            "heard_in": [n for n, f in sorted(hits, key=lambda x: -x[1]) if f >= floor][:3]}
