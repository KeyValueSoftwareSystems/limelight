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
            return 0.46 + 0.54 * (t / peak_t if peak_t else 1.0) ** 0.75
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

    def add(bar, fade, look, chase=None, why=""):
        cues.append(
            {
                "id": len(cues) + 1,
                "at": {"bar": bar},
                "fade": round(fade, 2),
                "why": why,
                "look": look,
                **({"chase": chase} if chase else {}),
            }
        )

    prev_fam = None
    prev_level = 0.0
    prev_set = set()
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
            chase = {
                "on": "lamps",
                "figure": "build",
                "every": {"hits": 1},
                "low": 0.35,
            }
            fade = 0.3
            why = "build at %.1fs, E %.2f - one lamp added at a time" % (mom[0], r["E"])
        elif kind in ("entrance", "vocal_return", "melody_resume"):
            look = {"lamps": {"c": colour, "l": level}}
            chase = {
                "on": "lamps",
                "figure": "alternate",
                "every": {"hits": 2},
                "low": 0.5,
            }
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
            chase = {
                "on": "lamps",
                "figure": "sweep",
                "every": {"hits": 1},
                "low": 0.42,
            }
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
            look = {"lamps": {"c": colour, "l": level}}
            if dens >= 6:
                chase = {
                    "on": "lamps",
                    "figure": "alternate",
                    "every": {"hits": 1},
                    "low": 0.45,
                }
            elif dens >= 3:
                chase = {
                    "on": "lamps",
                    "figure": "pairs",
                    "every": {"hits": 1},
                    "low": 0.52,
                }
            elif dens >= 1:
                chase = {
                    "on": "lamps",
                    "figure": "sweep",
                    "every": {"hits": 2},
                    "low": 0.55,
                }
            fade = 0.35 if not fam_changed else 0.15
            why = "bar %d: %s leads, E %.2f, %d hits" % (bar, top_fam, r["E"], dens)

        add(bar, fade, look, chase, why)
        prev_fam, prev_level, prev_set = top_fam, level, here

    doc = {
        "schema": "limelight.cuelist/1",
        "song": song,
        "rig": "arc4-head",
        "palette": PALETTE,
        "cues": cues,
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
