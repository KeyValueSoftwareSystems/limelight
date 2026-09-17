import collections
import bisect
import json
import os
import subprocess
import sys

collections_Counter = collections.Counter

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))

FAMILY = {
    "brass": ("brass", "trombone", "tuba", "french-horn", "horn"),
    "strings": (
        "violin",
        "viola",
        "cello",
        "strings",
        "bowed_strings",
        "double-bass",
        "harp",
    ),
    "guitars": (
        "guitar",
        "acoustic-guitar",
        "electric-guitar",
        "banjo",
        "ukulele",
        "mandolin",
        "sitar",
        "dobro",
        "bass",
    ),
    "keys": ("piano", "digital-piano", "keys", "synth", "organ"),
    "winds": ("flute", "harmonica", "wind", "woodwind", "clarinet", "oboe", "sax"),
    "voices": ("lead-vocal", "back-vocal", "vocal", "choir"),
    "drums": (
        "kick",
        "snare",
        "toms",
        "drums",
        "congas",
        "percussion",
        "timpani",
        "tambourine",
        "cymbals",
    ),
}
FAMILY_COLOUR = {
    "brass": "amber",
    "strings": "violet",
    "guitars": "scarlet",
    "keys": "teal",
    "winds": "saffron",
    "voices": "crimson",
    "drums": "crimson",
}
FAMILY_SHADES = {
    "brass": ("amber", "saffron", "ember"),
    "strings": ("violet", "indigo", "crimson"),
    "guitars": ("scarlet", "crimson", "amber"),
    "keys": ("teal", "indigo", "violet"),
    "winds": ("saffron", "amber", "bone"),
    "voices": ("crimson", "blood", "scarlet"),
    "drums": ("scarlet", "ember", "crimson"),
}
FAMILY_TEMPERATURE = {
    "brass": ("violet", "crimson", "amber", "saffron"),
    "strings": ("indigo", "violet", "crimson", "amber"),
    "guitars": ("indigo", "crimson", "scarlet", "amber"),
    "keys": ("indigo", "teal", "violet", "saffron"),
    "winds": ("teal", "saffron", "amber", "bone"),
    "voices": ("indigo", "crimson", "scarlet", "bone"),
    "drums": ("indigo", "crimson", "scarlet", "bone"),
}
GESTURES = {
    "travel": ("sweep", "comet", "wave", "zigzag", "tail", "march", "pendulum"),
    "grow": ("build", "cascade", "unbuild", "wipe", "stack"),
    "halves": ("alternate", "split"),
    "oddeven": ("hocket",),
    "poles": ("converge", "diverge", "twin"),
    "room": ("pulse", "breathe", "blink"),
}
RHYTHMIC = ("room", "halves", "oddeven")


def lamp_count(rig="arc4-head"):
    try:
        man = json.load(open(os.path.join(REPO, "portal", "venues", rig, "manifest.json")))
        lay = json.load(open(os.path.join(REPO, "readers", "lights", man["layout_file"])))
        return sum(1 for f in lay["fixtures"] if f["type"].startswith("par")) or 4
    except Exception:
        return 4


