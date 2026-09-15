"""What happens in a song, measured from the score's own lanes.

Every moment here is read off something already in the .score file - the
53-stem lanes, the beat list, the tempo map, the BTC chords - so this runs
either inside the pipeline or over a finished score, and gives the same
answer both ways.

Nothing is asked of a language model. MOSS does not claim `moments` as a
capability and returned nothing parseable for it on apex after 140s.
"""

BRIGHT = (
    "hh",
    "cymbals",
    "crash",
    "ride",
    "shaker",
    "tambourine",
    "violin",
    "flute",
    "piccolo",
    "synth",
    "keys",
    "piano",
    "digital-piano",
    "bells",
)
PERC = (
    "drums",
    "kick",
    "snare",
    "hh",
    "toms",
    "percussion",
    "clap",
    "cymbals",
    "shaker",
    "tambourine",
    "congas",
    "bongos",
)

ORDER = (
    "drop",
    "breakdown",
    "build",
    "peak",
    "rhythm_change",
    "register_shift",
    "tempo_change",
    "entrance",
    "exit",
)
SHAPE = ("drop", "breakdown", "build")
CAP = {
    "drop": 6,
    "breakdown": 4,
    "build": 4,
    "peak": 1,
    "tempo_change": 4,
    "rhythm_change": 4,
    "register_shift": 4,
}


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
    lanes = [v for v in temporal["stems"].values() if isinstance(v, list) and v]
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
        out.append(
            {
                "i": i,
                "type": "drop",
                "size": round(size, 3),
                "description": "everything arrives at once",
            }
        )
        back = max(0, i - int(round(10.0 / w)))
        run = v[back:i]
        if len(run) >= 6:
            third = len(run) // 3
            climb = _span(run, len(run) - third, len(run)) - _span(run, 0, third)
            if climb >= 0.15:
                out.append(
                    {
                        "i": back,
                        "type": "build",
                        "size": round(climb, 3),
                        "description": "a build into the drop",
                    }
                )
    for size, i in peaks(falls):
        out.append(
            {
                "i": i,
                "type": "breakdown",
                "size": round(size, 3),
                "description": "the track strips back",
            }
        )
    return out


def rolls(temporal, w, tol=4.0):
    if not temporal or not temporal.get("stems"):
        return []
    lanes = [
        v
        for k, v in temporal["stems"].items()
        if isinstance(v, list) and v and any(n in k.lower() for n in PERC)
    ]
    if not lanes:
        return []
    n = min(len(x) for x in lanes)
    raw = [sum(x[i] for x in lanes) / len(lanes) for i in range(n)]
    per = []
    for i in range(n):
        a, b = max(0, i - 1), min(n, i + 2)
        per.append(sum(raw[a:b]) / (b - a))
    top = max(per)
    if top <= 0:
        return []
    per = [x / top for x in per]
    side = max(2, int(round(tol / w)))
    gate = max(0.20, 8.0 * _noise_of(per))
    out = []
    for size, i, pre, post in _steps(per, side, gate):
        if post <= pre:
            continue
        out.append(
            {
                "i": i,
                "type": "build",
                "size": round(min(1.0, size), 3),
                "lead_s": round(side * w, 2),
                "description": "the drums thicken into something",
            }
        )
    return out


def loudest(v):
    if not v:
        return []
    i = max(range(len(v)), key=lambda k: v[k])
    return [
        {
            "i": i,
            "type": "peak",
            "size": 1.0,
            "description": "the loudest the song gets",
        }
    ]


def tempo_changes(grid, w, steady_min=0.35):
    grid = grid or {}
    steady = grid.get("steady")
    if isinstance(steady, (int, float)) and steady < steady_min:
        return []
    segs = grid.get("tempo") or []
    out = []
    for a, b in zip(segs, segs[1:]):
        fa, fb = a.get("bpm"), b.get("bpm")
        if not fa or not fb or abs(fb - fa) / fa < 0.02:
            continue
        out.append(
            {
                "i": int(round((b.get("at_s") or 0) / w)),
                "type": "tempo_change",
                "size": round(min(1.0, abs(fb - fa) / fa), 3),
                "description": f"tempo moves {fa:.0f} to {fb:.0f} bpm",
            }
        )
    return out


