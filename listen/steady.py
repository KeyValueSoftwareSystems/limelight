import numpy as np

LEAST = 4
FEW = 3


def _clean(values):
    return np.array([np.nan if v is None else v for v in values], dtype=float)


def tells(values, parts, first_bar):
    if not isinstance(values, (list, tuple)) or len(values) < LEAST:
        return None
    v = _clean(values)
    within, middles = [], []
    for part in parts:
        a = max(0, part["from_bar"] - first_bar)
        b = min(len(v), part["to_bar"] - first_bar + 1)
        piece = v[a:b]
        piece = piece[np.isfinite(piece)]
        if piece.size < LEAST:
            continue
        half = piece.size // 2
        within.append(abs(float(piece[:half].mean()) - float(piece[half:].mean())))
        middles.append(float(piece.mean()))
    if len(middles) < FEW:
        return None
    apart = [abs(middles[i] - middles[j])
             for i in range(len(middles)) for j in range(i + 1, len(middles))]
    noise = float(np.mean(within))
    if noise < 1e-9:
        return None
    return round(float(np.mean(apart)) / noise, 2)


def all_tells(bars, parts, first_bar):
    out = {}
    for name, values in (bars or {}).items():
        if name.endswith("_sure") or name == "chord":
            continue
        got = tells(values, parts, first_bar)
        if got is not None:
            out[name] = got
    return out
