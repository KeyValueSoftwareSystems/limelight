import numpy as np

RATE = 100
NAMES = ("drums", "bass", "vocals", "other")
SAY = {"drums": "drums", "bass": "bass", "vocals": "voice", "other": "chords"}
ON = 0.15
OFF = 0.10
SURE = 0.45
HOLD = 2


def where(t, g, pickup):
    beat_s = 60.0 / g["bpm"]
    step = (t - g["first_beat_s"]) / beat_s
    idx = int(np.floor(step + 1e-6))
    per = g["beats_per_bar"]
    bar = idx // per + 1 - (0 if pickup else 0)
    beat = idx % per + 1
    if idx < 0:
        return 0, 1
    return int(bar), int(beat)


def bar_at(bar, pickup):
    return max(0, int(bar) - 1 + pickup)


def steady(v, on=ON, off=OFF, hold=HOLD):
    state = bool(v[0] > on)
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


def lift(x):
    x = np.asarray([v if v is not None else 0.0 for v in x], dtype=float)
    top = float(np.percentile(x, 98)) or 1.0
    return np.clip(x / top, 0.0, 1.5)


def thin(found, gap=2, keep=1):
    out = []
    for m in sorted(found, key=lambda x: -x["sure"]):
        near = [o for o in out
                if o["is"] == m["is"] and abs(o["bar"] - m["bar"]) < gap]
        if len(near) < keep:
            out.append(m)
    return out


def say(bar, beat, kind, what, sure, **more):
    out = {"bar": int(bar), "beat": int(beat), "is": kind,
           "what": what, "sure": round(float(np.clip(sure, 0, 1)), 3)}
    out.update(more)
    return out


def comings(lanes, pickup):
    out = []
    for name in NAMES:
        v = lift(lanes[name])
        on = steady(v)
        for i in range(1, len(on)):
            if on[i] == on[i - 1]:
                continue
            gap = abs(float(v[i] - v[i - 1]))
            out.append(say(i - pickup + 1, 1,
                           "entrance" if on[i] else "exit",
                           SAY[name], min(1.0, gap / 0.5)))
    return out


def pauses(lanes, pickup, deep=0.45, most=2):
    out = []
    for name in NAMES:
        v = lift(lanes[name])
        on = steady(v)
        i = 1
        while i < len(v) - 1:
            if on[i - 1] and v[i] < v[i - 1] * deep:
                j = i
                while j < len(v) and v[j] < v[i - 1] * deep:
                    j += 1
                if j - i <= most and j < len(v):
                    drop = 1.0 - float(v[i] / (v[i - 1] or 1.0))
                    out.append(say(i - pickup + 1, 1, "pause", SAY[name],
                                   drop, for_bars=int(j - i)))
                i = j
            else:
                i += 1
    return out


