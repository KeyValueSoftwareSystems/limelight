import json
import os
import subprocess
import sys

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
    "guitars": "ember",
    "keys": "teal",
    "winds": "saffron",
    "voices": "crimson",
    "drums": "scarlet",
}
FAMILY_SHADES = {
    "brass": ("amber", "saffron", "ember"),
    "strings": ("violet", "indigo", "oxblood"),
    "guitars": ("ember", "scarlet", "amber"),
    "keys": ("teal", "indigo", "violet"),
    "winds": ("saffron", "amber", "bone"),
    "voices": ("crimson", "blood", "scarlet"),
    "drums": ("scarlet", "ember", "crimson"),
}
FAMILY_TEMPERATURE = {
    "brass": ("violet", "ember", "amber", "saffron"),
    "strings": ("indigo", "violet", "oxblood", "amber"),
    "guitars": ("oxblood", "ember", "scarlet", "amber"),
    "keys": ("indigo", "teal", "violet", "saffron"),
    "winds": ("teal", "saffron", "amber", "bone"),
    "voices": ("indigo", "blood", "crimson", "scarlet"),
    "drums": ("blood", "crimson", "scarlet", "ember"),
}
COUNTER = {
    "brass": "indigo", "strings": "amber", "guitars": "teal", "keys": "ember",
    "winds": "violet", "voices": "indigo", "drums": "teal",
}
PALETTE = {
    "ink": "#140a12",
    "oxblood": "#3d0812",
    "blood": "#a3081c",
    "crimson": "#c8102e",
    "scarlet": "#f01a10",
    "ember": "#ff5a0a",
    "amber": "#ffa016",
    "saffron": "#ffd166",
    "violet": "#6a2ca0",
    "indigo": "#2a3f9e",
    "teal": "#0e8a8a",
    "bone": "#ffffff",
}


