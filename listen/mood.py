FLOOR = 1.3
LEAST = 2


def _mean(vals, n):
    return [sum(v[k] for v in vals) / len(vals) for k in range(n)]


def seats_of(at_bar, parts, pickup=0):
    out = []
    for part in parts:
        a, b = part["from_bar"] + pickup, part["to_bar"] + pickup
        out.append([i for i, bar in enumerate(at_bar) if a <= bar <= b])
    return out


def moods(got, parts, pickup=0, floor=FLOOR):
    rows = got.get("rows") or []
    names = got.get("axes") or []
    at_bar = got.get("at_bar") or []
    if not rows or not names:
        return None, {}
    n = len(names)
    seats = seats_of(at_bar, parts, pickup)
    middles, within, spread = [], [], []
    for take in seats:
        if not take:
            middles.append(None)
            continue
        vals = [rows[i] for i in take]
        mid = _mean(vals, n)
        middles.append(mid)
        if len(vals) >= LEAST:
            half = len(vals) // 2
            one, two = _mean(vals[:half], n), _mean(vals[half:], n)
            within.append([abs(one[k] - two[k]) for k in range(n)])
            spread.append(mid)
    sure = {}
    if len(within) >= 3 and len(spread) >= 3:
        noise = _mean(within, n)
        pairs = [(i, j) for i in range(len(spread)) for j in range(i + 1, len(spread))]
        signal = [sum(abs(spread[i][k] - spread[j][k]) for i, j in pairs) / len(pairs)
                  for k in range(n)]
        sure = {names[k]: round(signal[k] / max(noise[k], 1e-9), 2) for k in range(n)}
    keep = [k for k in range(n) if sure.get(names[k], 0.0) >= floor]
    if not keep:
        return [None] * len(parts), {}
    seen = [m for m in middles if m]
    mean = _mean(seen, n)
    reach = [max(m[k] for m in seen) - min(m[k] for m in seen) for k in range(n)]
    out = []
    for mid in middles:
        if not mid:
            out.append(None)
            continue
        out.append({names[k]: round((mid[k] - mean[k]) / reach[k], 3)
                    for k in keep if reach[k] > 1e-9})
    return out, {names[k]: sure[names[k]] for k in keep}