def climbs(lanes, bright, loud, pickup, span=8, least=4, gain=0.25):
    out = []
    lines = {SAY[n]: lift(lanes[n]) for n in NAMES}
    lines["brightness"] = lift(bright)
    lines["everything"] = lift(loud)
    wins = {}
    for what, v in lines.items():
        i = 0
        while i < len(v) - least:
            best, at = 0.0, 0
            for w in range(least, min(span, len(v) - i) + 1):
                rose = float(v[i + w - 1] - v[i])
                if rose > best:
                    best, at = rose, w
            half = v[i + at // 2] - v[i] if at >= 2 else 0.0
            if (best >= gain and float(np.min(np.diff(v[i:i + at]))) > -gain / 2
                    and half >= best * 0.25):
                bar = i - pickup + 1
                if best > wins.get(bar, (0.0, None))[0]:
                    wins[bar] = (best, say(bar, 1, "rise", what, best,
                                           for_bars=int(at)))
                i += at
            else:
                i += 1
    out = [m for _, m in wins.values()]
    return out


def arrivals(pull, g, gone, pickup):
    out = []
    per = g["beats_per_bar"]
    for r in gone or []:
        i = int(r.get("beat_index", 0))
        bar = i // per + 1
        beat = i % per + 1
        out.append(say(bar, beat, "release", "tension",
                       float(r.get("drop", 0.5)),
                       after_beats=int(r.get("lead_beats", 0))))
    return out


def hits(env, g, pickup, sharp=2.2):
    kit = np.asarray(env.get("drums", []), dtype=float)
    whole = sum(np.asarray(env[n], dtype=float) for n in NAMES if n in env)
    if not len(whole) or not len(kit):
        return [], []
    beat_s = 60.0 / g["bpm"]
    frames = int(round(beat_s * RATE))
    if frames < 2:
        return [], []

    def beats_of(x):
        step = np.diff(x, prepend=x[0])
        step[step < 0] = 0.0
        n = len(step) // frames
        return step[: n * frames].reshape(n, frames), n

    kicks, n = beats_of(kit)
    loud, _ = beats_of(whole)
    alive = kit[: n * frames].reshape(n, frames).mean(axis=1)
    floor = float(np.percentile(alive, 90)) * 0.25

    count = (kicks > kicks.max() * 0.18).sum(axis=1)
    busy = np.array([np.median(count[max(0, i - 8):i + 8]) for i in range(n)])
    power = loud.max(axis=1)
    near = np.array([np.median(power[max(0, i - 8):i + 8]) or 1e-9
                     for i in range(n)])

    fills, accents = [], []
    per = g["beats_per_bar"]
    for i in range(n):
        bar, beat = i // per + 1, i % per + 1
        if alive[i] > floor and busy[i] > 0 and count[i] > busy[i] * 2.2 \
                and count[i] >= 4:
            fills.append(say(bar, beat, "fill", "drums",
                             min(1.0, count[i] / (busy[i] * 4.0))))
        elif power[i] > near[i] * sharp and busy[i] <= 4:
            accents.append(say(bar, beat, "accent", "the band",
                               min(1.0, power[i] / (near[i] * sharp * 2))))
    return thin(fills, 4), thin(accents, 4)


def turns(chord, sure, bright, busy, pickup, hold=2):
    out = []
    lit = lift(bright)
    beat = lift(busy)
    for i in range(1, len(chord) - hold):
        now, was = chord[i], chord[i - 1]
        if now and was and now != was:
            if all(chord[i + k] == now for k in range(hold)):
                fresh = now not in [c for c in chord[max(0, i - 4):i - 1] if c]
                if fresh:
                    out.append(say(i - pickup + 1, 1, "change", "harmony",
                                   float(sure[i] or 0.5)))
    for name, v in (("texture", lit), ("rhythm", beat)):
        for i in range(4, len(v) - 4):
            before = float(np.median(v[i - 4:i]))
            after = float(np.median(v[i:i + 4]))
            if abs(after - before) > 0.30:
                out.append(say(i - pickup + 1, 1, "change", name,
                               min(1.0, abs(after - before) / 0.6)))
    return thin(out, 4)


def again(chroma, spans, anchor, pickup, alike=0.90):
    if chroma is None or not len(spans):
        return []
    seat = [i for i, (a, b, m) in enumerate(spans) if m == anchor]
    if not seat:
        return []
    a0, b0, _ = spans[seat[0]]
    if b0 - a0 < 2 or chroma.shape[1] <= a0 + 1:
        return []
    face = chroma[:, a0:min(a0 + 2, chroma.shape[1])].mean(axis=1)
    face = face / (np.linalg.norm(face) or 1.0)
    inside = set()
    for i in seat:
        inside.update(range(spans[i][0], spans[i][1]))
    out = []
    last = -99
    for i in range(chroma.shape[1]):
        if i in inside or i - last < 4:
            continue
        v = chroma[:, i]
        v = v / (np.linalg.norm(v) or 1.0)
        near = float(np.dot(face, v))
        if near >= alike:
            out.append(say(i - pickup + 1, 1, "hook", "the riff",
                           (near - alike) / (1 - alike)))
            last = i
    return out


def held(env, g, pickup, tune=None, least=0.7):
    v = np.asarray(env.get("vocals", []), dtype=float)
    if len(v) < RATE:
        return []
    top = float(np.percentile(v, 98)) or 1.0
    v = v / top
    pad = 7
    smooth = np.array([np.median(v[max(0, i - pad):i + pad + 1])
                       for i in range(len(v))])
    note = None
    if tune is not None and len(tune):
        keep = min(len(tune), len(smooth))
        note = 69 + 12 * np.log2(
            np.maximum(np.asarray(tune, float)[:keep], 1e-6) / 440.0)
        smooth = smooth[:keep]
        v = v[:keep]
    beat_s = 60.0 / g["bpm"]
    per = g["beats_per_bar"]
    floor = 0.40
    reach = None
    if note is not None:
        loud_now = smooth >= floor
        if loud_now.any():
            heard = note[loud_now]
            heard = heard[np.isfinite(heard)]
            if len(heard):
                reach = float(np.percentile(heard, 90))
    out, i = [], 0
    while i < len(smooth):
        if smooth[i] < floor:
            i += 1
            continue
        j = i
        while j < len(smooth) and smooth[j] >= floor:
            j += 1
        span_s = (j - i) / RATE
        if span_s >= least:
            piece = smooth[i:j]
            slope = float(np.abs(np.diff(piece)).mean()) if len(piece) > 1 else 1.0
            steady = slope < 0.02
            word, sure = "voice sustained", min(1.0, span_s / 2.5)
            if note is not None and j <= len(note):
                turn = note[i:j]
                turn = turn[np.isfinite(turn)]
                if len(turn) > 4:
                    spread = float(np.percentile(turn, 90) - np.percentile(turn, 10))
                    if spread < 1.0 and steady:
                        word = "a held note"
                        sure = min(1.0, span_s / 2.0)
                    elif spread > 7.0:
                        word = "a vocal run"
                        sure = min(1.0, spread / 14.0)
                    if reach is not None and len(turn):
                        if float(np.percentile(turn, 90)) >= reach - 0.5 and span_s >= 0.5:
                            word = "voice at full reach"
                            sure = max(sure, 0.7)
            if steady or word != "voice sustained":
                idx = max(0, int(np.floor(
                    (i / RATE - g["first_beat_s"]) / beat_s)))
                out.append(say(idx // per + 1, idx % per + 1, "highlight",
                               word, sure,
                               for_beats=round(span_s / beat_s, 2)))
        i = j
    return thin(out, 2)


def sweeps(air, pickup, span=8, least=3, gain=0.30):
    v = lift(air)
    out, i = [], 0
    while i < len(v) - least:
        best, at = 0.0, 0
        for w in range(least, min(span, len(v) - i) + 1):
            rose = float(v[i + w - 1] - v[i])
            if rose > best:
                best, at = rose, w
        if best >= gain and v[i + at // 2] - v[i] >= best * 0.25:
            out.append(say(i - pickup + 1, 1, "rise", "a sweep",
                           best, for_bars=int(at)))
            i += at
        else:
            i += 1
    return thin(out, 4)


def paces(pace, pickup, span=4, apart=0.5):
    v = np.asarray(pace, dtype=float)
    out = []
    for i in range(span, len(v) - span):
        before = float(np.median(v[i - span:i]))
        after = float(np.median(v[i:i + span]))
        if before > 0 and abs(after - before) / before >= apart:
            word = "double time" if after > before else "half time"
            out.append(say(i - pickup + 1, 1, "change", word,
                           min(1.0, abs(after - before) / (before * 2))))
    return thin(out, 8)


def opens(width, pickup, span=4, apart=0.25):
    v = np.asarray(width, dtype=float)
    top = float(np.percentile(v, 98)) or 1.0
    v = v / top
    out = []
    for i in range(span, len(v) - span):
        before = float(np.median(v[i - span:i]))
        after = float(np.median(v[i:i + span]))
        if abs(after - before) >= apart:
            word = "opens up" if after > before else "narrows"
            out.append(say(i - pickup + 1, 1, "change", word,
                           min(1.0, abs(after - before) / 0.5)))
    return thin(out, 8)


def leading(found, spans, pickup, look=2):
    edges = [a for a, _, _ in spans[1:]]
    out = []
    for m in found:
        if m["is"] not in ("fill", "rise", "pause"):
            continue
        at = bar_at(m["bar"], pickup)
        for e in edges:
            if 0 <= e - at <= look:
                out.append(say(m["bar"], m["beat"], "transition", m["what"],
                               m["sure"], into_bar=int(e - pickup + 1)))
                break
    best = {}
    for m in out:
        k = m["into_bar"]
        if k not in best or m["sure"] > best[k]["sure"]:
            best[k] = m
    return list(best.values())


def moments(g, lanes, busy, bright, loud, chord, sure, spans, anchor,
            chroma, env, gone, pickup, air=None, pace=None, width=None,
            tune=None, report=None):
    found = []
    found += comings(lanes, pickup)
    found += pauses(lanes, pickup)
    found += climbs(lanes, bright, loud, pickup)
    found += arrivals(None, g, gone, pickup)
    fills, accents = hits(env, g, pickup)
    found += fills
    found += accents
    found += turns(chord, sure, bright, busy, pickup)
    found += again(chroma, spans, anchor, pickup)
    found += held(env, g, pickup, tune)
    if air is not None:
        found += sweeps(air, pickup)
    if pace is not None:
        found += paces(pace, pickup)
    if width is not None:
        found += opens(width, pickup)
    found += leading(found, spans, pickup)

    floors = {"entrance": 0.30, "exit": 0.30, "rise": 0.30,
              "change": 0.30, "hook": 0.20, "fill": 0.35}
    found = [m for m in found
             if m["bar"] >= 0 and m["sure"] >= floors.get(m["is"], 0.10)]
    tall = {}
    for m in found:
        key = (m["bar"], m["is"])
        tall.setdefault(key, []).append(m)
    found = []
    for key, group in tall.items():
        group.sort(key=lambda x: -x["sure"])
        found += group[:2]
    found.sort(key=lambda m: (m["bar"], m["beat"], m["is"]))
    if report is not None:
        kinds = {}
        for m in found:
            kinds[m["is"]] = kinds.get(m["is"], 0) + 1
        report["moments"] = len(found)
        report["moment_kinds"] = kinds
    return found