def holes_in(song, floor=0.30, min_len=0.14):
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

    return per, at, step


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
    per, at, step = grid_of(sc)
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
    peak_t = None
    for t, kind, w in moments:
        if kind == "peak":
            peak_t = t
    if peak_t is None:
        peak_t = max(rows, key=lambda r: r["E"])["t"]
    span = rows[-1]["end"] or 1.0

    def arc(t):
        if t <= peak_t:
            return 0.60 + 0.40 * (t / peak_t if peak_t else 1.0) ** 0.75
        tail = (t - peak_t) / max(1e-6, span - peak_t)
        return 1.0 - 0.62 * tail ** 0.8

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
        for t, kind, w in moments:
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

    rising = set()
    for k in range(len(rows)):
        run = 0
        j = k
        while j + 1 < len(rows) and rows[j + 1]["E"] >= rows[j]["E"] * 0.92:
            j += 1
            run += 1
        if run >= 3 and rows[j]["E"] >= rows[k]["E"] * 1.25:
            for q in range(k, j + 1):
                rising.add(rows[q]["bar"])

    prev_fam = None
    held_fam = None
    held_colour = None
    held_warmth = 0.0
    prev_level = 0.0
    prev_set = set()
    add_layers = None
    for r in rows:
        bar = r["bar"]
        mom = moment_at(bar)
        kind = mom[1] if mom else ""
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
        e = r["E"] / Emax
        level = round(min(0.97, (0.12 + 0.80 * (e**0.8)) * arc(r["t"])), 2)

        is_edge = any(abs(s["start"] - r["t"]) < step for s in sections)
        want = bool(kind) or fam_changed or churn >= 7 or bar == 1
        if not want and abs(level - prev_level) < 0.14:
            continue

        colour = FAMILY_COLOUR.get(top_fam, "crimson")
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
                "heads": {"c": "bone", "l": 1.0, "pan": 0.5, "tilt": 0.26},
            }
            fade = 0.0
            chase = {"on": "lamps", "figure": "pulse", "every": {"hits": 1}, "low": 0.6}
            why = (
                "PEAK at %.1fs - the loudest instant in the recording. Full blast, the only white"
                % mom[0]
            )
        elif kind in ("climax", "drop"):
            look = {
                "lamps": {"c": "scarlet", "l": min(0.98, level + 0.2)},
                "heads": {"c": "scarlet", "l": 0.6, "pan": 0.5, "tilt": 0.3},
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
            chase = {"on": "lamps", "figure": "build", "every": {"hits": 1}, "low": 0.35}
            fade = 0.3
            why = "build at %.1fs, E %.2f - one lamp added at a time" % (mom[0], r["E"])
        elif kind in ("entrance", "vocal_return", "melody_resume"):
            look = {"lamps": {"c": colour, "l": level}}
            chase = {"on": "lamps", "figure": "handover", "every": {"hits": 1},
                     "low": 0.45, "move_head": True}
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
            chase = {"on": "lamps", "figure": "comet", "every": {"hits": 1},
                     "low": 0.4, "move_head": True}
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
            split_look = second_share >= 0.62 and level > 0.3 and second_fam is not None
            if split_look:
                counter = FAMILY_COLOUR.get(second_fam, counter)
            if split_look:
                look = {
                    "outer": {"c": main, "l": level},
                    "inner": {"c": counter, "l": round(level * 0.8, 2)},
                }
            else:
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
            busy = ["handover", "wave", "hocket", "cascade", "comet", "alternate"]
            mid = ["pairs", "converge", "diverge", "split", "handover", "wave"]
            calm = ["sweep", "bounce", "comet", "converge"]
            climb = ["build", "cascade", "converge", "build"]
            pick = climb if in_build else (busy if dens >= 6 else mid if dens >= 3 else calm)
            fig = pick[len(cues) % len(pick)]
            deep = 0.22 if level < 0.38 else (0.4 if dens >= 6 else 0.5)
            moves = fig in ("sweep", "bounce", "wave", "comet", "handover", "cascade")
            if in_build:
                every = {"beats": 2}
            elif dens >= 9:
                every = {"hits": 3}
            elif dens >= 5:
                every = {"hits": 2}
            elif dens >= 3:
                every = {"hits": 1}
            else:
                every = {"hits": 2}
            if dens >= 6 and level > 0.45:
                smooth_pick = ["wave", "comet", "handover", "split"]
                fig = smooth_pick[len(cues) % len(smooth_pick)] if fig in ("pulse", "hocket") else fig
            melodic = top_fam in ("voices", "strings", "winds", "keys", "guitars")
            sings = len(here_notes) >= 7 and melodic and not in_build
            if sings:
                fig = "pitch"
                every = {"notes": 1}
            layers = [{"on": "lamps", "figure": fig, "every": every,
                       "fill_beats": 1 if level < 0.45 else 2,
                       "low": deep, "move_head": moves}]
            if dens >= 5 and level > 0.4 and not in_build:
                layers.append({"on": "inner", "figure": "hocket",
                               "every": {"hits": 3}, "low": 0.55,
                               "c": counter})
            chase = None
            fade = 0.35 if not fam_changed else 0.15
            if in_build:
                fade = 0.6
            why = "bar %d%s: %s leads, E %.2f, %d hits, mode %s - %s in %s%s" % (
                bar, " (climbing)" if in_build else "",
                top_fam, r["E"], dens,
                ("%+.2f" % mode) if mode is not None else "?", fig, main,
                (" against %s inside" % counter) if (split_look or len(layers) > 1) else "")
            add_layers = layers

        add(bar, fade, look, chase, why, add_layers)
        if (bar in rising and cues[-1].get("look")
                and kind not in ("peak", "climax", "drop", "pause", "exit", "spotlight", "breakdown")):
            run = sorted(q for q in rising if abs(q - bar) < 12)
            lo_b, hi_b = (min(run), max(run)) if run else (bar, bar)
            span_n = max(1, hi_b - lo_b)
            p0 = (bar - lo_b) / span_n
            p1 = min(1.0, (bar + 1 - lo_b) / span_n)
            cues[-1]["swell"] = {"from": round(0.62 + 0.38 * p0, 3),
                                 "to": round(0.62 + 0.38 * p1, 3), "curve": 1.15}
        add_layers = None
        prev_fam, prev_level, prev_set = top_fam, level, here

    prev_mode = None
    last_harm = -9.0
    for e in emo:
        m = e.get("mode")
        if m is None:
            continue
        t0 = e["start"]
        if t0 < 1.0 or t0 > rows[-1]["end"] - 1.0:
            prev_mode = m
            continue
        if prev_mode is not None and abs(float(m) - float(prev_mode)) < 0.30:
            prev_mode = m
            continue
        prev_mode = m
        t = snap_chord(t0)
        prior = [c for c in cues if c.get("_t", 0) <= t + 1e-6 and c.get("look")]
        if not prior:
            continue
        base = prior[-1]
        row = min(rows, key=lambda rr: abs(rr["t"] - t))
        fam = max(row["fam"], key=lambda f: row["fam"][f]) if row["fam"] else "voices"
        ramp = FAMILY_TEMPERATURE.get(fam, ("indigo", "blood", "crimson", "scarlet"))
        w = max(0.0, min(1.0, (float(m) + 1.0) / 2.0))
        b = e.get("brightness")
        if b is not None:
            w = max(0.0, min(1.0, w * 0.72 + (float(b) / 10.0) * 0.28))
        col = ramp[min(len(ramp) - 1, int(w * len(ramp)))]
        was = None
        for k in ("lamps", "outer", "inner", "ends"):
            if k in (base.get("look") or {}) and base["look"][k].get("c"):
                was = base["look"][k]["c"]
                break
        if col == was:
            continue
        if t - last_harm < 6.0:
            continue
        last_harm = t
        look = json.loads(json.dumps(base.get("look") or {}))
        e_here = row["E"] / Emax
        lvl_here = round(min(0.97, (0.12 + 0.80 * (e_here ** 0.8)) * arc(row["t"])), 2)
        for k, v in look.items():
            if not isinstance(v, dict):
                continue
            if v.get("c") == was:
                v["c"] = col
            if v.get("l") is not None:
                share = 1.0 if k in ("lamps", "outer") else (0.8 if k == "inner" else 0.7)
                v["l"] = round(min(0.97, lvl_here * share), 2)
        nc = {"id": 0, "at": {"second": round(t, 3)}, "_t": t, "fade": 0.55,
              "look": look,
              "why": "the harmony turns here - mode %+.2f, %s. Colour moves to %s on the chord change"
                     % (float(m), e.get("emotion", "?"), col)}
        if base.get("chases"):
            nc["chases"] = json.loads(json.dumps(base["chases"]))
        elif base.get("chase"):
            nc["chase"] = json.loads(json.dumps(base["chase"]))
        cues.append(nc)
    cues.sort(key=lambda c: c.get("_t", 0))
    for n, c in enumerate(cues):
        c["id"] = n + 1

    last_swish = -9.0
    for run in runs:
        if run["a"] - last_swish < 3.0 or run["rate"] < 5.0:
            continue
        prior = [c for c in cues if c.get("_t", 0) <= run["a"] + 1e-6 and c.get("look")]
        if not prior:
            continue
        base = prior[-1]
        if any(a - 0.15 <= run["a"] <= b + 0.15 for a, b, _ in holes):
            continue
        last_swish = run["a"]
        look = json.loads(json.dumps(base.get("look") or {}))
        for v in look.values():
            if isinstance(v, dict) and v.get("l") is not None:
                v["l"] = round(min(0.97, v["l"] * 1.12), 2)
        swish = {"id": 0, "at": {"second": round(run["a"], 3)}, "_t": run["a"],
                 "fade": 0.12, "look": look,
                 "chases": [{"on": "lamps", "figure": "comet",
                             "every": {"notes": 1}, "low": 0.3,
                             "reverse": run["dir"] < 0, "move_head": True,
                             "fade": 0.05}],
                 "why": "a %d-note run %s the scale at %.0f notes a second, %.2fs to %.2fs - the row travels with it"
                        % (run["n"], "up" if run["dir"] > 0 else "down",
                           run["rate"], run["a"], run["b"])}
        cues.append(swish)
        back = json.loads(json.dumps({k: v for k, v in base.items() if k != "_t"}))
        back["at"] = {"second": round(run["b"] + 0.08, 3)}
        back["_t"] = run["b"] + 0.08
        back["fade"] = 0.35
        back["why"] = "the run lands; back to the look it left"
        cues.append(back)
    cues.sort(key=lambda c: c.get("_t", 0))

    for a, b, depth in holes:
        if a < 0.4:
            continue
        prior = [c for c in cues if c.get("_t", 0) <= a + 1e-6 and c.get("look")]
        cues.append({"id": 0, "at": {"second": round(a, 3)}, "_t": a, "fade": 0.0,
                     "look": {},
                     "why": "the audio falls to %d%% of its median for %.2fs - a real hole, so the room goes with it"
                            % (round(depth * 100), b - a)})
        if prior:
            back = json.loads(json.dumps({k: v for k, v in prior[-1].items() if k != "_t"}))
            back["at"] = {"second": round(b, 3)}
            back["_t"] = b
            back["fade"] = 0.06
            back["why"] = "and back, the instant the audio returns"
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
    last_t = -9.0
    for bar in sorted(by_bar):
        t, inten, row = by_bar[bar]
        if inten < 0.34:
            continue
        if any(a - 0.1 <= t <= b + 0.1 for a, b in hole_spans):
            continue
        if t - last_t < 0.62:
            continue
        last_t = t
        climbing = bar in rising
        amp = min(1.0, 0.5 + inten * 0.6)
        if climbing:
            run = [q for q in sorted(rising) if abs(q - bar) < 12]
            if run:
                pos = (bar - min(run)) / max(1, (max(run) - min(run)))
                amp = min(1.0, 0.45 + 0.5 * pos + inten * 0.25)
        group = "lamps" if inten >= 0.6 else ("outer" if len(accents) % 2 else "inner")
        accents.append({"t": round(t, 3), "l": round(amp, 2),
                        "decay": 0.2 if inten >= 0.6 else 0.15,
                        "on": group, "c": "bone" if inten >= 0.7 else "saffron"})

    for n, c in enumerate(cues):
        nxt = cues[n + 1] if n + 1 < len(cues) else None
        if not nxt or not c.get("look"):
            continue
        w = (nxt.get("why") or "")
        if w.startswith("PEAK") or w.startswith("climax") or w.startswith("build"):
            c["swell"] = {"from": 0.72, "to": 1.0, "curve": 1.6}

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

    for c in cues:
        c.pop("_t", None)

    doc = {
        "schema": "limelight.cuelist/1",
        "song": song,
        "rig": "arc4-head",
        "palette": PALETTE,
        "cues": cues,
        "accents": accents,
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
