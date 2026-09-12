import numpy as np

from grid import at_beat

RATE = 25.0


def per_bar(emb, g, bars):
    per = g["beats_per_bar"]
    rows = []
    for i in range(bars):
        t0, t1 = at_beat(g, i * per), at_beat(g, (i + 1) * per)
        a, b = int(t0 * RATE), int(t1 * RATE)
        if b > emb.shape[0] or b <= a:
            break
        rows.append(emb[a:b].mean(axis=0))
    if not rows:
        return None
    x = np.vstack(rows)
    return x / (np.linalg.norm(x, axis=1, keepdims=True) + 1e-9)


def novelty(x, look=8):
    n = len(x)
    if n < look * 2 + 2:
        return None
    s = x @ x.T
    k = np.ones((2 * look, 2 * look))
    k[:look, look:] = -1
    k[look:, :look] = -1
    out = np.zeros(n)
    for i in range(look, n - look):
        out[i] = float((s[i - look:i + look, i - look:i + look] * k).sum())
    lo, hi = out.min(), out.max()
    return (out - lo) / (hi - lo + 1e-9)


def edges(emb, g, bars, floor=0.55, apart=4):
    # A second opinion on where the sections are, from a model that shares no
    # code and no training data with the detectors in shape.py. Where they
    # agree the boundary is worth trusting; where only one of them speaks it
    # is worth saying so rather than averaging them into false confidence.
    x = per_bar(emb, g, bars)
    if x is None:
        return []
    nv = novelty(x)
    if nv is None:
        return []
    out = []
    for i in range(2, len(nv) - 2):
        if nv[i] >= floor and nv[i] == max(nv[max(0, i - apart):i + apart + 1]):
            out.append((int(i), round(float(nv[i]), 3)))
    return out


def agrees(told, found, slack=2):
    seen = {}
    for bar, lift in found:
        for t in told:
            if abs(bar - t) <= slack:
                seen[t] = max(seen.get(t, 0.0), lift)
    return seen
