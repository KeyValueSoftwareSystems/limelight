import numpy as np

ON = 0.15
SURE = 0.45
OFF = 0.10
HOLD = 2
NAMES = ("drums", "bass", "vocals", "other")


SAY = {"drums": "drums", "bass": "bass", "vocals": "voice",
       "guitar": "guitar", "piano": "piano", "other": "chords"}


def at(bar, pickup):
    return max(0, int(bar))


def steady(v, on=ON, off=OFF, hold=HOLD):
    state = v[0] > on
    out = np.zeros(len(v), dtype=bool)
    out[0] = state
    for i in range(1, len(v)):
        want = state
        if state and v[i] < off:
            want = False
        elif not state and v[i] > on:
            want = True
        if want != state:
            ahead = v[i:i + hold]
            keeps = (ahead > on).all() if want else (ahead < off).all()
            if len(ahead) >= hold and keeps:
                state = want
        out[i] = state
    return out


def layers(lanes, pickup):
    out = []
    for name in NAMES:
        on = steady(np.asarray(lanes[name], dtype=float))
        for i in range(1, len(on)):
            v = np.asarray(lanes[name], dtype=float)
            weak = name == "vocals" and v[i:i + 4].mean() < SURE
            label = "lead" if weak else SAY[name]
            if on[i] and not on[i - 1]:
                out.append({"bar": at(i, pickup), "beat": 1, "is": f"{label} in",
                            "strength": round(float(min(1.0, v[i:i + 4].mean())), 3)})
            elif on[i - 1] and not on[i]:
                out.append({"bar": at(i, pickup), "beat": 1, "is": f"{label} out",
                            "strength": round(float(min(1.0, v[max(0, i - 4):i].mean())), 3)})
    return out


def dips(lanes, pickup, most=2, deep=0.55):
    out = []
    for name in NAMES:
        v = np.asarray(lanes[name], dtype=float)
        i = 1
        while i < len(v) - 1:
            if v[i - 1] <= ON:
                i += 1
                continue
            j = i
            while j < len(v) - 1 and v[j] < deep * v[i - 1]:
                j += 1
            run = j - i
            if 1 <= run <= most and v[j] > ON and v[j] >= deep * v[i - 1]:
                out.append({"bar": at(i, pickup), "beat": 1,
                            "is": f"{SAY[name]} pause",
                            "for_bars": int(run),
                            "strength": round(float(1.0 - v[i] / (v[i - 1] or 1)), 3)})
                i = j
            i += 1
    return out


def silences(busy, lanes, pickup):
    v = np.asarray(busy, dtype=float).ravel()
    floor = float(np.percentile(v, 8))
    ceiling = float(np.percentile(v, 92))
    if ceiling - floor < 1e-6:
        return []
    thin = (v - floor) / (ceiling - floor) < 0.12
    out, i = [], 1
    while i < len(thin):
        if thin[i] and not thin[i - 1]:
            j = i
            while j < len(thin) and thin[j]:
                j += 1
            if j - i <= 4 and j < len(thin):
                left = []
                for name in NAMES:
                    lane = np.asarray(lanes[name], dtype=float)
                    if i < len(lane) and lane[i:j].mean() > ON:
                        left.append(name)
                if not left:
                    what = "all stops"
                elif len(left) == 1:
                    what = f"only {SAY[left[0]]} left"
                else:
                    what = "only " + " + ".join(SAY[x] for x in left) + " left"
                out.append({"bar": at(i, pickup), "beat": 1, "is": what,
                            "for_bars": int(j - i), "leaves": left,
                            "strength": round(float(1.0 - (v[i:j].mean() - floor) /
                                                    max(ceiling - floor, 1e-6)), 3)})
            i = j
        else:
            i += 1
    return out


def subject_of(what):
    if what.startswith("all stops") or what.startswith("only "):
        return "all"
    for name in NAMES:
        if what.startswith(SAY[name]):
            return SAY[name]
    return "it"


def returns(breaks, lanes, onsets, grid, look=4):
    period = 60.0 / grid["bpm"]
    bar_s = period * grid["beats_per_bar"]
    out = []
    for b in breaks:
        back = b["bar"] + b.get("for_bars", 1)
        when = grid["first_beat_s"] + (back - 1) * bar_s
        near = [o for o in onsets if when - 0.12 <= o <= when + period * 2]
        if near:
            k = round((near[0] - grid["first_beat_s"]) / period)
            bar = k // grid["beats_per_bar"] + 1
            beat = k % grid["beats_per_bar"] + 1
        else:
            bar, beat = back, 1
        busier = 0.0
        for name in NAMES:
            v = np.asarray(lanes[name], dtype=float)
            lo = max(0, b["bar"] - look)
            hi = min(len(v), back + look)
            if b["bar"] - lo < 2 or hi - back < 2:
                continue
            busier += float(v[back:hi].mean() - v[lo:b["bar"]].mean())
        who = subject_of(b["is"])
        out.append({"bar": max(0, int(bar)), "beat": int(beat),
                    "is": f"{who} back, bigger" if busier > 0.05 else f"{who} back",
                    "after": b["is"],
                    "strength": round(float(min(1.0, abs(busier) * 3)), 3)})
    return out


