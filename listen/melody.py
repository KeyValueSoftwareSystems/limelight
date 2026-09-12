import numpy as np

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
    beat_s = 60.0 / g["bpm"]
    step = int(np.floor((at - g["first_beat_s"]) / beat_s + 1e-6))
    per = g["beats_per_bar"]
    if step < 0:
        return 0, 1
    return int(step // per + 1 - pickup), int(step % per + 1)


def score(notes, g, pickup):
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
            }
        )
    return out


def chants(notes, g, pickup, least=5, same=1.0, near=0.18, gap=0.45):
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
                "what": f"{len(group)} sung on one note",
                "sure": round(float(min(1.0, len(group) / 10.0)), 3),
                "for_beats": int(round((upto - at) / beat_s)),
                "pitch": round(float(np.median([x[1] for x in group])), 1),
                "notes": len(group),
            }
        )
    return out


def echoes(notes, g, pickup, least=6, slack=1.0, sway=0.45, apart=4, moves=3):
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
                    "what": f"the tune from bar {was[0]}",
                    "sure": round(float(min(1.0, (k + 1) / 10.0)), 3),
                    "for_beats": int(round((upto - notes[j][0]) / beat_s)),
                    "again_of": int(was[0]), "notes": int(k + 1)})
    return out


def sung(notes, spans, g, pickup, chanted=5):
    beat_s = 60.0 / g["bpm"]
    per = g["beats_per_bar"]

    def at_bar(bar):
        return g["first_beat_s"] + (bar - 1 + pickup) * per * beat_s

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
        out.append(
            {
                "notes": len(mine),
                "low": round(float(min(pitch)), 1),
                "high": round(float(max(pitch)), 1),
                "moves": round(float(np.mean(np.abs(np.diff(pitch)))), 2)
                if len(pitch) > 1
                else 0.0,
                "on_one_note": most >= chanted,
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
