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
    "pause",
    "register_shift",
    "tempo_change",
    "vocal_out",
    "vocal_return",
    "melody_resume",
    "entrance",
    "exit",
)
SHAPE = ("drop", "breakdown", "build")
LEADS = ("peak", "drop", "pause")

EXACT = ("peak", "pause")
"""Kinds whose whole claim is about one instant, so they are never snapped.

Every other moment is pulled to the nearest beat within a second, which is
right for a drop or an entrance - those land on a beat and a reader firing a
cue wants the beat. A pause and a peak are not events on the grid, they are
the quietest and loudest instants there are, and a second of snapping moves
them off it: afterglow's pause read 0.291 where it was placed and 0.011 at the
hole 1.2s away, 26 times quieter, and the `peak` on arz-kiya-hai sat at the
69th percentile of its own loudness curve rather than the top."""
CAP = {
    "entrance": 8,
    "exit": 8,
    "register_shift": 8,
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


def energy_curve(temporal, smooth=3, loud=None, heard=None):
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
    straight = (heard or {}).get("loudness") if isinstance(heard, dict) else None
    if isinstance(straight, list) and len(straight) > 8:
        lo, hi = min(straight), max(straight)
        if hi - lo > 1e-9:
            v = [(x - lo) / (hi - lo) for x in straight]
            half = smooth // 2
            out = []
            for i in range(len(v)):
                a, b = max(0, i - half), min(len(v), i + half + 1)
                out.append(sum(v[a:b]) / (b - a))
            steps = sorted(abs(out[i + 1] - out[i]) for i in range(len(out) - 1))
            return (heard.get("window_s") or w, out,
                    steps[len(steps) // 2] if steps else 1.0)
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
            rest = v[i + hold:]
            if rest and max(rest) >= 0.5 * pre:
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


def loudest(v, straight=None, w=0.5, look=4.0):
    """The loudest instant, read off the raw curve rather than the smoothed one.

    `peak` is the argmax of energy_curve, which is smoothed over three windows
    so that a drop or a build is not chasing single-window spikes. That
    smoothing moves the maximum: across 29 songs the emitted peak sat at a
    median 97.8th percentile of the unsmoothed loudness and four songs fell
    below the 90th, mizhiyoram at the 83rd. Smoothing is right for finding
    which passage is loudest and wrong for naming the instant inside it, so
    the argmax picks the passage and the raw curve picks the moment."""
    if not v:
        return []
    i = max(range(len(v)), key=lambda k: v[k])
    if straight and len(straight) == len(v):
        side = max(1, int(round(look / w)))
        lo, hi = max(0, i - side), min(len(straight), i + side + 1)
        i = max(range(lo, hi), key=lambda k: straight[k])
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
        if sum(1 for t in ons if back <= t < back + apart) < 4:
            continue
        if ons[-1] - back < apart:
            continue
        kept.append((held, left, back))
        if len(kept) >= most:
            break
    return [
        {
            "i": int(round(back / w)),
            "type": "melody_resume",
            "size": round(min(1.0, held / 6.0), 3),
            "description": "the melody comes back after "
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


def accents(hits, w, n, tol=4.0, k=8.0, floor=0.10, smooth=5):
    """Where the onsets themselves start landing harder, or stop.

    Every one of the 23507 onsets in the library carries an `intensity` -
    librosa's onset strength over that track's maximum - and until now the only
    thing read off `rhythm.hits` was `t`. How hard a drummer hits is not how
    often, and the two come apart: these events coincide with an onset-density
    step only 16-23% of the time and with `rhythm_change` 13%.

    Of the events that carry no other moment, 30.2% land on a section boundary
    against a per-song chance of 17.3%, a 1.74x that none of three nulls
    reaches - and the decisive one is a mark shuffle, which keeps every onset
    time and shuffles only the intensities. It never gets there, so the signal
    is the loudness of the hits and not their placement.

    NOT EMITTED, and kept here for the next person who has the same idea.
    Uncapped it looks shippable: 112 events, fresh 30.2% against a 17.3%
    chance, beating all three nulls at p=0.0020, which clears the p<0.0028
    Bonferroni bar for eighteen candidates. In the shape it would actually
    ship in, capped at 3 a song, it does not. 74 events survive the cap, only
    23 of them carry no other moment, and those 23 score 21.7% against 17.7%
    - a 1.23x. Adding it also pushed 60 entrance and exit moments out of the
    32-moment budget, and those score 2.57x and 2.12x.

    The uncapped figure was not wrong, it was measured on a shape that is not
    the shipping one, which is the same trap the cadence rule fell into at
    1.19x uncapped and 0.94x capped.
    """
    if not hits or not n or n <= 0 or not w:
        return []
    total = [0.0] * n
    count = [0] * n
    seen = []
    for h in hits:
        if not isinstance(h, dict):
            continue
        t, hard = h.get("t"), h.get("intensity")
        if t is None or hard is None:
            continue
        i = int(float(t) / w)
        if 0 <= i < n:
            total[i] += float(hard)
            count[i] += 1
            seen.append(float(hard))
    if len(seen) < 40 or n < 16:
        return []
    held = sum(seen) / len(seen)
    curve = []
    for i in range(n):
        if count[i]:
            held = total[i] / count[i]
        curve.append(held)
    half = smooth // 2
    lined = []
    for i in range(n):
        a, b = max(0, i - half), min(n, i + half + 1)
        lined.append(sum(curve[a:b]) / (b - a))
    side = max(2, int(round(tol / w)))
    if len(lined) < side * 3:
        return []
    gate = max(floor, k * _noise_of(lined))
    out = []
    for size, i, pre, post in _steps(lined, side, gate):
        out.append(
            {
                "i": i,
                "type": "accent_change",
                "size": round(min(1.0, size / 0.4), 3),
                "description": (
                    "the hits start landing harder"
                    if post > pre
                    else "the hits ease off"
                ),
            }
        )
    return out


def _one_event(picked, rank, apart=2.0):
    """One thing happening is one moment, however many rules noticed it.

    A band dropping out and a voice being left exposed is a single thing a
    listener hears, but exit, register_shift, breakdown, spotlight and entrance
    each fire on it and the score claimed five events inside two seconds.
    Measured over the library, 680 of 1052 moments sat within 2s of another -
    65% - in 245 clusters running up to seven deep, and the commonest pairs are
    just one change seen twice: entrance with exit 85 times, exit with
    register_shift 52, entrance with register_shift 49.

    A cluster is also bounded end to end, not just gap to gap, or a chain of
    2s steps swallows events 3s apart - the peak at 3:32 on dont-look-down and
    the breakdown at 3:34.7 are two things, not one.

    `peak` always leads a cluster it is in: it is the single loudest instant of
    the song and demoting it to a footnote of a breakdown loses the one moment
    a reader is most likely to want. Otherwise the strongest reading by ORDER
    leads, because ORDER is already sorted by
    how structural a kind is - a drop outranks the entrance that carries it -
    and ties go to the larger intensity. The rest of the cluster is kept on the
    moment as `alongside` so nothing measured is thrown away; it stops being a
    separate cue and becomes detail on the one cue."""
    if not picked:
        return picked
    rows = sorted(picked, key=lambda g: g["t"])
    groups, run = [], [rows[0]]
    for g in rows[1:]:
        near = g["t"] - run[-1]["t"] <= apart
        held = g["t"] - run[0]["t"] <= apart * 1.5
        if near and held:
            run.append(g)
        else:
            groups.append(run)
            run = [g]
    groups.append(run)
    out = []
    for run in groups:
        run.sort(key=lambda g: (0 if g["type"] in LEADS else 1,
                                rank.get(g["type"], 99), -g["size"]))
        lead = run[0]
        rest = [g["type"] for g in run[1:]]
        if rest:
            lead = dict(lead)
            lead["alongside"] = rest
        out.append(lead)
    return out


def pauses(heard, floor=0.35, side_s=4.0, most=3):
    """Holes in the mix: a stretch far quieter than what surrounds it.

    Measured off `acoustic.loudness`, not the stem lanes. An earlier `stop`
    rule was rejected for scoring 0.9-1.1x against phase surrogates, and that
    rejection was wrong - it read the peak-normalised lanes, the same broken
    signal behind the sample-peak gain and the mis-named brightness. On the
    measured loudness it finds 49 holes across 20 of 29 songs, corroborating a
    section boundary 2.04x against chance at p=0.0020 over 500 surrogates,
    where the surrogates fire more often than the real track rather than less.

    Judged like `peak` rather than like a detector. Of the 22 that carry no
    other moment, boundary agreement is 1.11x - chance - and that is expected,
    because a pause is a hole inside a section and not a seam between two. The
    claim is not structural. It is that the track drops to a fraction of its
    own level here, which is true by measurement: on dont-look-down the hole at
    180.5s sits at 0.042 against a 0.198 neighbourhood, a fifth of the level
    around it, and Amal heard it before the score had it."""
    if not isinstance(heard, dict):
        return []
    v = heard.get("loudness")
    w = heard.get("window_s") or 0.5
    if not isinstance(v, list) or len(v) < 20:
        return []
    mid = sorted(v)[len(v) // 2]
    if mid <= 0:
        return []
    side = max(2, int(round(side_s / w)))
    found = []
    for i in range(side, len(v) - side):
        near = sorted(v[i - side:i] + v[i + 1:i + 1 + side])
        around = near[len(near) // 2]
        if around <= 0:
            continue
        share = v[i] / around
        if share < floor and v[i] < mid * floor:
            found.append((share, i))
    found.sort()
    kept = []
    for share, i in found:
        if any(abs(i - j) < side for _, j in kept):
            continue
        kept.append((share, i))
        if len(kept) >= most:
            break
    return [
        {
            "i": i,
            "type": "pause",
            "size": round(min(1.0, 1.0 - share), 3),
            "description": "the track falls away to almost nothing",
        }
        for share, i in sorted(kept, key=lambda x: x[1])
    ]


def find(
    temporal,
    beats,
    grid=None,
    chords=None,
    melody=None,
    rhythm=None,
    stems=None,
    heard=None,
    want=None,
    together=1.5,
):
    """Every kind of moment the song actually contains.

    There is no budget. A song with a lot happening gets a lot; a quiet one
    gets few. Anything else is a quota, and a quota is blind to the music - a
    fixed 16 gave cipher-of-the-last-will one moment every 32s and apex one
    every 13s, and a per-minute rate only moves the arbitrariness around.

    The caps that remain are the only ones the evidence asks for. Ranked by
    strength within a song and scored against section boundaries, most kinds
    never run deep enough to reach any cap at all - drop stops at 37 events
    across 29 songs, spotlight at 23, harmonic_rhythm at 20 - so capping them
    was doing nothing. entrance, exit and register_shift do run deep, and they
    hold around 2x down to the seventh strongest before falling to 1.3-1.4x
    beyond the eighth. That is where the cap sits, and it is a measured elbow
    rather than a number chosen to make a list look tidy.

    Deep events are weaker, not false, so they are still emitted up to that
    elbow and carry their `intensity`. A reader that wants fewer cues asks for
    fewer - the response protocol already takes `moments.min_weight` - which is
    the right place for that decision, because how many cues to fire depends on
    the show, not on the song.

    `entrance` and `exit` used to have no cap, so they took every slot the
    capped kinds did not: 43% of a 31-moment list was an instrument arriving or
    leaving, which buries the shape of the song under its plumbing. Capped at
    four each with a 16-moment budget the list halves and reads better by its
    own measure - 43.2% of moments on a section boundary against an 18.0%
    chance, a 2.41x where the old shape scored 2.21x.

    Shrinking the budget alone does not do this. Swept from 32 down to 8 with
    entrance and exit still uncapped, corroboration only creeps from 2.21x to
    2.44x, because what the budget removes is almost entirely those two kinds
    anyway - they fall from 43% of the list to nothing. Capping them is the
    change; the smaller budget is what the cap makes room for."""
    w, v, noise = energy_curve(temporal, loud=stems, heard=heard)
    n = len(v)
    hits = (rhythm or {}).get("hits") if isinstance(rhythm, dict) else rhythm
    cand = (
        comings(temporal, loud=stems)
        + swings(v, w, noise)
        + loudest(v, (heard or {}).get("loudness") if isinstance(heard, dict) else None, w)
        + rolls(temporal, w, loud=stems)
        + tempo_changes(grid, w)
        + shifts(melody, w, n)
        + rhythm_changes(hits, w, n)
        + spotlight(temporal, stems)
        + harmonic_rhythm(chords, w, n)
        + voice_gaps(temporal)
        + melody_returns(melody, w)
        + pauses(heard)
    )
    if not cand:
        return []
    for m in cand:
        m["t"] = m["i"] * w
    if beats:
        for m in cand:
            if m["type"] in EXACT:
                continue
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
        g["t"] = g["parts"][0]["t"]
        rings = [p["heard"] for p in g["parts"] if p.get("heard") is not None]
        g["heard"] = max(rings) if rings else None

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
            [g for g in groups if g["type"] == kind],
            key=lambda g: (
                not any(p.get("arrival") or p.get("departure") for p in g["parts"]),
                -(g["heard"] if g.get("heard") is not None else g["size"]),
            ),
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
    picked = picked + (rest if want is None else rest[: max(0, want - len(picked))])

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

    picked = _one_event(picked, rank)

    one = {"entrance": "enters", "exit": "drops out"}
    many = {"entrance": "enter", "exit": "drop out"}
    out = []
    for g in sorted(picked if want is None else picked[:want], key=lambda x: x["t"]):
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
        if g.get("alongside"):
            item["alongside"] = g["alongside"]
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
