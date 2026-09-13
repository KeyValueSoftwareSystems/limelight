import numpy as np
from grid import at_beat, beat_at

RATE = 100
FLOOR = 0.25
HOLD = 12
TOL = 0.7
LOW = 30
HIGH = 100


def line(tune, env, hold=HOLD, tol=TOL, floor=FLOOR):
    if tune is None or env is None or not len(tune) or not len(env):
        return []
    n = min(len(tune), len(env))
    f0 = np.asarray(tune, dtype=float)[:n]
    loud = np.asarray(env, dtype=float)[:n]
    loud = loud / (float(np.percentile(loud, 98)) or 1.0)
    midi = 69 + 12 * np.log2(np.maximum(f0, 1e-6) / 440.0)
    on = (loud > floor) & np.isfinite(midi) & (midi > LOW) & (midi < HIGH)
    out, i = [], 0
    while i < n:
        if not on[i]:
            i += 1
            continue
        j, ref = i, midi[i]
        while j < n and on[j] and abs(midi[j] - ref) < tol:
            j += 1
        if j - i >= hold:
            out.append([i / RATE, float(np.median(midi[i:j])), (j - i) / RATE])
        i = max(j, i + 1)
    return out


def fix(notes, look=4, far=7):
    if not notes:
        return notes, 0
    pitch = np.asarray([x[1] for x in notes], dtype=float)
    moved = 0
    for k in range(len(pitch)):
        lo, hi = max(0, k - look), min(len(pitch), k + look + 1)
        near = np.delete(pitch[lo:hi], k - lo)
        if not len(near):
            continue
        mid = float(np.median(near))
        off = abs(pitch[k] - mid)
        if off <= far:
            continue
        best = min(((abs(pitch[k] + d - mid), pitch[k] + d) for d in (-12, 12)))
        if best[0] < off:
            pitch[k] = best[1]
            moved += 1
    for k, note in enumerate(notes):
        note[1] = float(pitch[k])
    return notes, moved


