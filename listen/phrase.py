import numpy as np

SURE = 0.45
LANES = ("drums", "bass", "vocals", "other")
SAY = {"drums": "drums", "bass": "bass", "vocals": "voice", "other": "chords"}
BIG = {"entrance", "exit", "release", "accent", "fill", "pause", "hook"}
KEEP = 0.35


def lift(x):
    x = np.asarray([v if v is not None else 0.0 for v in x], dtype=float)
    top = float(np.percentile(x, 98)) or 1.0
    return np.clip(x / top, 0.0, 1.5)


def cut(a, b, every, origin, least=3, firm=()):
    edges = [a]
    step = max(2, int(every))
    first = a + ((origin - a) % step)
    if first > a and first - a >= least:
        edges.append(first)
    at = first if first > a else a + step
    while at < b:
        if at - edges[-1] >= least:
            edges.append(at)
        at += step
    for f in sorted(firm):
        if a + least <= f <= b - least and all(abs(f - e) >= least for e in edges):
            edges.append(f)
    edges = sorted(set(edges))
    edges.append(b)
    edges = sorted(set(edges))
    out = []
    for i in range(len(edges) - 1):
        if edges[i + 1] - edges[i] >= least:
            out.append((edges[i], edges[i + 1]))
        elif out:
            out[-1] = (out[-1][0], edges[i + 1])
    return out or [(a, b)]


def doing(now, was, ceiling, mid, opens, last, tail, here):
    wide, gone = now["adds"], now["drops"]
    rise, air, energy = now["rise"], now["air"], now["energy"]
    moved = wide + gone
    drive = now["drive"]
    score = {
        "intensifying": min(1.0, max(0.0, drive) / 0.28),
        "easing": min(1.0, max(0.0, -drive) / 0.28),
        "expanding": min(1.0, wide / 2.0) * 0.95,
        "thinning": min(1.0, gone / 2.0) * 0.95,
        "peaking": (0.95 * min(1.0, energy / max(ceiling, 1e-6))
                    if energy >= ceiling * 0.85 and abs(rise) < 0.18 else 0.0),
        "sustaining": (max(0.0, 1.0 - abs(drive) / 0.20) * 0.70
                       if energy > mid * 0.5 and moved == 0 else 0.0),
        "establishing": 0.85 if was is None else 0.0,
        "developing": 0.55 if now["turns"] and abs(drive) < 0.15 else 0.0,
        "suspending": (min(1.0, now["quiet_share"] / 0.30) * 0.9
                       if now["quiet_share"] > 0.12 else 0.0),
        "resolving": 0.8 if now["releases"] else 0.0,
        "transitioning": (0.75 if last and moved and (drive > 0.08 or air > 0.12)
                          else 0.0),
        "closing": 0.95 if tail and (energy < mid * 0.6 or rise < -0.15) else 0.0,
    }
    order = sorted(score.items(), key=lambda kv: -kv[1])
    head = order[0][0] if order[0][1] > 0 else "sustaining"
    also = [k for k, v in order[1:] if v >= KEEP and v > 0]
    return head, also[:2], round(float(order[0][1]), 3)


def lasts(lane, m, pickup, least=3):
    want = {"drums": "drums", "bass": "bass", "voice": "vocals",
            "chords": "other"}.get(m.get("what"), m.get("what"))
    v = lane.get(want)
    if v is None:
        return False
    at = m["bar"] - 1 + pickup
    after = v[at:at + least]
    before = v[max(0, at - least):at]
    if len(after) < least or not len(before):
        return False
    on = m["is"] == "entrance"
    held = (after > SURE).all() if on else (after < SURE).all()
    was = (before < SURE).all() if on else (before > SURE).all()
    return bool(held and was)


