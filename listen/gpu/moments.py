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
    "spotlight",
    "harmonic_rhythm",
    "rhythm_change",
    "register_shift",
    "tempo_change",
    "vocal_out",
    "vocal_return",
    "melody_resume",
    "entrance",
    "exit",
)
SHAPE = ("drop", "breakdown", "build")
CAP = {
    "drop": 6,
    "breakdown": 4,
    "build": 4,
    "peak": 1,
    "spotlight": 3,
    "harmonic_rhythm": 2,
    "tempo_change": 4,
    "rhythm_change": 4,
    "register_shift": 4,
    "vocal_out": 2,
    "vocal_return": 2,
    "melody_resume": 3,
}

VOICE_ON = 0.25
VOICE_HOLD_S = 2.0
VOICE_QUIET_S = 16.0

FAMILY = (
    ("voice", ("vocal", "lead-vocal", "back-vocal")),
    ("keys", ("piano", "digital-piano", "keys", "harpsichord", "organ", "accordion")),
    ("guitar", ("guitar", "electric-guitar", "acoustic-guitar", "banjo", "mandolin",
                "ukulele", "dobro")),
    ("strings", ("strings", "bowed_strings", "violin", "viola", "cello", "harp")),
    ("winds", ("wind", "woodwind", "flute", "clarinet", "oboe", "bassoon", "harmonica")),
    ("brass", ("brass", "trumpet", "trombone", "french-horn", "saxophone", "tuba")),
    ("low", ("bass", "double-bass")),
    ("tuned percussion", ("marimba", "glockenspiel", "bells", "wind-chimes", "triangle")),
    ("drums", ("drums", "kick", "snare", "hh", "toms", "percussion", "congas", "bongos",
               "cymbals", "shaker", "tambourine", "timpani", "clap")),
)


def energy_curve(temporal, smooth=3, loud=None):
    """How loud the track is over time, and how much of that is jitter.

    The lanes arrive divided by each instrument's own peak, so averaging them
    raw counts how many instruments are near their personal maximum - six
    quiet ones outrank a loud two, and drops, peaks and entrances then land
    off the music. The divisor is the lane's envelope max, not its sample
    peak: the lanes are equal windows, so sqrt(mean(lane^2)) is that stem's
    rms on the normalised scale and stems[name].rms is the same quantity
    absolute, making rms / sqrt(mean(lane^2)) the envelope max exactly.
    stems[name].peak overshoots it by the crest factor, a median 11.7 dB
    and 8.4 dB of spread between stems.

    Scaling a curve onto 0-1 against its own range makes a flat lane look
    like a song: shuffle the lanes and the same rules found more drops than
    the real track did. `noise` is the median step between neighbouring
    windows on that same scale, so a rule can ask for a move that stands out
    against this song's own restlessness rather than a fixed number."""
    if not temporal or not temporal.get("stems"):
        return 0.5, [], 1.0
    w = temporal.get("window_s") or 0.5
    named = [(k, v) for k, v in temporal["stems"].items() if isinstance(v, list) and v]
    if not named:
        return w, [], 1.0
    gain = {k: _heard(loud, k, v) for k, v in named}
    if not any(gain.values()):
        gain = {k: 1.0 for k, _ in named}
    n = min(len(v) for _, v in named)
    total = sum(gain.values()) or 1.0
    raw = [sum(v[i] * gain[k] for k, v in named) / total for i in range(n)]
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


def _heard(loud, name, lane=None):
    at = (loud or {}).get(name)
    if not isinstance(at, dict):
        return 1.0
    rms = at.get("rms")
    if rms and isinstance(lane, list) and lane:
        power = sum(x * x for x in lane) / len(lane)
        if power > 0:
            return rms / (power ** 0.5)
    return at.get("peak") or 0.0


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