def seat(at, g, pickup):
    step = int(np.floor(beat_at(g, at) + 1e-6))
    per = g["beats_per_bar"]
    if step < 0:
        return 0, 1
    return int(step // per + 1 - pickup), int(step % per + 1)


def score(notes, g, pickup, played="voice"):
    beat_s = 60.0 / g["bpm"]
    out = []
    for at, pitch, held in notes:
        bar, beat = seat(at, g, pickup)
        out.append(
            {
                "bar": bar,
                "beat": beat,
                "pitch": round(pitch, 1),
                "held_beats": round(held / beat_s, 2),
                "from": played,
            }
        )
    return out


def chants(notes, g, pickup, least=5, same=1.0, near=0.18, gap=0.45,
           played="sung"):
    runs, run = [], 1
    for k in range(1, len(notes) + 1):
        joins = (
            k < len(notes)
            and abs(notes[k][1] - notes[k - 1][1]) < same
            and abs(notes[k][2] - notes[k - 1][2]) < near
            and notes[k][0] - (notes[k - 1][0] + notes[k - 1][2]) < gap
        )
        if joins:
            run += 1
            continue
        if run >= least:
            runs.append(notes[k - run : k])
        run = 1
    beat_s = 60.0 / g["bpm"]
    out = []
    for group in runs:
        at = group[0][0]
        upto = group[-1][0] + group[-1][2]
        bar, beat = seat(at, g, pickup)
        out.append(
            {
                "bar": bar,
                "beat": beat,
                "is": "hook",
                "what": f"{len(group)} {played} on one note",
                "sure": round(float(min(1.0, len(group) / 10.0)), 3),
                "for_beats": int(round((upto - at) / beat_s)),
                "pitch": round(float(np.median([x[1] for x in group])), 1),
                "notes": len(group),
                "from": "voice" if played == "sung" else "lead",
            }
        )
    return out


def echoes(notes, g, pickup, least=6, slack=1.0, sway=0.45, apart=4,
           moves=3, played="tune"):
    if len(notes) < least + apart:
        return []
    pitch = np.asarray([x[1] for x in notes], dtype=float)
    beat_s = 60.0 / g["bpm"]
    held = np.asarray([x[2] / beat_s for x in notes], dtype=float)
    step = np.diff(pitch)
    n = len(step)
    out = []
    used = np.zeros(len(notes), dtype=bool)
    for i in range(n - least + 1):
        if used[i]:
            continue
        best = None
        for j in range(i + apart, n - least + 1):
            k = 0
            while (i + k < n and j + k < n and j + k > i + least - 1
                   and abs(step[i + k] - step[j + k]) <= slack
                   and abs(held[i + k] - held[j + k]) <= sway):
                k += 1
            if k >= least and (best is None or k > best[1]):
                best = (j, k)
        if best is None:
            continue
        j, k = best
        if sum(1 for x in step[i:i + k] if abs(x) >= 1.0) < moves:
            continue
        if used[i:i + k + 1].any() or used[j:j + k + 1].any():
            continue
        used[i:i + k + 1] = True
        used[j:j + k + 1] = True
        was, bar = seat(notes[i][0], g, pickup), seat(notes[j][0], g, pickup)
        upto = notes[j + k][0] + notes[j + k][2]
        out.append({"bar": bar[0], "beat": bar[1], "is": "hook",
                    "what": f"the {played} from bar {was[0]}",
                    "sure": round(float(min(1.0, (k + 1) / 10.0)), 3),
                    "for_beats": int(round((upto - notes[j][0]) / beat_s)),
                    "again_of": int(was[0]), "notes": int(k + 1),
                    "from": "voice" if played == "tune" else "lead"})
    return out


def sung(notes, spans, g, pickup, chanted=5):
    per = g["beats_per_bar"]

    def at_bar(bar):
        return at_beat(g, (bar - 1 + pickup) * per)

    out = []
    for a, b in spans:
        t0, t1 = at_bar(a), at_bar(b + 1)
        mine = [x for x in notes if t0 <= x[0] < t1]
        if not mine:
            out.append(None)
            continue
        pitch = [x[1] for x in mine]
        run, most = 1, 1
        for k in range(1, len(mine)):
            if abs(mine[k][1] - mine[k - 1][1]) < 1.0:
                run += 1
                most = max(most, run)
            else:
                run = 1
        seat = float(np.median(pitch))
        share = sum(1 for x in pitch if abs(x - seat) < 1.0) / len(pitch)
        out.append(
            {
                "notes": len(mine),
                "low": round(float(min(pitch)), 1),
                "high": round(float(max(pitch)), 1),
                "moves": round(float(np.mean(np.abs(np.diff(pitch)))), 2)
                if len(pitch) > 1
                else 0.0,
                "on_one_note": most >= chanted and share >= 0.5,
            }
        )
    return out


def voice(notes, moved):
    if not notes:
        return {"notes": 0, "low": None, "high": None, "sure": 0.0}
    pitch = [x[1] for x in notes]
    return {
        "notes": len(notes),
        "low": round(float(min(pitch)), 1),
        "high": round(float(max(pitch)), 1),
        "octave_fixes": int(moved),
        "sure": round(float(max(0.0, 1.0 - moved / len(notes) * 2.5)), 3),
    }


def edges(xs):
    n = len(xs)
    out = [0.0] * n
    for i in range(n):
        lo = abs(xs[i] - xs[i - 1]) / (xs[i] + xs[i - 1]) if i > 0 and (xs[i] + xs[i - 1]) > 0 else 0.0
        hi = abs(xs[i] - xs[i + 1]) / (xs[i] + xs[i + 1]) if i < n - 1 and (xs[i] + xs[i + 1]) > 0 else 0.0
        out[i] = xs[i] * (lo + hi)
    top = max(out) or 1.0
    return [v / top for v in out]


def breaths(notes, per, weights=(0.25, 0.5, 0.25), least=3, want_bars=4.0):
    # LBDM assumes a clean monophonic line. A pitch track lifted off separated
    # stems is neither: it is dense, it is noisy, and a voice note followed by a
    # lead note is not a melodic interval at all. So a silence longer than half
    # a bar always ends a phrase, and the rest of the peaks are taken strongest
    # first until the phrases are about as long as phrases actually are.
    if len(notes) < least * 2:
        return []
    at = [(n["bar"] * per + n["beat"] - 1) for n in notes]
    step = [max(1e-3, at[i + 1] - at[i]) for i in range(len(notes) - 1)] + [1.0]
    rest = [max(0.0, step[i] - notes[i]["held_beats"]) for i in range(len(notes))]
    leap = [abs(notes[i + 1]["pitch"] - notes[i]["pitch"]) for i in range(len(notes) - 1)] + [0.0]
    a, b, c = edges(leap), edges(step), edges([r + 1e-3 for r in rest])
    w1, w2, w3 = weights
    force = [w1 * a[i] + w2 * b[i] + w3 * c[i] for i in range(len(notes))]

    firm = {i for i in range(len(notes) - 1) if rest[i] >= per}
    peaks = [i for i in range(1, len(force) - 1)
             if force[i] >= force[i - 1] and force[i] > force[i + 1]]
    room = max(1, int((at[-1] - at[0]) / (want_bars * per)))
    peaks.sort(key=lambda i: -force[i])
    cut = sorted(firm)
    for i in peaks:
        if len(cut) >= room + len(firm):
            break
        if all(abs(i - c) >= least for c in cut):
            cut.append(i)
            cut.sort()
    return cut


def shapes(notes, per, cuts):
    out, edge = [], [0] + [c + 1 for c in cuts] + [len(notes)]
    for i in range(len(edge) - 1):
        a, b = edge[i], edge[i + 1]
        mine = notes[a:b]
        if len(mine) < 2:
            continue
        steps = [round(mine[k + 1]["pitch"] - mine[k]["pitch"]) for k in range(len(mine) - 1)]
        out.append({"from_bar": mine[0]["bar"], "from_beat": mine[0]["beat"],
                    "to_bar": mine[-1]["bar"], "to_beat": mine[-1]["beat"],
                    "notes": len(mine),
                    "low": round(min(n["pitch"] for n in mine), 1),
                    "high": round(max(n["pitch"] for n in mine), 1),
                    "sung_by": "voice" if sum(1 for n in mine if n.get("from") != "lead") >= len(mine) / 2 else "lead",
                    "steps": steps})
    return out


def rhymes(parts, slack=1.0, least=4):
    for i, p in enumerate(parts):
        p["same_as"] = None
        p["sure"] = 0.0
    for i in range(1, len(parts)):
        best, mark = None, 0.0
        for j in range(i):
            a, b = parts[j]["steps"], parts[i]["steps"]
            n = min(len(a), len(b))
            if n < least:
                continue
            off = sum(abs(a[k] - b[k]) for k in range(n)) / n
            fit = max(0.0, 1.0 - off / (slack * 3.0)) * (n / max(len(a), len(b)))
            if fit > mark:
                best, mark = j, fit
        if best is not None and mark >= 0.55:
            parts[i]["same_as"] = best
            parts[i]["sure"] = round(mark, 3)
    for p in parts:
        p.pop("steps", None)
    return parts


def phrases_of(notes, g, per):
    # The voice and the lead instrument are two melodies, not one. Reading them
    # as a single stream makes an interval out of every handover between them,
    # which is how 670 notes first came back as four phrases and then as 178.
    out = []
    for who in ("voice", "lead"):
        mine = [n for n in notes if (n.get("from") == "lead") == (who == "lead")]
        if len(mine) < 8:
            continue
        for p in rhymes(shapes(mine, per, breaths(mine, per))):
            p["sung_by"] = who
            out.append(p)
    out.sort(key=lambda p: (p["from_bar"], p["from_beat"]))
    return out