def _noise_of(v):
    steps = sorted(abs(v[i + 1] - v[i]) for i in range(len(v) - 1))
    return steps[len(steps) // 2] if steps else 0.0


def _steps(v, side, gate):
    """Where a curve moves to a new level and stays there, biggest first."""
    found = []
    for i in range(side, len(v) - side):
        pre, post = _span(v, i - side, i), _span(v, i, i + side)
        if abs(post - pre) >= gate:
            found.append((abs(post - pre), i, pre, post))
    found.sort(key=lambda x: -x[0])
    kept = []
    for size, i, pre, post in found:
        if any(abs(i - j) < side * 2 for _, j, _, _ in kept):
            continue
        kept.append((size, i, pre, post))
    return kept


def topline(melody, w, n):
    if not melody or n <= 0:
        return []
    live = [[] for _ in range(n)]
    for note in melody:
        try:
            a = int(note["start"] / w)
            b = max(a + 1, int((note["start"] + (note.get("duration") or 0)) / w))
            pitch = float(note["pitch"])
            weight = float(note.get("velocity") or 0.5) * max(
                float(note.get("duration") or 0), 0.05
            )
        except (KeyError, TypeError, ValueError):
            continue
        for i in range(max(0, a), min(n, b)):
            live[i].append((pitch, weight))
    out, last = [], None
    for cell in live:
        if not cell:
            out.append(last)
            continue
        cell.sort()
        total = sum(c[1] for c in cell)
        run, mid = 0.0, cell[-1][0]
        for pitch, weight in cell:
            run += weight
            if run >= total / 2:
                mid = pitch
                break
        out.append(mid)
        last = mid
    seed = next((x for x in out if x is not None), None)
    if seed is None:
        return []
    last, filled = seed, []
    for x in out:
        if x is not None:
            last = x
        filled.append(last)
    return [
        sum(filled[max(0, i - 2) : i + 3]) / len(filled[max(0, i - 2) : i + 3])
        for i in range(len(filled))
    ]


def shifts(melody, w, n, tol=7.0):
    v = topline(melody, w, n)
    if len(v) < 8:
        return []
    side = max(2, int(round(tol / w)))
    gate = max(5.0, 8.0 * _noise_of(v))
    out = []
    for size, i, pre, post in _steps(v, side, gate):
        up = post > pre
        how = "an octave" if size >= 10.5 else f"{int(round(size))} semitones"
        out.append(
            {
                "i": i,
                "type": "register_shift",
                "size": round(min(1.0, size / 12.0), 3),
                "description": ("the music moves up " if up else "the music drops ")
                + how,
            }
        )
    return out


def rhythm_changes(hits, w, n, tol=4.0, z_min=3.0):
    """A half-time turn, a double-time lift, a breakbeat.

    Onsets arrive like a Poisson process, so a stretch of random hits swings
    its own density around by root-n and a plain ratio test cannot tell that
    from a real change: on afterglow it found three either way. The gate here
    is how many standard errors apart the two rates are. Across three songs
    real onset streams reach 4.69, 3.64 and 2.89 while the same counts thrown
    at random reach 2.21, 2.60 and 2.47, so the bar is three."""
    if not hits or n <= 0:
        return []
    count = [0.0] * n
    for h in hits:
        t = h.get("t") if isinstance(h, dict) else h
        if t is None:
            continue
        i = int(float(t) / w)
        if 0 <= i < n:
            count[i] += 1.0
    if sum(count) <= 0:
        return []
    side = max(2, int(round(tol / w)))
    held = side * w
    found = []
    for i in range(side, n - side):
        pre = sum(count[i - side : i]) / held
        post = sum(count[i : i + side]) / held
        if pre <= 0 and post <= 0:
            continue
        se = ((pre + post) / held) ** 0.5
        if se <= 0:
            continue
        z = abs(post - pre) / se
        ratio = post / pre if pre > 1e-6 else 99.0
        if z < z_min or 0.625 < ratio < 1.6:
            continue
        found.append((z, i, pre, post, ratio))
    found.sort(key=lambda x: -x[0])
    kept = []
    for row in found:
        if any(abs(row[1] - k[1]) < side for k in kept):
            continue
        kept.append(row)
    out = []
    for z, i, pre, post, ratio in kept:
        if ratio <= 0.15:
            say = "the beat drops away"
        elif ratio >= 6.0:
            say = "the beat comes back in"
        elif ratio >= 1.7:
            say = "the pulse doubles up"
        elif ratio <= 0.6:
            say = "the pulse halves"
        elif post > pre:
            say = "the rhythm thickens"
        else:
            say = "the rhythm thins out"
        out.append(
            {
                "i": i,
                "type": "rhythm_change",
                "size": round(min(1.0, z / 20.0), 3),
                "description": say,
            }
        )
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
            found.append(
                {
                    "i": i,
                    "what": name,
                    "type": "entrance" if jump > 0 else "exit",
                    "size": round(abs(jump), 3),
                }
            )
    found.sort(key=lambda m: -m["size"])
    kept = []
    for m in found:
        if any(abs(m["i"] - k["i"]) < span and m["what"] == k["what"] for k in kept):
            continue
        kept.append(m)
    return kept


def find(
    temporal,
    beats,
    grid=None,
    chords=None,
    melody=None,
    rhythm=None,
    emotion=None,
    want=32,
    together=1.5,
):
    """Every kind of moment, ranked, with the rare kinds guaranteed room."""
    w, v, noise = energy_curve(temporal)
    n = len(v)
    hits = (rhythm or {}).get("hits") if isinstance(rhythm, dict) else rhythm
    cand = (
        comings(temporal)
        + swings(v, w, noise)
        + loudest(v)
        + rolls(temporal, w)
        + tempo_changes(grid, w)
        + shifts(melody, w, n)
        + rhythm_changes(hits, w, n)
    )
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
        if kind not in CAP:
            continue
        same = sorted(
            [g for g in groups if g["type"] == kind], key=lambda g: -g["size"]
        )[: CAP[kind]]
        picked += same
        taken += same
    rest = sorted(
        [g for g in groups if g["type"] not in CAP and not any(g is t for t in taken)],
        key=lambda g: -g["size"],
    )
    picked = picked + rest[: max(0, want - len(picked))]

    rank = {k: i for i, k in enumerate(ORDER)}
    thinned = []
    for g in sorted(picked, key=lambda x: rank[x["type"]]):
        if g["type"] in SHAPE and any(
            k["type"] in SHAPE and abs(k["t"] - g["t"]) <= together * 2 for k in thinned
        ):
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
        item = {
            "time_s": round(float(g["t"]), 3),
            "type": g["type"],
            "intensity": min(1.0, g["size"]),
            "measured": True,
        }
        lead = g["parts"][0].get("lead_s")
        if lead:
            item["lead_s"] = lead
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