def rolls(temporal, w, tol=4.0, loud=None):
    if not temporal or not temporal.get("stems"):
        return []
    named = [
        (k, v)
        for k, v in temporal["stems"].items()
        if isinstance(v, list) and v and any(n in k.lower() for n in PERC)
    ]
    if not named:
        return []
    gain = {k: _heard(loud, k, v) for k, v in named}
    if not any(gain.values()):
        gain = {k: 1.0 for k, _ in named}
    n = min(len(x) for _, x in named)
    total = sum(gain.values()) or 1.0
    raw = [sum(x[i] * gain[k] for k, x in named) / total for i in range(n)]
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
            say = "twice as many hits"
        elif ratio <= 0.6:
            say = "half as many hits"
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


def comings(temporal, tol=2.0, loud=None, floor_db=-40.0):
    if not temporal or not temporal.get("stems"):
        return []
    gainful = {k: _heard(loud, k, v) for k, v in temporal["stems"].items()}
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
                    "heard": round(abs(jump) * gainful.get(name, 1.0), 5),
                }
            )
    if loud:
        top = max((v.get("db") or -99) for v in loud.values() if isinstance(v, dict))
        found = [
            m
            for m in found
            if not isinstance(loud.get(m["what"]), dict)
            or (loud[m["what"]].get("db") or -99) - top >= floor_db
        ]
    rank = sorted({k for k in gainful}, key=lambda k: -gainful[k])[:6]
    firsts = {}
    lasts = {}
    for m in found:
        if m["what"] not in rank:
            continue
        if m["type"] == "entrance":
            if m["what"] not in firsts or m["i"] < firsts[m["what"]]["i"]:
                firsts[m["what"]] = m
        else:
            if m["what"] not in lasts or m["i"] > lasts[m["what"]]["i"]:
                lasts[m["what"]] = m
    for m in list(firsts.values()):
        m["arrival"] = True
    for m in list(lasts.values()):
        m["departure"] = True
    found.sort(
        key=lambda m: (
            not (m.get("arrival") or m.get("departure")),
            -m.get("heard", m["size"]),
        )
    )
    kept = []
    for m in found:
        if any(abs(m["i"] - k["i"]) < span and m["what"] == k["what"] for k in kept):
            continue
        kept.append(m)
    return kept


def family_of(name):
    for fam, members in FAMILY:
        if name in members:
            return fam
    return name


def _voice(temporal):
    """Every vocal-ish lane at once, scaled against the loudest of them.

    One lane is not enough: under-water's lead-vocal lane is silent for 95%
    of the track because its chopped vocal lands in `vocal`, and wetwork and
    strobe have no lead-vocal lane at all."""
    if not temporal or not temporal.get("stems"):
        return 0.5, []
    w = temporal.get("window_s") or 0.5
    lanes = [
        v
        for k, v in temporal["stems"].items()
        if "vocal" in k.lower() and isinstance(v, list) and v
    ]
    if not lanes:
        return w, []
    n = min(len(v) for v in lanes)
    top = [max(v[i] for v in lanes) for i in range(n)]
    hi = max(top)
    if hi <= 0:
        return w, []
    return w, [x / hi for x in top]


def _singing(lane, w, on=VOICE_ON, hold_s=VOICE_HOLD_S):
    """Stretches where the voice is actually carrying, in seconds.

    `on` is a share of the loudest the voice gets in this song, not a fixed
    level, because the lanes are normalised per instrument. A 2s hold throws
    away the blips. Swept against the eleven songs whose first lyric
    timestamp is trustworthy, on=0.25 hold=2.0s lands within 3s on 10."""
    if not lane:
        return []
    act = [x > on for x in lane]
    for i in range(1, len(act) - 1):
        if not act[i] and lane[i - 1] > on and lane[i + 1] > on:
            act[i] = True
    need = max(1, int(round(hold_s / w)))
    out, i = [], 0
    while i < len(act):
        if not act[i]:
            i += 1
            continue
        j = i
        while j < len(act) and act[j]:
            j += 1
        if j - i >= need:
            out.append((i * w, j * w))
        i = j
    return out if sum(b - a for a, b in out) >= 10.0 else []


