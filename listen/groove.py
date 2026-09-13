import numpy as np

RATE = 100


def grid_of(env, edges, per):
    spans = []
    for i in range(len(edges) - 1):
        a, b = edges[i], edges[i + 1]
        step = (b - a) / per
        spans.append([(a + k * step, a + (k + 1) * step) for k in range(per)])
    return spans


def attacks(env):
    # The rise, not the level. Sampling the envelope itself reads a kick's
    # decay as three more quiet hits behind it, so a four-on-the-floor came
    # back as sixteen descending sixteenths instead of four strikes.
    v = np.asarray(env, dtype=float)
    d = np.diff(v, prepend=v[:1])
    return np.maximum(d, 0.0)


def hits(env, edges, per):
    # Where the hits fall inside the bar, not how many there are. pace says
    # "1.16 events a beat" for a four-on-the-floor and for a broken shuffle,
    # and a listener never confuses the two. This keeps the position.
    rise = attacks(env)
    out = []
    for slots in grid_of(rise, edges, per):
        row = []
        for lo, hi in slots:
            part = rise[max(0, int(lo * RATE)):max(0, int(hi * RATE))]
            row.append(float(part.max()) if len(part) else 0.0)
        out.append(row)
    return np.asarray(out, dtype=float)


def pattern(env, edges, per=16, least=4):
    v = hits(env, edges, per)
    if len(v) < least:
        return None
    top = v.max() or 1.0
    v = v / top
    return v


SHARE = 0.5


def shape_of(v, share=SHARE):
    if v is None or not len(v):
        return None
    mean = v.mean(axis=0)
    mid = float(np.median(mean))
    top = float(mean.max())
    cut = mid + share * (top - mid)
    on = [i for i, x in enumerate(mean) if top > mid and x >= cut]
    return {"per_bar": int(v.shape[1]),
            "on": on,
            "strength": [round(float(x), 3) for x in mean]}


def settled(v, least=4):
    # How much the same pattern repeats bar after bar. A locked loop and a
    # section that changes every bar can carry the same average and feel
    # nothing alike.
    if v is None or len(v) < least:
        return None
    near = []
    for i in range(1, len(v)):
        a, b = v[i - 1], v[i]
        na, nb = np.linalg.norm(a), np.linalg.norm(b)
        if na and nb:
            near.append(float(np.dot(a, b) / (na * nb)))
    return round(float(np.mean(near)), 3) if near else None


def groove(env, edges, per=16):
    out = {}
    for name, v in env.items():
        p = pattern(v, edges, per)
        if p is None:
            continue
        out[name] = {"same_bar_to_bar": settled(p), **(shape_of(p) or {})}
    return out