def swells(lanes, pickup, span=8, least=4, gain=0.30):
    out = []
    for name in NAMES:
        v = np.asarray(lanes[name], dtype=float)
        i = max(1, pickup)
        while i < len(v) - least:
            best = None
            for width in range(least, span + 1):
                j = i + width
                if j >= len(v):
                    break
                move = v[j] - v[i]
                steps = np.diff(v[i:j + 1])
                same = float((steps > 0).mean() if move > 0 else (steps < 0).mean())
                if abs(move) > gain and same > 0.6 and max(v[i], v[j]) > ON:
                    if best is None or abs(move) > abs(best[1]):
                        best = (j, move, same)
            if best is None:
                i += 1
                continue
            j, move, _ = best
            out.append({"bar": at(i, pickup), "beat": 1,
                        "is": f"{SAY[name]} {'swells' if move > 0 else 'fades'}",
                        "for_bars": int(j - i),
                        "strength": round(float(min(1.0, abs(move) * 1.5)), 3)})
            i = j
    return out


def risers(bright, lanes, pickup, least=3):
    v = np.asarray(bright, dtype=float).ravel()
    drums = np.asarray(lanes["drums"], dtype=float)
    GATE = ON
    n = min(len(v), len(drums))
    out, i = [], 1
    while i < n - least:
        if drums[i] > GATE:
            i += 1
            continue
        j = i
        while j + 1 < n and v[j + 1] > v[j] + 0.004 and drums[j] <= GATE:
            j += 1
        if j - i >= least and v[j] - v[i] > 0.06:
            out.append({"bar": at(i, pickup), "beat": 1,
                        "is": "riser",
                        "for_bars": int(j - i + 1),
                        "strength": round(float(min(1.0, (v[j] - v[i]) * 4)), 3)})
            i = j
        i += 1
    return out


def begins(env, grid, rate=100, hold=0.5):
    best = None
    for name in NAMES:
        v = np.asarray(env[name], dtype=float)
        top = np.percentile(v, 95) or 1.0
        v = v / top
        need = int(hold * rate)
        for i in range(len(v) - need):
            if (v[i:i + need] > 0.12).all():
                t = i / rate
                best = t if best is None else min(best, t)
                break
    if best is None:
        return []
    period = 60.0 / grid["bpm"]
    k = round((best - grid["first_beat_s"]) / period)
    bar = k // grid["beats_per_bar"] + 1
    beat = k % grid["beats_per_bar"] + 1
    return [{"bar": max(0, int(bar)), "beat": int(beat),
             "is": "song starts", "strength": 1.0}]


def leads_to(lanes, bar, look=4):
    best, name, size = "nothing changes", None, 0.0
    for lane in NAMES:
        v = np.asarray(lanes[lane], dtype=float)
        lo, hi = max(0, bar - look), min(len(v), bar + 1 + look)
        if bar - lo < 2 or hi - (bar + 1) < 2:
            continue
        change = float(v[bar + 1:hi].mean() - v[lo:bar].mean())
        if abs(change) > abs(size):
            size, name = change, lane
    if name is not None and abs(size) > 0.05:
        best = f"{name} {'grows' if size > 0 else 'thins'} after"
    return best


def events(grid, lanes, busy, bright, onsets, pickup, report=None, env=None):
    quiet = silences(busy, lanes, pickup)
    broken = quiet + dips(lanes, pickup)
    out = layers(lanes, pickup) + broken + risers(bright, lanes, pickup) + swells(lanes, pickup)
    out += returns(broken, lanes, onsets, grid)
    if env is not None:
        out += begins(env, grid)
    for e in out:
        if e.get("for_bars") and "riser" not in e["is"]:
            e["then"] = leads_to(lanes, e["bar"])
    out = [e for e in out if e["bar"] >= 0]
    for e in out:
        e.setdefault("strength", 0.5)
        e["strength"] = round(max(0.0, min(1.0, e["strength"])), 3)
    out.sort(key=lambda e: (e["bar"], e["beat"], -e["strength"]))
    if report is not None:
        report["events"] = len(out)
        report["event_kinds"] = sorted({e["is"] for e in out})
    return out