def voice_gaps(temporal, quiet_s=VOICE_QUIET_S, most=2):
    """The long stretches with no voice, and the voice coming back.

    Corroborates a section boundary 52.2% against an exact per-song chance of
    19.3%, a 2.70x that phase-randomised vocal lanes reach only 1.17x on
    average and 2.22x at best over 40 runs, p=0.024.

    The first and last time the voice is there was measured too and is not
    here: it scores 2.90x, but a phase-randomised lane scores 4.00x, because
    a threshold crossing of any smooth curve lands on a structural swing.
    74% of them were already an `entrance` naming a vocal lane."""
    w, lane = _voice(temporal)
    runs = _singing(lane, w)
    if len(runs) < 2:
        return []
    gaps = [
        (b[0] - a[1], a[1], b[0])
        for a, b in zip(runs, runs[1:])
        if b[0] - a[1] >= quiet_s
    ]
    gaps.sort(key=lambda g: -g[0])
    out = []
    for held, left, back in sorted(gaps[:most], key=lambda g: g[1]):
        size = round(min(1.0, held / 60.0), 3)
        out.append(
            {
                "i": int(round(left / w)),
                "type": "vocal_out",
                "size": size,
                "description": f"the voice leaves for {held:.0f} seconds",
            }
        )
        out.append(
            {
                "i": int(round(back / w)),
                "type": "vocal_return",
                "size": size,
                "description": "the voice is back",
            }
        )
    return out