def says(was, now, notes):
    came = [SAY.get(k, k) for k in now if k not in (was or [])]
    left = [SAY.get(k, k) for k in (was or []) if k not in now]
    if notes.get("broke") and not came and not left:
        return "a bar out, then back"
    if came and left:
        return f"{' and '.join(came)} in, {' and '.join(left)} out"
    if came:
        return f"{' and '.join(came)} join"
    if left:
        return f"{' and '.join(left)} drop out"
    if not now:
        return "bare"
    return f"{' and '.join(SAY.get(k, k) for k in now)} holding"


def phrases(spans, bars, moments, every, origin, pickup):
    loud = lift(bars["intensity"])
    air = lift(bars.get("air") or bars["intensity"])
    step = lift(bars.get("pace") or bars["intensity"])
    lane = {k: lift(bars[k]) for k in LANES}
    song_mid = float(np.median(loud))

    raw, was = [], None
    for si, (a, b, role, nth) in enumerate(spans):
        piece = loud[a:b]
        if not len(piece):
            continue
        ceiling = float(piece.max()) or 1.0
        firm = [m["bar"] - 1 + pickup for m in moments
                if m["is"] in ("entrance", "exit") and m.get("sure", 0) >= 0.7
                and lasts(lane, m, pickup, 3)]
        cuts = cut(a, b, every, origin - 1 + pickup, firm=firm)
        for seat, (lo, hi) in enumerate(cuts):
            bit = loud[lo:hi]
            if not len(bit):
                continue
            broke = False
            if len(bit) >= 4:
                mid = float(np.median(bit))
                low = int(np.argmin(bit))
                if mid > 0 and bit[low] < mid * 0.40:
                    bit = np.delete(bit, low)
                    broke = True
            third = max(1, len(bit) // 3)
            playing = [k for k in LANES if float(lane[k][lo:hi].mean()) > SURE]
            inside = [m for m in moments
                      if lo - pickup + 1 <= m["bar"] <= hi - pickup]
            airbit = air[lo:hi]
            stepbit = step[lo:hi]
            def slope(v):
                if len(v) < 2:
                    return 0.0
                k = max(1, len(v) // 3)
                return float(v[-k:].mean() - v[:k].mean())
            climb = float(bit[-third:].mean() - bit[:third].mean())
            now = {
                "energy": float(bit.mean()),
                "rise": climb,
                "drive": 0.45 * climb + 0.30 * slope(stepbit) + 0.25 * slope(airbit),
                "air": float(airbit[-max(1, len(airbit) // 3):].mean()
                             - airbit[:max(1, len(airbit) // 3)].mean()),
                "adds": len([k for k in playing if k not in (was or [])]),
                "drops": len([k for k in (was or []) if k not in playing]),
                "turns": any(m["is"] == "change" for m in inside),
                "quiet_share": float((bit < max(bit.max(), 1e-6) * 0.45).mean()),
                "releases": any(m["is"] == "release" for m in inside),
                "fills": any(m["is"] in ("fill", "rise") for m in inside),
            }
            head, also, sure = doing(
                now, was, ceiling, song_mid, None,
                seat == len(cuts) - 1, si == len(spans) - 1, None)
            raw.append({
                "from_bar": lo + 1 - pickup, "to_bar": hi - pickup,
                "in": role, "in_nth": nth,
                "doing": head, "also": also, "sure": sure,
                "says": says(was, playing, {"broke": broke}),
                "energy": round(now["energy"], 3),
                "rise": round(now["rise"], 3),
                "playing": playing,
                "moments": len([m for m in inside if m["is"] in BIG]),
                "has_break": broke,
            })
            was = playing

    out = []
    for p in raw:
        if (out and out[-1]["in"] == p["in"] and out[-1]["in_nth"] == p["in_nth"]
                and out[-1]["doing"] == p["doing"]
                and out[-1]["playing"] == p["playing"]):
            last = out[-1]
            last["to_bar"] = p["to_bar"]
            last["moments"] += p["moments"]
            last["has_break"] = last["has_break"] or p["has_break"]
            last["energy"] = round((last["energy"] + p["energy"]) / 2, 3)
            last["sure"] = max(last["sure"], p["sure"])
        else:
            out.append(p)
    return out