def cycle_steps(fig, n):
    if fig in ("sweep", "bounce", "wave", "comet", "handover", "tail"):
        return max(1, 2 * n - 2)
    if fig == "cascade":
        return max(1, 2 * n - 1)
    if fig in ("build", "unbuild", "zigzag", "stack"):
        return max(1, n)
    if fig == "wipe":
        return max(1, 2 * n)
    if fig == "march":
        return max(1, 2 * (n - 1) - 1)
    if fig == "blink":
        return max(2, 2 * n)
    if fig == "twin":
        return max(2, n)
    if fig in ("converge", "diverge"):
        return max(1, n // 2)
    return 2
COUNTER = {
    "brass": "indigo", "strings": "amber", "guitars": "indigo", "keys": "crimson",
    "winds": "violet", "voices": "indigo", "drums": "indigo",
}
PALETTE = {
    "ink": "#1a0008",
    "oxblood": "#a00018",
    "blood": "#e00020",
    "crimson": "#ff0030",
    "scarlet": "#ff0a1e",
    "ember": "#ff2a00",
    "amber": "#ff9500",
    "saffron": "#ffd000",
    "violet": "#b026ff",
    "indigo": "#1040ff",
    "teal": "#00e5ff",
    "bone": "#ffffff",
}


def holes_in(song, floor=0.30, min_len=0.26):
    import numpy as np
    import librosa

    path = os.path.join(REPO, "hub", "files", "audio", "%s.mp3" % song)
    if not os.path.isfile(path):
        return []
    y, sr = librosa.load(path, sr=22050, mono=True)
    hop = 512
    rms = librosa.feature.rms(y=y, hop_length=hop)[0]
    t = librosa.times_like(rms, sr=sr, hop_length=hop)
    med = float(np.median(rms)) or 1.0
    thr = med * floor
    out = []
    i = 0
    while i < len(rms):
        if rms[i] < thr:
            j = i
            while j < len(rms) and rms[j] < thr:
                j += 1
            b = float(t[min(j, len(t) - 1)])
            if b - float(t[i]) >= min_len:
                out.append((float(t[i]), b, float(rms[i:j].min()) / med))
            i = j
        else:
            i += 1
    return out


def score_for(song):
    out = (
        subprocess.check_output(
            [
                "node",
                "-e",
                "console.log(require('./protocol/fixture.js').pick(%r))" % song,
            ],
            cwd=REPO,
            stderr=subprocess.DEVNULL,
        )
        .decode()
        .strip()
    )
    return json.load(open(out))


def grid_of(sc):
    beats = [b["t"] for b in sc.get("beats", [])]
    per = (sc.get("grid") or {}).get("beats_per_bar", 4)
    flags = [i for i, b in enumerate(sc.get("beats", [])) if b.get("downbeat")]
    phase = (flags[0] % per) if flags else 0
    step = (beats[-1] - beats[0]) / (len(beats) - 1) if len(beats) > 1 else 0.5

    def at(bar, beat=1):
        i = phase + (bar - 1) * per + (beat - 1)
        if i < 0:
            return beats[0] + i * step
        if i >= len(beats):
            return beats[-1] + (i - len(beats) + 1) * step
        return beats[i]

    def beat_at(t):
        # The tempo is not constant. raga-of-revenge runs at 89.6bpm for its
        # first eighteen seconds and 120 after, so one averaged beat is 23% wrong
        # in the intro and every duration built on it lands off the music.
        if len(beats) < 2:
            return step
        i = bisect.bisect_left(beats, t)
        i = max(1, min(len(beats) - 1, i))
        return beats[i] - beats[i - 1]

    return per, at, step, beat_at


def bar_rows(sc, per, at, floor=0.04):
    length = sc["song"]["length_s"]
    n = 1
    while at(n + 1) < length:
        n += 1
    temporal = sc.get("stems_temporal") or {}
    win = temporal.get("window_s", 0.5)
    lanes = temporal.get("stems", {})

    def level(name, a, b):
        v = lanes.get(name) or []
        i0, i1 = int(a / win), max(int(a / win) + 1, int(b / win))
        seg = v[i0:i1]
        return max(seg) if seg else 0.0

    rows = []
    for bar in range(1, n + 1):
        a, b = at(bar), at(bar + 1)
        playing = {k: level(k, a, b) for k in lanes}
        playing = {k: v for k, v in playing.items() if v >= floor}
        fam = {}
        for f, members in FAMILY.items():
            vals = [v for k, v in playing.items() if k in members]
            fam[f] = sum(vals)
        rows.append(
            {
                "bar": bar,
                "t": a,
                "end": b,
                "playing": playing,
                "E": sum(playing.values()),
                "fam": fam,
            }
        )
    return rows


def author(song, out_path=None):
    sc = score_for(song)
    per, at, step, beat_at = grid_of(sc)
    rows = bar_rows(sc, per, at)
    hits = sorted(
        ((h["t"], h["intensity"]) for h in (sc.get("rhythm") or {}).get("hits", []))
    )
    moments = sorted(
        (
            (
                m.get("time_s") or m.get("at_s") or 0,
                m.get("type") or "",
                m.get("intensity") or 0,
            )
            for m in sc.get("moments", [])
        )
    )
    sections = sc.get("sections") or []
    holes = holes_in(song)
    _t0 = (sc.get("stems_temporal") or {})
    _lanes = _t0.get("stems", {})
    _n = max((len(v) for v in _lanes.values()), default=0)
    lanes_total = [sum((v[w] if w < len(v) else 0) for v in _lanes.values()) for w in range(_n)]
    line = []
    for n in sorted(sc.get("melody") or [], key=lambda x: x["start"]):
        if line and n["start"] - line[-1][0] < 0.055:
            if n["pitch"] > line[-1][1]:
                line[-1] = (line[-1][0], n["pitch"], max(line[-1][2], n.get("velocity", 0)))
        else:
            line.append((n["start"], n["pitch"], n.get("velocity", 0)))
    all_p = [p for _, p, _ in line]
    p_lo = min(all_p) if all_p else 30
    p_hi = max(all_p) if all_p else 90

    def notes_in(a, b):
        return [(t, p, v) for t, p, v in line if a <= t < b]

    runs = []
    i = 0
    while i < len(line) - 3:
        d = 0
        j = i
        while j + 1 < len(line) and line[j + 1][0] - line[j][0] <= 0.30:
            step_p = line[j + 1][1] - line[j][1]
            if step_p == 0:
                j += 1
                continue
            sgn = 1 if step_p > 0 else -1
            if d == 0:
                d = sgn
            elif sgn != d:
                break
            j += 1
        n_notes = j - i + 1
        span = line[j][0] - line[i][0]
        if n_notes >= 4 and span > 0.15 and abs(line[j][1] - line[i][1]) >= 7:
            runs.append({"a": line[i][0], "b": line[j][0], "n": n_notes, "dir": d,
                         "rate": n_notes / span,
                         "vel": max(v for _, _, v in line[i:j + 1])})
        i = max(j, i + 1)
    chords = sc.get("btc_chords_raw") or []
    _beats = [b["t"] for b in sc.get("beats", [])]

    def _to_beat(t):
        if not _beats:
            return t
        return min(_beats, key=lambda x: abs(x - t))

    chord_edges = sorted({round(_to_beat(c["start"]), 3) for c in chords})
    emo = sorted((e for e in (sc.get("emotion") or []) if e.get("start") is not None),
                 key=lambda e: e["start"])

    def emo_at(t):
        best = None
        for e in emo:
            if e["start"] <= t < e.get("end", e["start"]):
                return e
            if e["start"] <= t:
                best = e
        return best or (emo[0] if emo else {})

    def snap_chord(t, tol=0.6):
        if not chord_edges:
            return t
        k = min(chord_edges, key=lambda x: abs(x - t))
        return k if abs(k - t) <= tol else t
    Emax = max(r["E"] for r in rows) or 1.0
    # When the music thins, the show thins with it. Onset density is the arc
    # this song actually has - it runs from nothing at all through the intro to
    # six a second in the body - where MOSS's own energy field is a plateau from
    # 6.2 to 9.2 and says nothing. A stretch with no drums is the music
    # breathing, and the lights have to breathe with it rather than carry on.
    def onsets_per_s(a0, b0):
        if b0 <= a0:
            return 0.0
        return sum(1 for t0, i0 in hits if a0 <= t0 < b0 and i0 >= 0.25) / (b0 - a0)

    for r in rows:
        r["_dens"] = onsets_per_s(r["t"], r["end"])
    _d = sorted(r["_dens"] for r in rows)
    _busy = _d[int(len(_d) * 0.62)] if _d else 1.0
    QUIET = max(0.9, _busy * 0.42)
    for r in rows:
        r["_quiet"] = r["_dens"] < QUIET

    E_ranked = sorted(r["E"] for r in rows)
    E_mid = E_ranked[len(E_ranked) // 2] if E_ranked else 1.0

    def hush(E):
        if E_mid <= 0:
            return 1.0
        q = E / (0.28 * E_mid)
        return 1.0 if q >= 1 else max(0.12, q ** 0.7)

    def spread(E):
        lo = bisect.bisect_left(E_ranked, E)
        hi = bisect.bisect_right(E_ranked, E)
        mid = (lo + hi - 1) / 2.0
        return mid / max(1, len(E_ranked) - 1)
    peak_t = None
    for t, kind, w in moments:
        if kind == "peak":
            peak_t = t
    if peak_t is None:
        peak_t = max(rows, key=lambda r: r["E"])["t"]
    span = rows[-1]["end"] or 1.0

    def arc(t):
        if t <= peak_t:
            return 0.80 + 0.20 * (t / peak_t if peak_t else 1.0) ** 0.75
        tail = (t - peak_t) / max(1e-6, span - peak_t)
        return 1.0 - 0.36 * tail ** 0.8

    def bar_at(t):
        for r in rows:
            if r["t"] <= t < r["end"]:
                return r["bar"]
        return rows[-1]["bar"]

    def hit_density(r):
        n = sum(1 for t, i in hits if r["t"] <= t < r["end"] and i >= 0.28)
        return n

    def moment_at(bar):
        best = None
        here = at(bar)
        for t, kind, w in moments:
            if abs(t - here) > 2.5 * step * per:
                continue
            if bar_at(t) == bar and (best is None or w > best[2]):
                best = (t, kind, w)
        return best

    def section_at(bar):
        for s in sections:
            if s["start"] - step <= rows[bar - 1]["t"] < s["end"]:
                return s.get("label", "")
        return ""

    cues = []

    def add(bar, fade, look, chase=None, why="", layers=None):
        cues.append(
            {
                "id": len(cues) + 1,
                "at": {"bar": bar},
                "_t": at(bar),
                "fade": round(fade, 2),
                "why": why,
                "look": look,
                **({"chases": layers} if layers else ({"chase": chase} if chase else {})),
            }
        )

    inst = {}
    sec_of = {}
    seen = collections_Counter()
    for sx in sections:
        lab = sx.get("label", "?")
        seen[lab] += 1
        inst.setdefault(lab, 0)
        inst[lab] = seen[lab]
        for rr in rows:
            if sx["start"] - step <= rr["t"] < sx["end"]:
                sec_of[rr["bar"]] = (lab, seen[lab])
    total_inst = dict(seen)

    sig_colour = {}
    labels_in_order = []
    for sx in sections:
        lab = sx.get("label", "?")
        if lab not in labels_in_order:
            labels_in_order.append(lab)
    fam_names = list(GESTURES)
    sig_move = {}
    for idx, lab in enumerate(labels_in_order):
        bars_here = [rr for rr in rows if any(
            sx.get("label", "?") == lab and sx["start"] - step <= rr["t"] < sx["end"]
            for sx in sections)]
        dens_here = 0.0
        if bars_here:
            dens_here = sum(
                sum(1 for t, i in hits if rr["t"] <= t < rr["end"] and i >= 0.28)
                for rr in bars_here) / len(bars_here)
        pref = ["poles", "travel", "grow", "halves", "oddeven"] if dens_here < 4 else \
               ["halves", "oddeven", "room", "travel", "grow"]
        for cand in pref:
            if cand not in sig_move.values():
                sig_move[lab] = cand
                break
        else:
            sig_move[lab] = fam_names[idx % len(fam_names)]

    phrases = []
    for sx in sections:
        bars_in = [rr for rr in rows if sx["start"] - step <= rr["t"] < sx["end"]]
        if not bars_in:
            continue
        size = 4 if len(bars_in) >= 4 else max(1, len(bars_in))
        for q in range(0, len(bars_in), size):
            grp = bars_in[q:q + size]
            if not grp:
                continue
            e0, e1 = grp[0]["E"], grp[-1]["E"]
            em = sum(x["E"] for x in grp) / len(grp)
            if len(grp) < 2:
                d = "holds"
            elif e1 > e0 * 1.15:
                d = "rises"
            elif e1 < e0 * 0.87:
                d = "falls"
            else:
                d = "holds"
            dens = sum(1 for t, i in hits if grp[0]["t"] <= t < grp[-1]["end"] and i >= 0.28)
            phrases.append({"bars": [x["bar"] for x in grp], "dir": d, "E": em,
                            "t": grp[0]["t"], "end": grp[-1]["end"],
                            "dens": dens / max(1, len(grp)),
                            "label": sx.get("label", "?")})
    phrase_of = {}
    for pi, ph in enumerate(phrases):
        IDEA = {
            "rises": ("build", 0.80, 1.00, "opens out"),
            "falls": ("unbuild", 1.00, 0.82, "closes down"),
            "holds": ("wave", 0.92, 0.98, "travels across"),
        }
        fig, a0, a1, word = IDEA[ph["dir"]]
        if ph["dir"] == "holds":
            fig = "wave" if ph["dens"] >= 4 else "comet"
        ph["fig"] = fig
        ph["a0"], ph["a1"], ph["word"] = a0, a1, word
        for k, b in enumerate(ph["bars"]):
            phrase_of[b] = (pi, k, len(ph["bars"]))

    rising = set()
    for k in range(len(rows)):
        run = 0
        j = k
        while j + 1 < len(rows) and rows[j + 1]["E"] >= rows[j]["E"] * 0.92:
            j += 1
            run += 1
        if run >= 3 and run <= 8 and rows[j]["E"] >= rows[k]["E"] * 1.45:
            for q in range(k, j + 1):
                rising.add(rows[q]["bar"])

    prev_fam = None
    held_fam = None
    held_colour = None
    held_gesture = None
    held_warmth = 0.0
    held_split = False
    split_since = -9.0
    prev_level = 0.0
    prev_set = set()
    add_layers = None
    for r in rows:
        bar = r["bar"]
        mom = moment_at(bar)
        kind = mom[1] if mom else ""
        if kind not in ("peak", "climax", "drop"):
            kind = ""
            mom = None
        here = set(r["playing"])
        churn = len(here ^ prev_set)
        lead = max(r["fam"], key=lambda f: r["fam"][f]) if r["fam"] else "voices"
        if held_fam is None:
            top_fam = lead
        elif lead == held_fam:
            top_fam = held_fam
        else:
            challenger = r["fam"].get(lead, 0.0)
            incumbent = r["fam"].get(held_fam, 0.0)
            top_fam = lead if challenger > incumbent * 1.30 else held_fam
        held_fam = top_fam
        fam_changed = top_fam != prev_fam
        pi, pk, pn = phrase_of.get(bar, (None, 0, 1))
        ph = phrases[pi] if pi is not None else None
        if ph is not None:
            band = (0.09 + 0.80 * (spread(ph["E"]) ** 1.05)) * arc(ph["t"]) * hush(ph["E"])
            pos = pk / max(1, pn - 1) if pn > 1 else 1.0
            level = round(min(0.97, band * (ph["a0"] + (ph["a1"] - ph["a0"]) * pos)), 2)
        else:
            e = spread(r["E"])
            level = round(min(0.99, (0.09 + 0.80 * (e**1.05)) * arc(r["t"]) * hush(r["E"])), 2)

        is_edge = any(abs(s["start"] - r["t"]) < step for s in sections)
        phrase_start = ph is not None and pk == 0
        want = bool(kind) or phrase_start or bar == 1
        if not want and abs(level - prev_level) < 0.14:
            continue

        colour = FAMILY_COLOUR.get(top_fam, "crimson")
        lab_now = sec_of.get(bar, (None, 1))[0]
        fam_now = GESTURES.get(sig_move.get(lab_now, ""))
        pidx = phrase_of.get(bar, (0, 0, 1))[0] or 0

        def pair(fig_main, every_main, low_main, move=False, rev=False):
            fam_l = fam_now or ("wave", "comet", "handover")
            try:
                nxt = fam_l[(fam_l.index(fig_main) + 1) % len(fam_l)]
            except ValueError:
                nxt = fam_l[0]
            near = "inner" if (pidx % 2 == 0) else "outer"
            far = "outer" if (pidx % 2 == 0) else "inner"
            a = {"on": "lamps", "figure": fig_main, "every": every_main,
                 "low": low_main, "move_head": move}
            if rev:
                a["reverse"] = True
            b = {"on": "lamps", "figure": nxt, "every": {"bars": 2},
                 "low": 0.97, "reverse": not rev}
            return [a, b]

        def from_family(role):
            if not fam_now:
                return {"grow": "build", "travel": "comet", "pass": "handover"}.get(role, "wave")
            if role == "grow":
                for cand in ("build", "cascade", "converge"):
                    if cand in fam_now:
                        return cand
            if role == "pass":
                for cand in ("handover", "alternate", "split", "wave"):
                    if cand in fam_now:
                        return cand
            return fam_now[pidx % len(fam_now)]
        dens = hit_density(r)
        chase = None
        fade = 0.45

        if kind in ("pause", "exit") and r["E"] < Emax * 0.25:
            look = {}
            fade = 0.0
            why = "%s at %.1fs, E %.2f - the music stops, so the light stops" % (
                kind,
                mom[0],
                r["E"],
            )
        elif kind == "peak":
            look = {
                "lamps": {"c": "bone", "l": 1.0},
                "heads": {"c": "bone", "l": 1.0, "pan": 0.5, "tilt": 0.26, "strobe": 0.75},
            }
            fade = 0.0
            chase = {"on": "lamps", "figure": "pulse", "every": {"hits": 1}, "low": 0.6}
            add_layers = None
            why = (
                "PEAK at %.1fs - the loudest instant in the recording. Full blast, the only white"
                % mom[0]
            )
        elif kind in ("climax", "drop"):
            look = {
                "lamps": {"c": "scarlet", "l": min(0.98, level + 0.2)},
                "heads": {"c": "scarlet", "l": 0.6, "pan": 0.5, "tilt": 0.3, "strobe": 0.5},
            }
            fade = 0.0
            chase = {
                "on": "lamps",
                "figure": "pulse",
                "every": {"hits": 1},
                "low": 0.45,
            }
            why = "%s at %.1fs - everything arrives at once" % (kind, mom[0])
        elif kind == "breakdown":
            look = {"inner": {"c": colour, "l": max(0.18, level * 0.55)}}
            fade = 0.8
            why = "breakdown at %.1fs - the room empties to the middle" % mom[0]
        elif kind in ("build",):
            look = {"lamps": {"c": colour, "l": level}}
            add_layers = pair(from_family("grow"), {"hits": 1}, 0.35)
            chase = None
            fade = 0.3
            why = "build at %.1fs, E %.2f - one lamp added at a time" % (mom[0], r["E"])
        elif kind in ("entrance", "vocal_return", "melody_resume"):
            look = {"lamps": {"c": colour, "l": level}}
            add_layers = pair(from_family("pass"), {"hits": 1}, 0.45, move=True)
            chase = None
            fade = 0.12
            why = "%s at %.1fs - %s lead, E %.2f" % (kind, mom[0], top_fam, r["E"])
        elif kind in (
            "register_shift",
            "rhythm_change",
            "tempo_change",
            "harmonic_rhythm",
        ):
            look = {
                "lamps": {
                    "c": "indigo" if kind == "register_shift" else colour,
                    "l": level,
                }
            }
            add_layers = pair(from_family("travel"), {"hits": 1}, 0.4, move=True)
            chase = None
            fade = 0.5
            why = "%s at %.1fs - the figure changes with the music" % (kind, mom[0])
        elif kind == "spotlight":
            look = {
                "lamps": {"c": colour, "l": max(0.12, level * 0.3)},
                "heads": {"c": colour, "l": 0.85, "pan": 0.5, "tilt": 0.28},
            }
            fade = 0.6
            why = "spotlight at %.1fs - the head points, the row stays level" % mom[0]
        else:
            e = emo_at(r["t"])
            mode = e.get("mode")
            bright = e.get("brightness")
            ramp = FAMILY_TEMPERATURE.get(top_fam, ("indigo", "blood", "crimson", "scarlet"))
            if mode is None:
                warmth = 0.5
            else:
                warmth = max(0.0, min(1.0, (float(mode) + 1.0) / 2.0))
            if bright is not None:
                warmth = max(0.0, min(1.0, warmth * 0.72 + (float(bright) / 10.0) * 0.28))
            want = ramp[min(len(ramp) - 1, int(warmth * len(ramp)))]
            lab, which = sec_of.get(bar, (None, 1))
            if lab is not None:
                if lab not in sig_colour:
                    sig_colour[lab] = want
                elif not kind:
                    want = sig_colour[lab]
                n_inst = total_inst.get(lab, 1)
                if n_inst > 1:
                    level = round(min(0.97, level * (0.86 + 0.14 * (which - 1) / (n_inst - 1))), 2)
            big = kind in ("peak", "climax", "drop", "breakdown", "register_shift")
            if held_colour is None or fam_changed or big or abs(warmth - held_warmth) >= 0.45:
                main = want
                held_colour, held_warmth = want, warmth
            else:
                main = held_colour
            counter = COUNTER.get(top_fam, "indigo")
            order = sorted(r["fam"].items(), key=lambda kv: -kv[1])
            second_fam = order[1][0] if len(order) > 1 else None
            second_share = (order[1][1] / order[0][1]) if len(order) > 1 and order[0][1] else 0.0
            wants_split = second_share >= 0.62 and level > 0.3 and second_fam is not None
            if wants_split == held_split:
                split_look = held_split
            elif r["t"] - split_since >= 5.0:
                split_look = wants_split
                held_split, split_since = wants_split, r["t"]
            else:
                split_look = held_split
            if split_look:
                counter = FAMILY_COLOUR.get(second_fam, counter)
            look = {"lamps": {"c": main, "l": level}}
            here_notes = notes_in(r["t"], r["end"])
            if here_notes:
                mp = sum(p for _, p, _ in here_notes) / len(here_notes)
                tilt = round(0.46 - 0.26 * max(0.0, min(1.0, (mp - p_lo) / max(1, p_hi - p_lo))), 2)
            else:
                tilt = round(0.22 + 0.2 * ((bar % 4) / 3.0), 2)
            look["heads"] = {
                "c": counter if split_look else main,
                "l": round(min(0.85, level * 0.7), 2),
                "pan": 0.5,
                "tilt": tilt,
            }
            in_build = bar in rising
            quiet_here = bool(r.get("_quiet"))
            direction = ph["dir"] if ph is not None else "holds"
            melodic = top_fam in ("voices", "strings", "winds", "keys", "guitars")
            percussive = top_fam in ("drums", "brass")
            sings = len(here_notes) >= 7 and melodic and not in_build

            if in_build:
                want_fam = "grow"
            elif percussive and dens >= 8:
                want_fam = "room"
            elif percussive and dens >= 4:
                want_fam = "halves"
            elif sings:
                want_fam = "travel"
            elif dens >= 7:
                want_fam = "oddeven"
            elif dens >= 3:
                want_fam = "poles"
            else:
                want_fam = "halves"

            order = [g for g in GESTURES if g != "travel" or sings]
            if want_fam == held_gesture and order:
                want_fam = order[(order.index(want_fam) + 1 + (pi or 0)) % len(order)] \
                    if want_fam in order else order[(pi or 0) % len(order)]
            held_gesture = want_fam
            opts = GESTURES[want_fam]
            fig = opts[(pi or 0) % len(opts)]
            reverse_it = direction == "falls"
            if (pi or 0) % 2 == 1:
                reverse_it = not reverse_it

            deep = 0.20 if level < 0.38 else (0.30 if dens >= 6 else 0.38)
            if quiet_here:
                # nothing travels and nothing steps: one slow breath, the head
                # still, and the room left alone until the music comes back
                want_fam = "room"
                fig = "breathe"
                every = {"beats": float(per)}
                deep = 0.72
                moves = False
            moves = want_fam in ("travel", "grow")
            if sings and want_fam == "travel":
                every = {"notes": 1}
            elif dens >= 9:
                every = {"hits": 3}
            elif dens >= 6:
                every = {"hits": 2}
            elif dens >= 2:
                every = {"hits": 1}
            else:
                every = {"beats": 2}

            layers = [{
                "on": "lamps", "figure": fig, "every": every,
                "fill_beats": 1 if level < 0.45 else 2,
                "low": deep, "move_head": moves,
            }]
            if reverse_it:
                layers[0]["reverse"] = True

            chase = None
            fade = 0.0 if not fam_changed else 0.12
            if in_build:
                fade = 0.3
            why = "bars %s, the phrase %s: %s leads, E %.2f, %d hits, mode %s - %s in %s%s" % (
                ("%d-%d" % (ph["bars"][0], ph["bars"][-1])) if ph else str(bar),
                ph["word"] if ph else "holds",
                top_fam, r["E"], dens,
                ("%+.2f" % mode) if mode is not None else "?", fig, main,
                (" against %s inside" % counter) if split_look else "")
            add_layers = layers

        add(bar, fade, look, chase, why, add_layers)
        if cues and r.get("_quiet"):
            cues[-1]["_hold"] = True
        if (bar in rising and cues[-1].get("look")
                and kind not in ("peak", "climax", "drop", "pause", "exit", "spotlight", "breakdown")):
            run = sorted(q for q in rising if abs(q - bar) < 12)
            lo_b, hi_b = (min(run), max(run)) if run else (bar, bar)
            span_n = max(1, hi_b - lo_b)
            p0 = (bar - lo_b) / span_n
            p1 = min(1.0, (bar + 1 - lo_b) / span_n)
            cues[-1]["swell"] = {"from": round(0.82 + 0.18 * p0, 3),
                                 "to": round(0.82 + 0.18 * p1, 3), "curve": 1.15}
        add_layers = None
        prev_fam, prev_level, prev_set = top_fam, level, here

    first = min((c for c in cues if c.get("look")), key=lambda c: c.get("_t", 9e9), default=None)
    if first is not None and first.get("_t", 0) > 0.35 and lanes_total:
        hi_all = max(lanes_total) or 1
        win_s = (sc.get("stems_temporal") or {}).get("window_s", 0.5)
        upto = max(1, int(first.get("_t", 0) / win_s))
        med_all = sorted(x for x in lanes_total if x > 0)
        med_all = med_all[len(med_all) // 2] if med_all else hi_all
        loud_early = max(lanes_total[:upto])
        if loud_early > med_all * 0.25:
            onset = 0.0
            for w, v in enumerate(lanes_total):
                if v > med_all * 0.25:
                    onset = max(0.0, w * win_s)
                    break
            opener = json.loads(json.dumps({k: v for k, v in first.items() if k != "_t"}))
            opener["at"] = {"second": round(onset, 3)}
            opener["_t"] = onset
            opener["fade"] = 0.4
            for v in (opener.get("look") or {}).values():
                if isinstance(v, dict) and v.get("l") is not None:
                    v["l"] = round(max(0.06, v["l"] * 0.8), 2)
            opener["why"] = "the music is already playing when the show starts, so the room is not dark for it"
            cues.append(opener)
            cues.sort(key=lambda c: c.get("_t", 0))

    def bar_energy_at(tt):
        for rr in rows:
            if rr["t"] <= tt < rr["end"]:
                return rr["E"]
        return None

    for a, b, depth in holes:
        if a < 0.4:
            continue
        cues.sort(key=lambda c: c.get("_t", 0))
        prior = [c for c in cues if c.get("_t", 0) <= a + 1e-6 and c.get("look")]
        if not prior:
            later = [c for c in cues if c.get("_t", 0) > b - 1e-6 and c.get("look")]
            if later:
                prior = [later[0]]
        cues.append({"id": 0, "at": {"second": round(a, 3)}, "_t": a, "fade": 0.0,
                     "look": {},
                     "why": "the audio falls to %d%% of its median for %.2fs - a real hole, so the room goes with it"
                            % (round(depth * 100), b - a)})
        if prior:
            ahead = [c for c in cues if b - 1e-6 < c.get("_t", 0) <= b + 2.0 and c.get("look")]
            src = ahead[0] if ahead else prior[-1]
            back = json.loads(json.dumps({k: v for k, v in src.items() if k != "_t"}))
            e_out, e_in = bar_energy_at(a - 0.05), bar_energy_at(b + 0.05)
            why = "and back, the instant the audio returns"
            if not ahead and e_out and e_in and e_in > e_out * 1.15:
                lift = min(1.9, (e_in / e_out) ** 0.7)
                for v in (back.get("look") or {}).values():
                    if isinstance(v, dict) and v.get("l") is not None:
                        v["l"] = round(min(0.97, v["l"] * lift), 2)
                why = ("and back brighter, the instant the audio returns - "
                       "the bar it returns into is %.0f%% louder than the one it left"
                       % ((e_in / e_out - 1) * 100))
            elif ahead:
                why = "and back on the look it is arriving at, the instant the audio returns"
            back["at"] = {"second": round(b, 3)}
            back["_t"] = b
            back["fade"] = 0.06
            back["why"] = why
            cues.append(back)
    cues.sort(key=lambda c: c.get("_t", 0))

    accents = []
    hole_spans = [(a, b) for a, b, _ in holes]
    by_bar = {}
    for t, inten in hits:
        row = None
        for rr in rows:
            if rr["t"] <= t < rr["end"]:
                row = rr
                break
        if row is None:
            continue
        cur = by_bar.get(row["bar"])
        if cur is None or inten > cur[1]:
            by_bar[row["bar"]] = (t, inten, row)
    sec_peak = {}
    for bar, (t, inten, row) in by_bar.items():
        lab = None
        for sx in sections:
            if sx["start"] - step <= row["t"] < sx["end"]:
                lab = sx.get("label", "?") + str(round(sx["start"]))
                break
        sec_peak.setdefault(lab, []).append(inten)
    sec_ref = {k: (sorted(v)[int(len(v) * 0.7)] if v else 1.0) for k, v in sec_peak.items()}

    # A designer marks what stands out where it stands out, not everything the
    # track does. Three things earn a mark: a hit that is the largest in its own
    # neighbourhood, a moment the score names, and the first hit after the drums
    # change. Everything else is left to the look, which is already moving.
    one_bar = step * per
    win = one_bar * 0.5
    prominent = []
    for t, inten in hits:
        near = [w for u, w in hits if abs(u - t) <= win and u != t]
        if near and inten < max(near):
            continue
        rest = sorted(near)
        median_near = rest[len(rest) // 2] if rest else 0.0
        lift = inten / median_near if median_near > 0.02 else 3.0
        prominent.append((t, inten, lift))

    # A peak, climax or drop already gets its own white punch cue. Marking it
    # again with a long accent stacks two full-rig events on one moment and
    # pins the row at 255.
    punched = [t for t, kind0, _ in moments
               if kind0 in ("peak", "climax", "drop")]

    named = set()
    for t, kind0, _ in moments:
        best, bd = None, one_bar * 0.35
        for u, i0 in hits:
            if abs(u - t) < bd:
                best, bd = (u, i0), abs(u - t)
        named.add(best[0] if best else round(t, 3))

    picked = {}
    for t, inten, lift in prominent:
        picked[round(t, 3)] = (inten, lift)
    for t in named:
        if round(t, 3) not in picked:
            here = next((i0 for u, i0 in hits if abs(u - t) < 1e-6), 0.6)
            picked[round(t, 3)] = (max(here, 0.5), 2.2)

    last_t = -9.0
    for t in sorted(picked):
        inten, lift = picked[t]
        if any(a0 - 0.1 <= t <= b0 + 0.1 for a0, b0 in hole_spans):
            continue
        if t - last_t < step * 0.98:
            continue
        if any(abs(t - p0) < one_bar * 0.75 for p0 in punched):
            continue
        row_q = next((rr for rr in rows if rr["t"] <= t < rr["end"]), None)
        if row_q is not None and row_q.get("_quiet"):
            continue
        last_t = t
        big = lift >= 1.9 or t in named
        # how far above its neighbours it stands, mapped across the usable
        # range so an ordinary mark and a real event do not look the same
        spread_l = max(0.0, min(1.0, (min(2.6, lift) - 1.0) / 1.6))
        amp = round(0.30 + 0.62 * (spread_l ** 0.8) + 0.08 * inten, 3)
        if t in named:
            amp = min(1.0, amp + 0.18)
        accents.append({"t": round(t, 3), "l": round(amp, 2),
                        "decay": round(beat_at(t) * (2.0 if big else 0.75), 3),
                        "hold": 0.72 if big else 0.22,
                        "on": "lamps"})

    for n, c in enumerate(cues):
        nxt = cues[n + 1] if n + 1 < len(cues) else None
        if not nxt or not c.get("look"):
            continue
        w = (nxt.get("why") or "")
        if w.startswith("PEAK") or w.startswith("climax") or w.startswith("build"):
            c["swell"] = {"from": 0.84, "to": 1.0, "curve": 1.6}

    def rank(c):
        w = c.get("why") or ""
        if not c.get("look"):
            return 5
        for tag in ("PEAK", "climax", "drop", "and back", "the audio falls",
                    "pause", "exit", "breakdown", "draws back", "lands at"):
            if tag in w:
                return 5
        if "the phrase" in w:
            return 4
        if "register_shift" in w or "entrance" in w or "spotlight" in w or "build at" in w:
            return 3
        if "the harmony turns" in w:
            return 2
        return 1

    MIN_GAP = 0.95
    cues.sort(key=lambda c: (c.get("_t", 0), -rank(c)))
    kept = []
    for c in cues:
        if not kept:
            kept.append(c)
            continue
        last = kept[-1]
        if c.get("_t", 0) - last.get("_t", 0) >= MIN_GAP:
            kept.append(c)
            continue
        if not last.get("look") and c.get("look"):
            kept.append(c)
        elif rank(c) > rank(last):
            kept[-1] = c
        elif rank(c) == rank(last) == 5:
            kept.append(c)
    cues = kept

    MOMENT_OWNED = ("PEAK", "climax", "drop", "register_shift", "breakdown",
                    "the audio falls", "draws back")
    by_label = {}
    for c in cues:
        t = c.get("_t", 0)
        lab = None
        for sx in sections:
            if sx["start"] - step <= t < sx["end"]:
                lab = sx.get("label", "?")
                break
        if lab is None or not c.get("look"):
            continue
        why = c.get("why") or ""
        if any(m in why for m in MOMENT_OWNED):
            continue
        for v in c["look"].values():
            if isinstance(v, dict) and v.get("c"):
                by_label.setdefault(lab, collections.Counter())[v["c"]] += 1
    signature = {lab: cnt.most_common(1)[0][0] for lab, cnt in by_label.items()}
    for c in cues:
        t = c.get("_t", 0)
        lab = None
        for sx in sections:
            if sx["start"] - step <= t < sx["end"]:
                lab = sx.get("label", "?")
                break
        if lab is None or lab not in signature or not c.get("look"):
            continue
        why = c.get("why") or ""
        if any(m in why for m in MOMENT_OWNED):
            continue
        main_c = signature[lab]
        keys = [k for k, v in c["look"].items() if isinstance(v, dict) and v.get("c")]
        if not keys:
            continue
        lead = [k for k in keys if k in ("lamps", "outer", "ends")] or keys[:1]
        for k in lead:
            c["look"][k]["c"] = main_c

    BIG = ("PEAK", "climax", "drop", "breakdown", "register_shift", "the audio falls")
    last_change = -9.0
    held = None
    for c in cues:
        look = c.get("look") or {}
        cols = [v for v in look.values() if isinstance(v, dict) and v.get("c")]
        if not cols:
            continue
        here = tuple(sorted({v["c"] for v in cols}))
        why = c.get("why") or ""
        big = any(b in why for b in BIG) or "and back" in why
        t = c.get("_t", 0)
        if held is None or here == held:
            held = here
            last_change = t if held != here else last_change
            continue
        if not big and t - last_change < 4.0:
            swap = dict(zip(here, held)) if len(here) == len(held) else {k: held[0] for k in here}
            for v in cols:
                v["c"] = swap.get(v["c"], held[0])
            continue
        held = here
        last_change = t

    beat_times = sorted(x["t"] for x in sc.get("beats", []))
    hit_times = sorted(t for t, _ in hits)
    HOLD_WHY = ("a real hole", "and back")

    def nearest_of(t0, xs, tol):
        best, bd = None, tol
        for x in xs:
            d = abs(x - t0)
            if d < bd:
                best, bd = x, d
        return best

    cues.sort(key=lambda c: c.get("_t", 0))
    for c in cues:
        t0 = c.get("_t")
        if t0 is None or t0 <= 0:
            continue
        if any(k in (c.get("why") or "") for k in HOLD_WHY):
            continue
        snapped = nearest_of(t0, hit_times, step * 0.55)
        if snapped is None:
            snapped = nearest_of(t0, beat_times, step * 0.55)
        if snapped is None or snapped <= 0:
            continue
        c["_t"] = snapped
        c["at"] = {"second": round(snapped, 3)}
    cues.sort(key=lambda c: c.get("_t", 0))
    keep = []
    for c in cues:
        if keep and abs(c.get("_t", 0) - keep[-1].get("_t", 0)) < 1e-6:
            continue
        keep.append(c)
    cues = keep

    FAM_OF = {}
    for _fam, _figs in GESTURES.items():
        for _f in _figs:
            FAM_OF[_f] = _fam

    bar_s = step * per
    song_end = sc["song"]["length_s"]

    n_lamps = lamp_count()

    TRAVELS_HOME = ("travel", "grow")
    COLOUR_FOR = {
        "travel": "halves", "grow": "poles", "halves": "poles",
        "oddeven": "halves", "poles": "halves", "room": "flip",
    }

    HEAD_FOR = {
        "travel": ("sweep", 2), "grow": ("arc", 2), "halves": ("nod", 1),
        "oddeven": ("nod", 1), "poles": ("dip", 2), "room": ("circle", 4),
    }

    def steer(cue, fam, climbing=False):
        move, bars = HEAD_FOR.get(fam, ("drift", 4))
        if climbing:
            move, bars = "nod", 1
        cue["head"] = {"move": move, "every": {"bars": bars}}

    def dress(chase, fam, pair, span_s=None):
        if not pair or len(pair) < 2:
            return
        rate = float((chase.get("every") or {}).get("beats") or 1.0)
        every = max(1, int(round(per * 2.0 / max(0.25, rate))))
        chase["colours"] = list(pair)
        chase["colour_every"] = every
        holds = span_s is not None and span_s < every * rate * step * 2.0
        chase["colour_figure"] = "hold" if holds else COLOUR_FOR.get(fam, "halves")

    MUSICAL = (0.5, 1.0, 1.5, 2.0, 3.0, 4.0)

    def fit_rate(fig, span_s, push=1, fam=None, at_t=None):
        steps = cycle_steps(fig, n_lamps)
        local = beat_at(at_t) if at_t is not None else step
        beats_in = span_s / local if local > 0 else 0
        if beats_in <= 0 or steps <= 0:
            return None
        home = 1 if (fam in TRAVELS_HOME or FAM_OF.get(fig) in TRAVELS_HOME) else 0
        floor_beats = max(0.5, 0.26 / local if local > 0 else 0.5)
        best = None
        for rate in MUSICAL:
            if rate < floor_beats - 1e-6:
                continue
            per_cycle = steps * rate
            cycles = int(round((beats_in - home * rate) / per_cycle))
            if push > 1:
                cycles = max(cycles, 1) * push
            if cycles < 1:
                continue
            used = cycles * per_cycle + home * rate
            if used > beats_in + rate * 0.5:
                continue
            miss = abs(beats_in - used)
            if miss > max(rate, beats_in * 0.25):
                continue
            score = (miss, abs(rate - 1.0))
            if best is None or score < best[0]:
                best = (score, rate, cycles)
        if best is None:
            return None
        return best[1], best[2]

    recent_fams = []

    def choose_figure(span_s, want_fam, avoid, push=1, at_t=None):
        order = [want_fam] + [f for f in GESTURES if f != want_fam]
        if recent_fams[-3:].count("travel") >= 1:
            order = [f for f in order if f != "travel"] + ["travel"]
        for fam in order:
            opts = [f for f in GESTURES[fam] if f not in avoid] or list(GESTURES[fam])
            for fig in opts:
                fit = fit_rate(fig, span_s, push, fam, at_t)
                if fit:
                    recent_fams.append(fam)
                    return fig, fit, fam
        return None, None, want_fam

    strong = []
    if hits:
        hi = sorted(i for _, i in hits)
        cut = hi[int(len(hi) * 0.72)] if hi else 0
        strong = [t for t, i in hits if i >= cut]
    anchors = sorted(set([t for t, _, _ in moments] + strong))

    def snap(t0, window):
        best, bd = None, window
        for a in anchors:
            d = abs(a - t0)
            if d < bd:
                best, bd = a, d
        return best


    def rgb_of(name):
        h = PALETTE.get(name, "#000000").lstrip("#")
        return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))

    def lum_of(name):
        h = PALETTE.get(name, "#000000").lstrip("#")
        r, g, b_ = (int(h[i:i + 2], 16) for i in (0, 2, 4))
        return (0.299 * r + 0.587 * g + 0.114 * b_) / 255.0

    BRIGHT = sorted(PALETTE, key=lambda n: -lum_of(n))

    def open_up(name, want):
        here = lum_of(name)
        if here * want >= 0.42:
            return name
        for cand in sorted(working, key=lum_of, reverse=True):
            if lum_of(cand) * want >= 0.42:
                return cand
        return max(working, key=lum_of) if working else name

    fam_seen = collections.Counter()
    for c in cues:
        for v in (c.get("look") or {}).values():
            if isinstance(v, dict) and v.get("c"):
                fam_seen[v["c"]] += 1
    lead_colour = fam_seen.most_common(1)[0][0] if fam_seen else "ember"
    def hue_of_name(name):
        r, g, b_ = rgb_of(name)
        mx, mn = max(r, g, b_), min(r, g, b_)
        if mx == mn:
            return None
        d = float(mx - mn)
        if mx == r:
            h = ((g - b_) / d) % 6
        elif mx == g:
            h = (b_ - r) / d + 2
        else:
            h = (r - g) / d + 4
        return h * 60.0

    def hue_gap(a, b2):
        ha, hb = hue_of_name(a), hue_of_name(b2)
        if ha is None or hb is None:
            return 0.0
        d = abs(ha - hb) % 360.0
        return min(d, 360.0 - d)

    vivid = [n for n in PALETTE
             if n != "bone" and lum_of(n) >= 0.22 and hue_of_name(n) is not None]
    counter_name = max(
        vivid,
        key=lambda n: hue_gap(lead_colour, n) - 260.0 * abs(lum_of(n) - lum_of(lead_colour))
    ) if vivid else "indigo"
    warm = max(("amber", "saffron", "ember"), key=lum_of)
    working = []
    for name in (lead_colour, counter_name, warm, "bone"):
        if name in PALETTE and name not in working:
            working.append(name)

    def shift_colour(name):
        if name in working and len(working) > 1:
            k = working.index(name)
            return working[(k + 1) % len(working)]
        return name

    def nearest(name):
        if name in working:
            return name
        r0, g0, b0 = rgb_of(name)
        return min(working, key=lambda w: sum(
            (a - c) ** 2 for a, c in zip(rgb_of(w), (r0, g0, b0))))

    for c in cues:
        for v in (c.get("look") or {}).values():
            if isinstance(v, dict) and v.get("c"):
                v["c"] = nearest(v["c"])
        for ch0 in (c.get("chases") or []):
            if ch0.get("c"):
                ch0["c"] = nearest(ch0["c"])
            if ch0.get("colours"):
                ch0["colours"] = [nearest(x) for x in ch0["colours"]]

    punches = []
    for c in cues:
        w = c.get("why") or ""
        if not any(k in w for k in ("PEAK", "climax", "drop at", "drop -", "the drop")):
            continue
        punches.append(c)
        for v in (c.get("look") or {}).values():
            if isinstance(v, dict) and v.get("l") is not None:
                v["c"] = "bone"
                v["l"] = round(min(1.0, max(v["l"], 0.9)), 2)
        c["why"] = w + " - white, because only white carries a hit"
        heads = (c.get("look") or {}).get("heads")
        if isinstance(heads, dict):
            heads["strobe"] = 0.5
            heads["prism"] = 0.6
        # The two biggest moments in the show were holding a static white wash
        # for four and six seconds with nothing moving at all. A peak is the
        # most active moment a show has, not the least.
        if not c.get("chases"):
            c["chases"] = [{"on": "lamps", "figure": "pulse",
                            "every": {"beats": 0.5}, "low": 0.55,
                            "move_head": False, "min_step_beats": 0.5}]
            c["head"] = {"move": "nod", "every": {"bars": 1}}
            c["why"] = c["why"] + ", the row pulsing on the half beat and the head working"

    dark = []
    for c in punches:
        t0 = c.get("_t")
        if t0 is None or t0 <= step:
            continue
        near = min((abs(t0 - o.get("_t", -9)) for o in cues if o is not c), default=9)
        if near < step * 0.9:
            continue
        dark.append({"id": 0, "at": {"second": round(t0 - step, 3)}, "_t": t0 - step,
                     "fade": 0.0, "look": {},
                     "why": "one beat of black, so the hit that follows has somewhere to land"})
    cues.extend(dark)
    cues.sort(key=lambda c: c.get("_t", 0))

    bright_ranked = sorted(working, key=lum_of, reverse=True)
    for c in cues:
        lamps = (c.get("look") or {}).get("lamps")
        if not isinstance(lamps, dict) or lamps.get("l") is None or not lamps.get("c"):
            continue
        if lamps["l"] >= 0.80 and bright_ranked:
            top = bright_ranked[0]
            if lum_of(top) > lum_of(lamps["c"]) + 0.15:
                was = lamps["c"]
                for v in (c.get("look") or {}).values():
                    if isinstance(v, dict) and v.get("c") == was:
                        v["c"] = top
                for ch0 in (c.get("chases") or []):
                    if ch0.get("colours"):
                        ch0["colours"] = [top if x == was else x for x in ch0["colours"]]
                c["why"] = (c.get("why") or "") + (
                    " - opened to %s: at this level colour is the ceiling, not the fader" % top)
        if lamps["l"] < 0.68:
            continue
        opened = open_up(lamps["c"], lamps["l"])
        if opened != lamps["c"]:
            was = lamps["c"]
            for v in (c.get("look") or {}).values():
                if isinstance(v, dict) and v.get("c") == was:
                    v["c"] = opened
            c["why"] = (c.get("why") or "") + (
                " - opened from %s to %s so the level can be seen" % (was, opened))

    arrival = None
    for t0, kind0, _ in moments:
        if kind0 in ("entrance", "drop", "climax", "peak", "register_shift"):
            arrival = t0
            break
    if arrival is None and len(sections) > 1:
        arrival = float(sections[0]["end"])
    hold_until = 0.0
    if arrival is not None and bar_s > 0:
        hold_until = min(float(arrival), bar_s * 16.0)

    if bar_s > 0:
        target = bar_s * 2.0
        cues.sort(key=lambda c: c.get("_t", 0))
        extra = []
        seen_recent = []
        for i, c in enumerate(cues):
            ch = (c.get("chases") or [None])[0]
            if not ch or not ch.get("figure"):
                continue
            if c.get("_hold"):
                # the music is thin here; it was given one slow breath on
                # purpose and nothing downstream gets to make it busy again
                ch["figure"] = "breathe"
                ch["every"] = {"beats": float(per)}
                ch["low"] = 0.72
                ch["move_head"] = False
                ch.pop("cycles", None)
                ch.pop("colours", None)
                ch["colour_figure"] = "hold"
                c["head"] = {"move": "park", "every": {"bars": 8}}
                c["why"] = (c.get("why") or "").split(" - ")[0] + (
                    " - the drums have stopped, so the room just breathes until they return")
                continue
            end = cues[i + 1]["_t"] if i + 1 < len(cues) else song_end
            span = end - c.get("_t", 0)
            parts = 1
            if span >= target * 1.3:
                parts = max(2, min(3, int(round(span / target))))
            cuts = []
            for k in range(1, parts):
                at_t = c["_t"] + span * k / parts
                lo_t, hi_t = c["_t"] + bar_s * 0.4, end - bar_s * 0.4
                hit_t = snap(at_t, bar_s * 0.6)
                if hit_t is not None and lo_t < hit_t < hi_t:
                    cuts.append((hit_t, True))
                    continue
                on_hit_t = nearest_of(at_t, hit_times, step * 0.9)
                if on_hit_t is not None and lo_t < on_hit_t < hi_t:
                    cuts.append((on_hit_t, True))
                    continue
                bt = nearest_of(at_t, beat_times, step * 0.9)
                cuts.append(((bt if bt is not None and lo_t < bt < hi_t else at_t), False))
            bounds = [c["_t"]] + [t for t, _ in cuts] + [end]
            here_fam = FAM_OF.get(ch["figure"], "travel")
            fam_ring = [here_fam] + [f for f in GESTURES if f != here_fam]
            prev_col = None
            if i > 0:
                pl = (cues[i - 1].get("look") or {}).get("lamps")
                if isinstance(pl, dict):
                    prev_col = pl.get("c")
            climbing = bool(c.get("swell"))
            pair = None
            if len(working) > 1:
                lead0 = working[0]
                mates = [w for w in working[1:]
                         if abs(lum_of(w) - lum_of(lead0)) <= 0.16 and hue_gap(lead0, w) >= 60]
                if mates:
                    pair = [lead0, max(mates, key=lambda w: hue_gap(lead0, w))]
            def lock_to_rhythm(chase, fam, span_s):
                if fam not in RHYTHMIC:
                    return False
                n_hits = sum(1 for t0, i0 in hits
                             if c["_t"] <= t0 < c["_t"] + span_s and i0 >= 0.3)
                if n_hits < 4:
                    return False
                per_step = span_s / n_hits
                n = 1 if per_step >= step * 0.75 else 2
                chase["every"] = {"hits": n}
                chase["min_intensity"] = 0.3
                chase["fill_beats"] = 2
                return True

            pair = [working[0], working[1]] if len(working) > 1 else None
            fig0, fit, fam0 = choose_figure(bounds[1] - bounds[0], here_fam, seen_recent, 1, c["_t"])
            if fig0:
                if fig0 != ch["figure"]:
                    ch["figure"] = fig0
                    ch["move_head"] = fam0 in ("travel", "grow")
                    c["why"] = (c.get("why") or "") + (
                        " - %s instead, the only shape that finishes in %.1f bars"
                        % (fig0, (bounds[1] - bounds[0]) / bar_s))
                ch["every"] = {"beats": fit[0]}
                ch["cycles"] = fit[1]
                if lock_to_rhythm(ch, fam0, bounds[1] - bounds[0]):
                    ch.pop("cycles", None)
                dress(ch, fam0, pair, bounds[1] - bounds[0])
                steer(c, fam0, climbing)
            seen_recent = (seen_recent + [ch["figure"]])[-4:]
            for k, (at_t, on_hit) in enumerate(cuts, start=1):
                seg = bounds[k + 1] - bounds[k]
                if climbing:
                    pick_fam = "room" if k > 1 else "halves"
                else:
                    pick_fam = fam_ring[(i + k) % len(fam_ring)]
                nxt, vfit0, pick_fam = choose_figure(
                    seg, pick_fam, seen_recent, 2 ** k if climbing else 1, at_t)
                if not nxt:
                    continue
                seen_recent = (seen_recent + [nxt])[-4:]
                var = json.loads(json.dumps({x: y for x, y in c.items() if x != "_t"}))
                var["at"] = {"second": round(at_t, 3)}
                var["_t"] = at_t
                var["fade"] = 0.0
                var.pop("swell", None)
                vch = (var.get("chases") or [{}])[0]
                vch["figure"] = nxt
                vch["reverse"] = (not ch.get("reverse", False)) if k % 2 else ch.get("reverse", False)
                vch["move_head"] = pick_fam in ("travel", "grow")
                vch["figure"] = nxt
                if on_hit and seg >= bar_s and not climbing:
                    for v in (var.get("look") or {}).values():
                        if isinstance(v, dict) and v.get("c"):
                            nc = shift_colour(v["c"])
                            if nc != prev_col:
                                v["c"] = nc
                vfit = vfit0
                vch["every"] = {"beats": vfit[0]}
                vch["cycles"] = vfit[1]
                if lock_to_rhythm(vch, pick_fam, seg):
                    vch.pop("cycles", None)
                dress(vch, pick_fam, pair, seg)
                steer(var, pick_fam, climbing)
                var["why"] = ("%s answers %s, a whole %d cycles%s"
                              % (nxt, ch["figure"], (vfit[1] if vfit else 1),
                                 (", landing on the hit at %.2fs with a new colour" % at_t)
                                 if on_hit else ", mid-phrase")
                              + (", twice the rate - the build is accelerating" if climbing else ""))
                extra.append(var)
        cues.extend(extra)
        cues.sort(key=lambda c: c.get("_t", 0))

    for c in cues:
        for v in (c.get("look") or {}).values():
            if isinstance(v, dict) and v.get("c"):
                v["c"] = nearest(v["c"])
        for ch0 in (c.get("chases") or []):
            if ch0.get("c"):
                ch0["c"] = nearest(ch0["c"])
            if ch0.get("colours"):
                ch0["colours"] = [nearest(x) for x in ch0["colours"]]

    REF_LUM = 0.55
    for c in cues:
        if "only white carries a hit" in (c.get("why") or ""):
            continue
        in_play = set()
        for ch0 in (c.get("chases") or []):
            in_play.update(ch0.get("colours") or [])
        for v in (c.get("look") or {}).values():
            if isinstance(v, dict) and v.get("c"):
                in_play.add(v["c"])
        floor_lum = min([lum_of(x) for x in in_play] or [REF_LUM])
        # Capping every colour at what the darkest one can reach held the whole
        # show to what a saturated red can do - the loudest bar in the song came
        # out the same brightness as a middling one. When the music wants more
        # than the dark member of the ring can give, open the ring instead.
        lamps0 = (c.get("look") or {}).get("lamps")
        want = float(lamps0["l"]) * REF_LUM if isinstance(lamps0, dict) and lamps0.get("l") is not None else 0.0
        if want > floor_lum + 1e-6:
            better = sorted((x for x in working if lum_of(x) >= want),
                            key=lum_of)
            if better:
                swap_to = better[0]
                for ch0 in (c.get("chases") or []):
                    if ch0.get("colours"):
                        ch0["colours"] = [swap_to if lum_of(x) < want else x
                                          for x in ch0["colours"]]
                for v0 in (c.get("look") or {}).values():
                    if isinstance(v0, dict) and v0.get("c") and lum_of(v0["c"]) < want:
                        v0["c"] = swap_to
                in_play = set()
                for ch0 in (c.get("chases") or []):
                    in_play.update(ch0.get("colours") or [])
                for v0 in (c.get("look") or {}).values():
                    if isinstance(v0, dict) and v0.get("c"):
                        in_play.add(v0["c"])
                floor_lum = min([lum_of(x) for x in in_play] or [REF_LUM])
                c["why"] = (c.get("why") or "") + (
                    " - opened to %s: this level needs more than a dark colour can give" % swap_to)
        for v in (c.get("look") or {}).values():
            if not isinstance(v, dict) or v.get("l") is None or not v.get("c"):
                continue
            lv = lum_of(v["c"])
            if lv <= 0.01:
                continue
            target = min(v["l"] * REF_LUM, floor_lum)
            v["l"] = round(max(0.02, min(1.0, target / lv)), 3)

    if hold_until > 0:
        opening = [c for c in cues if c.get("_t", 0) < hold_until - 0.05]
        keep = None
        for c in sorted(opening, key=lambda x: x.get("_t", 0)):
            if c.get("look"):
                keep = c
                break
        for c in opening:
            ch0 = (c.get("chases") or [None])[0]
            if ch0 and FAM_OF.get(ch0.get("figure")) in ("travel", "grow"):
                ch0["figure"] = "breathe"
                ch0["low"] = 0.62
                ch0["move_head"] = False
                ch0["every"] = {"beats": float(per)}
                ch0.pop("cycles", None)
                ch0["colour_figure"] = "hold"
                c["why"] = ((c.get("why") or "").split(" - ")[0] +
                            " - the room breathes but nothing travels: the first thing that "
                            "moves across the rig is the entrance at %.2fs" % (arrival or hold_until))
            if keep is not None and c is not keep and c.get("look") and c.get("_t", 0) > 0.4:
                c["look"] = json.loads(json.dumps(keep["look"]))
            c["head"] = {"move": "park", "every": {"bars": 8}}
        rise = sorted(opening, key=lambda x: x.get("_t", 0))
        rise = [c for c in rise if c.get("look")]
        if rise:
            span = max(1e-6, hold_until - rise[0].get("_t", 0))
            for c in rise:
                p0 = (c.get("_t", 0) - rise[0].get("_t", 0)) / span
                p1 = min(1.0, p0 + 0.34)
                lo, hi = 0.10 + 0.82 * (p0 ** 1.25), 0.10 + 0.82 * (p1 ** 1.25)
                c["swell"] = {"from": round(lo, 3), "to": round(hi, 3), "curve": 1.25}
                c["why"] = ((c.get("why") or "").split(" - ")[0] +
                            " - the opening comes up gradually, %d%% to %d%% of the look, "
                            "arriving full at the entrance" % (round(lo * 100), round(hi * 100)))

    SUDDEN = ("only white carries a hit", "one beat of black", "a real hole",
              "and back", "PEAK", "climax", "the drop")
    cues.sort(key=lambda c: c.get("_t", 0))
    for n, c in enumerate(cues):
        w = c.get("why") or ""
        nxt_w = (cues[n + 1].get("why") or "") if n + 1 < len(cues) else ""
        if any(k in w for k in SUDDEN) or "one beat of black" in nxt_w:
            c["fade"] = 0.0
            continue
        prev = cues[n - 1] if n else None
        changed_look = True
        if prev is not None:
            a = {k: (v.get("c"), v.get("l")) for k, v in (prev.get("look") or {}).items()
                 if isinstance(v, dict)}
            b2 = {k: (v.get("c"), v.get("l")) for k, v in (c.get("look") or {}).items()
                  if isinstance(v, dict)}
            changed_look = a != b2
        want_beats = 0.5 if changed_look else 0.25
        ch1 = (c.get("chases") or [None])[0]
        if ch1 and (ch1.get("every") or {}).get("beats"):
            room_beats = float(ch1["every"]["beats"]) * 0.7
            for cand in (0.5, 0.25, 0.125):
                if cand <= room_beats:
                    want_beats = min(want_beats, cand)
                    break
            else:
                want_beats = 0.125
        c["fade"] = round(beat_at(c.get("_t", 0)) * want_beats, 3)

    # Passes downstream replace a figure or a colour without touching the
    # sentence that explains it, so a cue could claim to answer a figure that is
    # no longer there, or to arrive with a colour it did not change. A reason
    # that is not true is worse than no reason.
    prev_fig, prev_col = None, None
    for c in sorted(cues, key=lambda x: x.get("_t", 0)):
        ch0 = (c.get("chases") or [None])[0]
        fig0 = ch0.get("figure") if ch0 else None
        lam0 = (c.get("look") or {}).get("lamps") or {}
        col0 = lam0.get("c")
        w = c.get("why") or ""
        if " answers " in w:
            head, _, tail = w.partition(" answers ")
            rest = tail.split(",", 1)[1] if "," in tail else ""
            said = tail.split(",", 1)[0].strip()
            if prev_fig and said != prev_fig:
                w = "%s answers %s%s%s" % (fig0 or head, prev_fig, "," if rest else "", rest)
            elif not prev_fig:
                w = "%s opens%s%s" % (fig0 or head, "," if rest else "", rest)
        if "with a new colour" in w and col0 == prev_col:
            w = w.replace(" with a new colour", "")
        c["why"] = w
        prev_fig, prev_col = fig0 or prev_fig, col0 or prev_col

    # A cue with no room to be seen is not a cue.
    cues.sort(key=lambda c: c.get("_t", 0))
    trimmed = []
    for n, c in enumerate(cues):
        nxt = cues[n + 1]["_t"] if n + 1 < len(cues) else song_end
        if nxt - c.get("_t", 0) < 0.12 and c.get("look"):
            continue
        trimmed.append(c)
    cues = trimmed

    for c in cues:
        c.pop("_t", None)

    show_effects = [
        {"attr": "intensity", "on": "lamps", "form": "sine",
         "size": 0.12, "rate": {"bars": 6}, "phase": 0,
         "why": "a slow breath on the submaster, the whole row together, so the rig is never dead still"},
        {"attr": "pan", "on": "heads", "form": "sine",
         "size": 0.16, "rate": {"bars": 8}, "phase": 0,
         "why": "the beam drifts across the room over eight bars"},
        {"attr": "tilt", "on": "heads", "form": "triangle",
         "size": 0.07, "rate": {"bars": 6}, "phase": 0,
         "why": "and lifts and settles on a slower cycle, so the two never line up"},
    ]

    def cue_seconds_of(c):
        a = c.get("at")
        if not isinstance(a, dict):
            return None
        if "second" in a:
            return float(a["second"])
        if "bar" in a:
            return float(at(int(a["bar"]), int(a.get("beat", 1))))
        return None

    def hex_of(name):
        return PALETTE.get(name, "#ffffff")

    def section_of(t0):
        for n, sx in enumerate(sections):
            if sx["start"] - 1e-6 <= t0 < sx["end"]:
                return n
        return max(0, len(sections) - 1)

    ordered = sorted(cues, key=lambda c: (cue_seconds_of(c) if cue_seconds_of(c) is not None else 0.0))
    states, gestures = [], []
    for n, c in enumerate(ordered):
        t0 = cue_seconds_of(c)
        if t0 is None:
            continue
        t1 = None
        for later in ordered[n + 1:]:
            t1 = cue_seconds_of(later)
            if t1 is not None and t1 > t0:
                break
            t1 = None
        if t1 is None:
            t1 = song_end
        look = c.get("look") or {}
        fade_ms = int(round(float(c.get("fade") or 0) * 1000))
        why = (c.get("why") or "")[:180]
        if not look:
            gestures.append({"effect": "blackout", "extent": "all", "head": True,
                             "from_s": round(t0, 3), "to_s": round(t1, 3),
                             "fade_ms": fade_ms, "why": why})
            continue
        lamps = look.get("lamps") or look.get("all")
        if isinstance(lamps, dict) and lamps.get("l") is not None:
            states.append({"effect": "wash", "extent": "all", "head": False,
                           "amount": round(float(lamps["l"]), 3),
                           "colour": hex_of(lamps.get("c")),
                           "fade_ms": fade_ms, "section": section_of(t0),
                           "from_s": round(t0, 3), "to_s": round(t1, 3), "why": why})
        heads = look.get("heads")
        if isinstance(heads, dict) and heads.get("l") is not None:
            mv = (c.get("head") or {}).get("move", "hold")
            gestures.append({"effect": "beam", "pattern": mv,
                             "pan": round(float(heads.get("pan", 0.5)), 3),
                             "tilt": round(float(heads.get("tilt", 0.35)), 3),
                             "colour": hex_of(heads.get("c")),
                             "amount": round(float(heads["l"]), 3),
                             "prism": int(round(float(heads.get("prism") or 0) * 100)),
                             "strobe": int(round(float(heads.get("strobe") or 0) * 100)),
                             "from_s": round(t0, 3), "to_s": round(t1, 3),
                             "fade_ms": fade_ms, "why": why})
    for a in accents:
        beats = max(1, int(round(float(a.get("decay") or step) / step)))
        gestures.append({"effect": "glare", "colour": hex_of("bone"),
                         "amount": round(float(a.get("l") or 1), 3), "extent": "all",
                         "at_s": round(float(a["t"]), 3), "for_beats": beats,
                         "fade_ms": 0, "head": False,
                         "why": "a flash on the hit, the whole row lifted together"})
    gestures.sort(key=lambda g: g.get("from_s", g.get("at_s", 0)))

    doc = {
        "schema": "limelight.cuelist/1",
        "states": states,
        "bindings": [],
        "gestures": gestures,
        "song": song,
        "rig": "arc4-head",
        "palette": PALETTE,
        "cues": cues,
        "accents": accents,
        "effects": show_effects,
    }
    out_path = out_path or os.path.join(HERE, "shows", "%s.cues.json" % song)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w") as fh:
        json.dump(doc, fh, indent=1)
    n_chase = sum(1 for c in cues if c.get("chase"))
    print(
        "  %s: %d cues (%d with a chase) -> %s" % (song, len(cues), n_chase, out_path)
    )
    return doc


if __name__ == "__main__":
    author(sys.argv[1] if len(sys.argv) > 1 else "raga-of-revenge")