def melody_returns(melody, w, most=3, apart=6.0):
    """Where the pitched instruments come back after the biggest holes.

    The hole itself is worth nothing: timed at where the gap opens this sits
    dead on its null. Timed at where the notes come back it corroborates
    35.7% against an exact per-song chance of 17.7%, a 2.01x that shuffling
    the inter-onset intervals reaches 1.03x on average, p=0.024. It is the
    one candidate that is not already in the file: 8.9% of these land near an
    existing moment against an 11.8% chance, below it."""
    if not melody or not w:
        return []
    starts = sorted(
        float(n["start"]) for n in melody if isinstance(n.get("start"), (int, float))
    )
    ons = []
    for t in starts:
        if not ons or t - ons[-1] > 0.06:
            ons.append(t)
    if len(ons) < 30:
        return []
    gaps = [(b - a, a, b) for a, b in zip(ons, ons[1:])]
    spans = sorted(b - a for a, b in zip(ons, ons[1:]))
    gate = max(1.5, 4.0 * spans[len(spans) // 2])
    kept = []
    for held, left, back in sorted(gaps, key=lambda g: -g[0]):
        if held < gate:
            break
        if any(abs(back - k[2]) < apart for k in kept):
            continue
        kept.append((held, left, back))
        if len(kept) >= most:
            break
    return [
        {
            "i": int(round(back / w)),
            "type": "melody_resume",
            "size": round(min(1.0, held / 6.0), 3),
            "description": "the instruments come back after "
            + (f"{held:.1f} seconds" if held >= 2 else "a bar of nothing"),
        }
        for held, left, back in sorted(kept, key=lambda g: g[2])
    ]


def spotlight(temporal, loud, hold_s=6.0, ne_max=1.35, base_min=2.0):
    """Where the band drops back and one family of instruments carries alone.

    Energy share per instrument family on absolute levels, fired where the
    effective family count 1/sum(share^2) holds at or under 1.35 for six
    seconds in a song whose median is at least 2. Being a share, it is
    invariant to the mix simply getting louder, which is the property `drop`
    lacks.

    A span only counts if the band was there to drop back from: the window
    before it must have carried a full complement. Without that the rule fires
    on sparse intros, where a lone piano is not the band standing aside - it is
    the band not having started. That was 7 of 39, five of them naming keys
    inside the first half-second.

    42 events on 17 of 29 songs; no run of shuffle, phase, circular-shift or
    AAFT nulls reached that count. Corroborates 45.2% against 17.5%,
    p=0.0003, and the 21 that carry no other moment corroborate hardest at
    52.4%. Named at family level: within keys, piano, keys and digital-piano
    split near-evenly and correlate above 0.99, so the lane name is used only
    when it holds 60% of its family."""
    if not temporal or not temporal.get("stems") or not loud:
        return []
    w = temporal.get("window_s") or 0.5
    named = [(k, v) for k, v in temporal["stems"].items() if isinstance(v, list) and v]
    if not named:
        return []
    n = min(len(v) for _, v in named)
    span = max(4, int(round(hold_s / w)))
    if n < span + 4:
        return []
    gain = {k: _heard(loud, k, v) for k, v in named}
    if not any(gain.values()):
        return []
    power, owner = {}, {}
    for k, v in named:
        fam = family_of(k)
        g = gain[k]
        row = power.setdefault(fam, [0.0] * n)
        mine = owner.setdefault(fam, {}).setdefault(k, [0.0] * n)
        for i in range(n):
            e = (v[i] * g) ** 2
            row[i] += e
            mine[i] = e
    fams = sorted(power)
    roll = {f: [0.0] * (n - span + 1) for f in fams}
    for f in fams:
        run = sum(power[f][:span])
        roll[f][0] = run
        for i in range(1, n - span + 1):
            run += power[f][i + span - 1] - power[f][i - 1]
            roll[f][i] = run
    count, lead = [], []
    for i in range(n - span + 1):
        tot = sum(roll[f][i] for f in fams) or 1e-12
        best, who, acc = 0.0, fams[0], 0.0
        for f in fams:
            share = roll[f][i] / tot
            acc += share * share
            if share > best:
                best, who = share, f
        count.append(1.0 / max(acc, 1e-12))
        lead.append(who)
    base = sorted(count)[len(count) // 2] if count else 0.0
    if base < base_min:
        return []
    out, start = [], None
    for i in range(len(count) + 1):
        live = i < len(count) and count[i] <= ne_max and lead[i] != "drums"
        if live and start is None:
            start = i
        elif not live and start is not None:
            a, b = start, i
            start = None
            if b - a < max(2, span // 3):
                continue
            if a < span:
                continue
            before = count[max(0, a - span) : a]
            if not before or max(before) < base_min:
                continue
            j = min(range(a, b), key=lambda x: count[x])
            fam = lead[j]
            held = {k: sum(v[j : j + span]) for k, v in owner[fam].items()}
            top = max(held, key=held.get)
            share = held[top] / max(sum(held.values()), 1e-12)
            out.append(
                {
                    "i": a,
                    "type": "spotlight",
                    "size": round(min(1.0, (base - count[j]) / max(base - 1.0, 1e-6)), 3),
                    "what": top if share >= 0.6 else fam,
                    "hold_s": round((b - a + span) * w, 1),
                    "description": "everything drops back behind "
                    + (top if share >= 0.6 else "the " + fam),
                }
            )
    out.sort(key=lambda m: -m["size"])
    kept = []
    for m in out:
        if any(abs(m["i"] - k["i"]) < span for k in kept):
            continue
        kept.append(m)
    return sorted(kept, key=lambda m: m["i"])


def chord_turns(chords, join=0.35):
    turns = []
    last = None
    for c in chords or []:
        lab = c.get("chord")
        start = c.get("start")
        end = c.get("end")
        if not lab or lab in ("N", "X") or start is None:
            continue
        start = float(start)
        end = float(end) if end is not None else start
        if last is not None and last[0] == lab and abs(start - last[1]) < join:
            last = (lab, end)
            continue
        turns.append(start)
        last = (lab, end)
    return turns


def harmonic_rhythm(chords, w, n, tol=8.0, need=6, edge=4.0):
    """Where the harmony breaks out of one held chord into motion.

    Corroborates 45.0% against 17.6%, p=0.0042, where the identical detector
    run on a time-rotated chord track reaches 15.4%. Monotone in the
    threshold - 5 gives 34.5%, 6 gives 45.0%, 7 gives 53.8% - so it is not
    one lucky cell. Half of them carry another moment, but of entrance,
    register_shift and exit, not rhythm_change: it is not a second name for
    the drums getting busier.

    The generic form of this rule, any step in chord rate, is not here: it
    corroborates 20.0% against 17.6%, which is chance. Only the held-chord
    side carries. The split was found on these 29 songs, so 45% is the number
    to confirm on held-out songs, not to quote as settled."""
    turns = chord_turns(chords)
    if len(turns) < 6 or not n or n <= 0:
        return []
    dur = n * w
    found = []
    for t in turns:
        if t < max(edge, tol) or t > dur - max(edge, tol):
            continue
        pre = sum(1 for x in turns if t - tol <= x < t)
        post = sum(1 for x in turns if t <= x < t + tol)
        if pre == 0 and post >= need:
            found.append((post, t))
    found.sort(key=lambda x: -x[0])
    kept = []
    for post, t in found:
        if any(abs(t - k[1]) < tol for k in kept):
            continue
        kept.append((post, t))
    return [
        {
            "i": int(round(t / w)),
            "type": "harmonic_rhythm",
            "size": round(min(1.0, post / 12.0), 3),
            "description": "the harmony breaks out of one held chord",
        }
        for post, t in sorted(kept, key=lambda k: k[1])
    ]


def _names_of(g):
    out = []
    for part in g["parts"]:
        if part.get("what"):
            out.append(part["what"])
    return out


def _no_contradictions(picked, together):
    """Two moments cannot both be true of the same instant.

    A drop and a spotlight at one time say everything arrived and everything
    stood back. An entrance and an exit of one instrument two seconds apart is
    a lane flickering over its own threshold, not the player leaving. Measured
    over 29 songs: 10 same-instrument flickers on 8 songs, and one drop landing
    on a spotlight."""
    drop_like = {"drop", "build"}
    thin_like = {"spotlight", "breakdown"}
    out = []
    for g in sorted(picked, key=lambda x: (x["t"], -x["size"])):
        clash = None
        for k in out:
            if abs(k["t"] - g["t"]) > together:
                continue
            pair = {k["type"], g["type"]}
            if len(pair) == 2 and pair & drop_like and pair & thin_like:
                clash = k
                break
            if pair == {"entrance", "exit"}:
                if set(_names_of(k)) & set(_names_of(g)):
                    clash = k
                    break
        if clash is None:
            out.append(g)
        elif g["size"] > clash["size"]:
            out[out.index(clash)] = g
    return sorted(out, key=lambda x: x["t"])


def find(
    temporal,
    beats,
    grid=None,
    chords=None,
    melody=None,
    rhythm=None,
    emotion=None,
    stems=None,
    want=32,
    together=1.5,
):
    """Every kind of moment, ranked, with the rare kinds guaranteed room."""
    w, v, noise = energy_curve(temporal, loud=stems)
    n = len(v)
    hits = (rhythm or {}).get("hits") if isinstance(rhythm, dict) else rhythm
    cand = (
        comings(temporal, loud=stems)
        + swings(v, w, noise)
        + loudest(v)
        + rolls(temporal, w, loud=stems)
        + tempo_changes(grid, w)
        + shifts(melody, w, n)
        + rhythm_changes(hits, w, n)
        + spotlight(temporal, stems)
        + harmonic_rhythm(chords, w, n)
        + voice_gaps(temporal)
        + melody_returns(melody, w)
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

    voiced = [g for g in groups if g["type"] in ("vocal_out", "vocal_return")]
    if voiced:
        groups = [
            g
            for g in groups
            if g["type"] not in ("entrance", "exit")
            or not any(
                p.get("what") and "vocal" in p["what"].lower() for p in g["parts"]
            )
            or not any(abs(g["t"] - h["t"]) <= together for h in voiced)
        ]

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
        key=lambda g: (
            not any(p.get("arrival") or p.get("departure") for p in g["parts"]),
            -g["size"],
        ),
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

    picked = _no_contradictions(picked, together)

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
        span = g["parts"][0].get("hold_s")
        if span:
            item["hold_s"] = span
        if names and g["type"] not in one:
            item["what"] = names[0]
            item["description"] = g["parts"][0].get("description", g["type"])
        elif names:
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
