"""What happens in a song, measured from the score's own lanes.

Every moment here is read off something already in the .score file - the
53-stem lanes, the beat list, the tempo map, the BTC chords - so this runs
either inside the pipeline or over a finished score, and gives the same
answer both ways.

Nothing is asked of a language model. MOSS does not claim `moments` as a
capability and returned nothing parseable for it on apex after 140s.
"""

BRIGHT = ("hh", "cymbals", "crash", "ride", "shaker", "tambourine", "violin",
          "flute", "piccolo", "synth", "keys", "piano", "digital-piano", "bells")
PERC = ("drums", "kick", "snare", "hh", "toms", "percussion", "clap", "cymbals",
        "shaker", "tambourine", "congas", "bongos")

ORDER = ("drop", "stop", "breakdown", "build", "peak", "tempo_change",
         "key_change", "entrance", "exit")
SHAPE = ("drop", "stop", "breakdown", "build", "peak")
FLOOR = {"drop": 6, "stop": 4, "breakdown": 4, "build": 4, "peak": 1,
         "tempo_change": 4, "key_change": 3}


def energy_curve(temporal, smooth=3):
    """The song's own loudness shape, plus how much of it is jitter.

    Scaling a curve onto 0-1 against its own range makes a flat lane look
    like a song: shuffle the lanes and the same rules found more drops than
    the real track did. `noise` is the median step between neighbouring
    windows on that same scale, so a rule can ask for a move that stands out
    against this song's own restlessness rather than a fixed number."""
    if not temporal or not temporal.get("stems"):
        return 0.5, [], 1.0
    w = temporal.get("window_s") or 0.5
    lanes = [v for v in temporal["stems"].values()
             if isinstance(v, list) and v]
    if not lanes:
        return w, [], 1.0
    n = min(len(v) for v in lanes)
    raw = [sum(v[i] for v in lanes) / len(lanes) for i in range(n)]
    half = smooth // 2
    out = []
    for i in range(n):
        a, b = max(0, i - half), min(n, i + half + 1)
        out.append(sum(raw[a:b]) / (b - a))
    lo, hi = min(out), max(out)
    if hi - lo < 1e-9:
        return w, [], 1.0
    v = [(x - lo) / (hi - lo) for x in out]
    steps = sorted(abs(v[i + 1] - v[i]) for i in range(len(v) - 1))
    noise = steps[len(steps) // 2] if steps else 1.0
    return w, v, noise


def _span(v, a, b):
    a, b = max(0, a), min(len(v), b)
    return sum(v[a:b]) / (b - a) if b > a else 0.0


def swings(v, w, noise=0.0):
    """Drops, breakdowns and the builds that lead into them."""
    if not v:
        return []
    gate = max(0.35, 8.0 * noise)
    side = max(2, int(round(2.0 / w)))
    hold = max(2, int(round(4.0 / w)))
    rises, falls = [], []
    for i in range(side, len(v) - side):
        pre, post = _span(v, i - side, i), _span(v, i, i + side)
        if post - pre >= gate and post >= 0.60:
            rises.append((post - pre, i))
        if pre - post >= gate and post <= 0.45 and _span(v, i, i + hold) <= 0.50:
            falls.append((pre - post, i))

    def peaks(cand):
        cand.sort(key=lambda x: -x[0])
        kept = []
        for size, i in cand:
            if any(abs(i - j) < side * 2 for _, j in kept):
                continue
            kept.append((size, i))
        return kept

    out = []
    for size, i in peaks(rises):
        out.append({"i": i, "type": "drop", "size": round(size, 3),
                    "description": "everything arrives at once"})
        back = max(0, i - int(round(10.0 / w)))
        run = v[back:i]
        if len(run) >= 6:
            third = len(run) // 3
            climb = _span(run, len(run) - third, len(run)) - _span(run, 0, third)
            if climb >= 0.15:
                out.append({"i": back, "type": "build", "size": round(climb, 3),
                            "description": "a build into the drop"})
    for size, i in peaks(falls):
        out.append({"i": i, "type": "breakdown", "size": round(size, 3),
                    "description": "the track strips back"})
    return out


def stops(v, w, noise=0.0):
    """Near-silence that lasts a beat or two and then does not."""
    if not v:
        return []
    gate = max(0.40, 8.0 * noise)
    lo = max(1, int(round(0.4 / w)))
    hi = max(lo, int(round(3.0 / w)))
    edge = max(2, int(round(1.5 / w)))
    out, i = [], edge
    while i < len(v) - edge:
        if v[i] > 0.12:
            i += 1
            continue
        j = i
        while j < len(v) - edge and v[j] <= 0.12:
            j += 1
        if lo <= j - i <= hi and _span(v, i - edge, i) >= gate \
                and _span(v, j, j + edge) >= gate:
            out.append({"i": i, "type": "stop",
                        "size": round(_span(v, i - edge, i), 3),
                        "description": "everything cuts out"})
        i = j + 1
    return out


def loudest(v):
    if not v:
        return []
    i = max(range(len(v)), key=lambda k: v[k])
    return [{"i": i, "type": "peak", "size": 1.0,
             "description": "the loudest the song gets"}]


def tempo_changes(grid, w):
    segs = (grid or {}).get("tempo") or []
    out = []
    for a, b in zip(segs, segs[1:]):
        fa, fb = a.get("bpm"), b.get("bpm")
        if not fa or not fb or abs(fb - fa) / fa < 0.02:
            continue
        out.append({"i": int(round((b.get("at_s") or 0) / w)),
                    "type": "tempo_change",
                    "size": round(min(1.0, abs(fb - fa) / fa), 3),
                    "description": f"tempo moves {fa:.0f} to {fb:.0f} bpm"})
    return out


def key_changes(chords, w, window_s=30.0, step_s=10.0):
    """The root the harmony sits on, and where it moves and stays moved."""
    spans = [c for c in (chords or [])
             if isinstance(c, dict) and str(c.get("chord", "N")) != "N"
             and isinstance(c.get("start"), (int, float))]
    if len(spans) < 4:
        return []
    end = max(c["end"] for c in spans)
    marks = []
    t = 0.0
    while t + window_s <= end + step_s:
        held = {}
        for c in spans:
            ov = min(t + window_s, c["end"]) - max(t, c["start"])
            if ov > 0:
                root = str(c["chord"]).split(":")[0].rstrip("m")
                held[root] = held.get(root, 0.0) + ov
        if held:
            marks.append((t, max(held.items(), key=lambda kv: kv[1])[0]))
        t += step_s
    out = []
    for k in range(1, len(marks) - 1):
        was, now = marks[k - 1][1], marks[k][1]
        if now == was or marks[k + 1][1] != now:
            continue
        if out and marks[k][0] - out[-1]["at_s"] < window_s:
            continue
        out.append({"i": int(round(marks[k][0] / w)), "at_s": marks[k][0],
                    "type": "key_change", "size": 0.5,
                    "description": f"the harmony moves from {was} to {now}"})
    for m in out:
        m.pop("at_s", None)
    return out


def comings(temporal, tol=2.0):
    if not temporal or not temporal.get("stems"):
        return []
    w = temporal.get("window_s") or 0.5
    span = max(1, int(round(tol / w)))
    found = []
    for name, v in temporal["stems"].items():
        if not isinstance(v, list) or len(v) < span * 3:
            continue
        for i in range(span, len(v) - span):
            pre, post = _span(v, i - span, i), _span(v, i, i + span)
            jump = post - pre
            if abs(jump) < 0.25:
                continue
            if jump > 0 and pre > 0.12:
                continue
            if jump < 0 and post > 0.12:
                continue
            found.append({"i": i, "what": name,
                          "type": "entrance" if jump > 0 else "exit",
                          "size": round(abs(jump), 3)})
    found.sort(key=lambda m: -m["size"])
    kept = []
    for m in found:
        if any(abs(m["i"] - k["i"]) < span and m["what"] == k["what"] for k in kept):
            continue
        kept.append(m)
    return kept


def find(temporal, beats, grid=None, chords=None, want=28, together=1.5):
    """Every kind of moment, ranked, with the rare kinds guaranteed room."""
    w, v, noise = energy_curve(temporal)
    cand = (comings(temporal) + swings(v, w, noise) + stops(v, w, noise)
            + loudest(v) + tempo_changes(grid, w) + key_changes(chords, w))
    if not cand:
        return []
    for m in cand:
        m["t"] = m["i"] * w
    if beats:
        for m in cand:
            near = min(beats, key=lambda b: abs(b - m["t"]))
            if abs(near - m["t"]) < 1.0:
                m["t"] = near

    groups = []
    for m in sorted(cand, key=lambda x: (x["t"], -x["size"])):
        hit = None
        for g in groups:
            if g["type"] == m["type"] and abs(g["t"] - m["t"]) <= together:
                hit = g
                break
        if hit is None:
            groups.append({"t": m["t"], "type": m["type"], "parts": [m]})
        else:
            hit["parts"].append(m)
    for g in groups:
        g["parts"].sort(key=lambda x: -x["size"])
        g["size"] = g["parts"][0]["size"]

    picked, taken = [], []
    for kind in ORDER:
        if kind not in FLOOR:
            continue
        same = sorted([g for g in groups if g["type"] == kind],
                      key=lambda g: -g["size"])[:FLOOR[kind]]
        picked += same
        taken += same
    rest = sorted([g for g in groups if not any(g is t for t in taken)],
                  key=lambda g: -g["size"])
    picked = picked[:want] + rest[:max(0, want - len(picked))]

    rank = {k: i for i, k in enumerate(ORDER)}
    thinned = []
    for g in sorted(picked, key=lambda x: rank[x["type"]]):
        if g["type"] in SHAPE and any(
                k["type"] in SHAPE and abs(k["t"] - g["t"]) <= together * 2
                for k in thinned):
            continue
        thinned.append(g)
    picked = thinned

    one = {"entrance": "enters", "exit": "drops out"}
    many = {"entrance": "enter", "exit": "drop out"}
    out = []
    for g in sorted(picked[:want], key=lambda x: x["t"]):
        names = []
        for part in g["parts"]:
            if part.get("what") and part["what"] not in names:
                names.append(part["what"])
        item = {"time_s": round(float(g["t"]), 3), "type": g["type"],
                "intensity": min(1.0, g["size"]), "measured": True}
        if names:
            if len(names) == 1:
                who = names[0]
            elif len(names) <= 3:
                who = ", ".join(names[:-1]) + " and " + names[-1]
            else:
                who = ", ".join(names[:3]) + f" and {len(names) - 3} more"
            verb = one if len(names) == 1 else many
            item["what"] = names[0]
            item["description"] = f"{who} {verb[g['type']]}"
            if len(names) > 1:
                item["with"] = names[1:]
        else:
            item["description"] = g["parts"][0].get("description", g["type"])
        out.append(item)
    return out
