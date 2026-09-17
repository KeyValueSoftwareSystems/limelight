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

    prev_fam = None
    prev_level = 0.0
    prev_set = set()
    add_layers = None
    for r in rows:
        bar = r["bar"]
        mom = moment_at(bar)
        kind = mom[1] if mom else ""
        here = set(r["playing"])
        churn = len(here ^ prev_set)
        top_fam = max(r["fam"], key=lambda f: r["fam"][f]) if r["fam"] else "voices"
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
            shades = FAMILY_SHADES.get(top_fam, ("crimson", "blood", "scarlet"))
            main = shades[len(cues) % len(shades)]
            counter = COUNTER.get(top_fam, "indigo")
            split_look = (len(cues) % 3 == 1) and level > 0.3
            if split_look:
                look = {
                    "outer": {"c": main, "l": level},
                    "inner": {"c": counter, "l": round(level * 0.8, 2)},
                }
            else:
                look = {"lamps": {"c": main, "l": level}}
            look["heads"] = {
                "c": counter if split_look else main,
                "l": round(min(0.85, level * 0.7), 2),
                "pan": 0.5,
                "tilt": round(0.22 + 0.2 * ((bar % 4) / 3.0), 2),
            }
            busy = ["handover", "wave", "hocket", "cascade", "comet", "alternate"]
            mid = ["pairs", "converge", "diverge", "split", "handover", "wave"]
            calm = ["sweep", "bounce", "comet", "converge"]
            pick = busy if dens >= 6 else mid if dens >= 3 else calm
            fig = pick[len(cues) % len(pick)]
            deep = 0.22 if level < 0.38 else (0.4 if dens >= 6 else 0.5)
            moves = fig in ("sweep", "bounce", "wave", "comet", "handover", "cascade")
            layers = [{"on": "lamps", "figure": fig,
                       "every": {"hits": 1 if dens >= 3 else 2},
                       "fill_beats": 1 if level < 0.45 else 2,
                       "low": deep, "move_head": moves}]
            if dens >= 5 and level > 0.4:
                layers.append({"on": "inner", "figure": "hocket",
                               "every": {"hits": 2}, "low": 0.55,
                               "c": counter})
            chase = None
            fade = 0.35 if not fam_changed else 0.15
            why = "bar %d: %s leads, E %.2f, %d hits - %s in %s%s" % (
                bar, top_fam, r["E"], dens, fig, main,
                (" against %s inside" % counter) if (split_look or len(layers) > 1) else "")
            add_layers = layers

        add(bar, fade, look, chase, why, add_layers)
        add_layers = None
        prev_fam, prev_level, prev_set = top_fam, level, here

    for a, b, depth in holes:
        if a < 0.4:
            continue
        prior = [c for c in cues if c.get("_t", 0) <= a + 1e-6]
        cues.append({"id": 0, "at": {"second": round(a, 3)}, "_t": a, "fade": 0.0,
                     "look": {},
                     "why": "the audio falls to %d%% of its median for %.2fs - a real hole, so the room goes with it"
                            % (round(depth * 100), b - a)})
        if prior:
            back = dict(prior[-1])
            back["at"] = {"second": round(b, 3)}
            back["_t"] = b
            back["fade"] = 0.06
            back["why"] = "and back, the instant the audio returns"
            cues.append(back)
    cues.sort(key=lambda c: c.get("_t", 0))
    for n, c in enumerate(cues):
        c["id"] = n + 1
        c.pop("_t", None)

    accents = []
    strong = sorted(hits, key=lambda h: -h[1])[:60]
    hole_spans = [(a, b) for a, b, _ in holes]
    for t, inten in sorted(strong):
        if inten < 0.42:
            continue
        if any(a - 0.1 <= t <= b + 0.1 for a, b in hole_spans):
            continue
        group = "lamps" if inten >= 0.6 else ("outer" if len(accents) % 2 else "inner")
        accents.append({"t": round(t, 3), "l": round(min(1.0, 0.55 + inten * 0.6), 2),
                        "decay": 0.18 if inten >= 0.6 else 0.14,
                        "on": group, "c": "bone" if inten >= 0.7 else "saffron"})

    for n, c in enumerate(cues):
        nxt = cues[n + 1] if n + 1 < len(cues) else None
        if not nxt or not c.get("look"):
            continue
        w = (nxt.get("why") or "")
        if w.startswith("PEAK") or w.startswith("climax") or w.startswith("build"):
            c["swell"] = {"from": 0.72, "to": 1.0, "curve": 1.6}

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
