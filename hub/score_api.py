"""The score protocol in Python — format, window, filter.

A direct port of the Node score server's contract (server/format/v1.js,
server/handler.js, server/filter.js) so the lights panel can speak the
same protocol without a running Node process.

    handle(body, fetch_score)   the entry point
    format_v1(raw)              raw .score dict  ->  response-shaped dict
    apply_window(out, w, grid)  clip to a bar range (rule 4: never re-anchor)
    filter_response(fmt, fields, known)  keep only what was asked for
"""
import math
import re

KNOWN = [
    "song", "grid", "beats", "downbeats", "sections", "energy",
    "brightness", "width", "air", "pump", "pace", "weight", "floor",
    "noisy", "sustained",
    "groove", "ticks", "per_beat", "melody_phrases", "phrase_grid", "scales",
    "presence", "moments",
    "phrases", "layers", "chords", "key", "loudness", "feel",
    "curves", "stems", "harmony", "chord_changes", "chord_summary",
    "tension", "lift", "releases", "melody", "signals", "made_by",
    "lyrics", "tells", "motion", "recording",
    "caption", "emotion", "instruments", "instruments_over_time",
    "key_tempo", "rhythm", "beat_consensus", "sections_second_opinion",
    "btc_chords_raw", "melody_phrases", "lead", "voice", "unavailable",
]

_STEM_NAMES = ["drums", "bass", "vocals", "other", "guitar", "piano"]
_STEM_FOUR  = ["drums", "bass", "vocals", "other"]
_CURVE_NAMES = ["energy", "brightness", "width", "air", "pump", "pace",
                "weight", "floor", "noisy", "sustained"]
_ALWAYS = ["score", "version", "window", "grid", "personality", "profile"]


def _moment_weight(m):
    """How strong a moment is, whatever the field ended up being called.

    This read `weight` alone and fell back to 1 when it was missing. No moment
    has ever carried `weight` - the score writes `intensity` - so every moment
    scored 1 and min_weight silently returned the whole list at any threshold.
    A reader asking for only the biggest events got all of them and no error.
    """
    for key in ("weight", "intensity", "strength", "size"):
        v = m.get(key)
        if isinstance(v, (int, float)):
            return float(v)
    return 1.0


def _or(v, d):
    """Default on absence, never on falsiness. 0 and False are real values."""
    return d if v is None else v



def format_v1(raw):
    out = {}
    grid = raw.get("grid") or {}
    bpm = grid.get("bpm") or 120
    bpb = grid.get("beats_per_bar") or 4
    first_beat_s = grid.get("first_beat_s") or 0
    beat_sec = 60.0 / bpm
    bar_sec = beat_sec * bpb
    first_bar_raw = grid.get("first_bar")
    first_bar = first_bar_raw if first_bar_raw is not None else (0 if first_beat_s > 0.2 else 1)

    _tempo = grid.get("tempo") or [
        {"from_beat": 0, "at_s": first_beat_s, "bpm": bpm}]

    def _beat_of(t):
        k = 0
        while k + 1 < len(_tempo) and _tempo[k + 1]["at_s"] <= t:
            k += 1
        seg = _tempo[k]
        return seg["from_beat"] + (t - seg["at_s"]) / (60.0 / seg["bpm"])

    def _place(t):
        n = int(round(_beat_of(float(t))))
        return {"bar": max(first_bar, 1 + n // bpb), "beat": 1 + (n % bpb)}

    _length = float(((raw.get("song") or {}).get("length_s")) or 1e9)

    def _seconds_of(bar, beat=1):
        n = (int(bar) - 1) * bpb + (int(beat) - 1)
        seg = _tempo[0]
        for cand in _tempo:
            if cand["from_beat"] <= n:
                seg = cand
            else:
                break
        return seg["at_s"] + (n - seg["from_beat"]) * (60.0 / seg["bpm"])

    def _stamp(node):
        """Give every addressed thing an absolute time.

        A bar-and-beat is a musician's name for a position, not the position.
        It only means something against one particular fitted grid, so anything
        addressed in bars alone detaches the moment that grid is refitted --
        which is how `layers` came to describe a song it no longer covered while
        every test still passed. Seconds are the anchor and survive a refit; bar
        and beat travel alongside as the supporting evidence, for musicians and
        for editors that want to snap. Both, on everything, always."""
        if isinstance(node, list):
            return [_stamp(x) for x in node]
        if not isinstance(node, dict):
            return node
        out_n = {k: _stamp(v) for k, v in node.items()}

        def _clamp(x):
            return round(max(0.0, min(float(x), _length)), 3)

        pos = out_n.get("bar")
        if isinstance(pos, (int, float)) and isinstance(out_n.get("beat"), (int, float)) \
           and "t" not in out_n and "at_s" not in out_n:
            out_n["at_s"] = _clamp(_seconds_of(out_n["bar"], out_n["beat"]))
        # A thing that already knows its own time is the authority on it. Deriving
        # the time back out of the bar label would round it to the grid and, for
        # anything starting before bar 1, produce a negative second.
        known = {"from_s": ("start",), "to_s": ("end",), "at_s": ("time_s", "t")}
        for key, name in (("from", "from_s"), ("to", "to_s"), ("at", "at_s")):
            if name in out_n:
                continue
            src = next((out_n[k] for k in known[name]
                        if isinstance(out_n.get(k), (int, float))), None)
            if src is not None:
                out_n[name] = _clamp(src)
                continue
            v = out_n.get(key)
            if isinstance(v, dict) and isinstance(v.get("bar"), (int, float)):
                out_n[name] = _clamp(_seconds_of(v["bar"], v.get("beat", 1)))
        return out_n

    named = raw.get("score")
    if named is None:
        named = (raw.get("song") or {}).get("slug")
    if named is not None:
        out["score"] = named
    out["version"] = _or(raw.get("version"), 0)

    if raw.get("song"):
        out["song"] = dict(raw["song"])
        if out["song"].get("bars") is None:
            if grid.get("bars") is not None:
                out["song"]["bars"] = grid["bars"]
            elif out["song"].get("length_s") and bpm:
                out["song"]["bars"] = math.ceil((out["song"]["length_s"] - first_beat_s) / bar_sec)

    if raw.get("grid"):
        out["grid"] = dict(raw["grid"])
        if raw["grid"].get("holds_from_s") is not None:
            out["grid"]["holds_from"] = _place(raw["grid"]["holds_from_s"])
        if raw["grid"].get("holds_to_s") is not None:
            out["grid"]["holds_to"] = _place(raw["grid"]["holds_to_s"])

    if raw.get("beats"):
        if isinstance(raw["beats"], dict) and "list" in raw["beats"]:
            out["beats"] = raw["beats"]
        elif isinstance(raw["beats"], list):
            converted = []
            tempo_map = grid.get("tempo") or [
                {"from_beat": 0, "at_s": first_beat_s, "bpm": grid.get("bpm") or 120}]

            def _beat_no(at):
                k = 0
                while k + 1 < len(tempo_map) and tempo_map[k + 1]["at_s"] <= at:
                    k += 1
                seg = tempo_map[k]
                return seg["from_beat"] + (at - seg["at_s"]) / (60.0 / seg["bpm"])

            def _near(x):
                return int(math.floor(float(x) + 0.5))

            def _at_beat(n):
                k = 0
                while k + 1 < len(tempo_map) and tempo_map[k + 1]["from_beat"] <= n:
                    k += 1
                seg = tempo_map[k]
                return seg["at_s"] + (n - seg["from_beat"]) * (60.0 / seg["bpm"])

            lead = 0
            for idx, b in enumerate(raw["beats"]):
                at = b.get("t") if isinstance(b, dict) else None
                n = int(round(_beat_no(at))) if at is not None else idx
                if n < 0:
                    lead += 1
                    bar, beat = first_bar, lead
                else:
                    bar = max(first_bar, 1 + n // bpb)
                    beat = 1 + (n % bpb)
                entry = {"bar": bar, "beat": beat}
                if isinstance(b, dict):
                    if b.get("t") is not None:
                        entry["t"] = b["t"]
                    if b.get("weight") is not None:
                        entry["weight"] = b["weight"]
                    if b.get("sure") is not None:
                        entry["sure"] = b["sure"]
                    if b.get("off_ms") is not None:
                        entry["off_ms"] = _near(b["off_ms"])
                    elif b.get("t") is not None:
                        entry["off_ms"] = _near((b["t"] - _at_beat(n)) * 1000)
                    if b.get("downbeat") is not None:
                        entry["downbeat"] = b["downbeat"]
                converted.append(entry)
            out["beats"] = converted

    if raw.get("downbeats"):
        out["downbeats"] = raw["downbeats"]
    elif isinstance(out.get("beats"), list) and isinstance(raw.get("beats"), list):
        flagged = [e for e, b in zip(out["beats"], raw["beats"])
                   if isinstance(b, dict) and b.get("downbeat")]
        out["downbeats"] = flagged or [e for e in out["beats"]
                                       if e.get("beat") == 1]

    layers = raw.get("layers") or {}
    form = layers.get("form") or {}
    spans = form.get("spans")
    if spans:
        out["sections"] = []
        for sp in spans:
            sec = {"from": sp["from"], "to": sp["to"],
                   "name": sp.get("name"), "repeat": sp.get("repeat")}
            for opt in ("rise", "playing", "stems", "fullness", "feels"):
                if sp.get(opt) is not None:
                    sec[opt] = sp[opt]
            out["sections"].append(sec)
    elif isinstance(raw.get("sections"), list) and raw["sections"]:
        out["sections"] = []
        def _label(sec):
            # A score that has already been through this formatter once carries
            # the section name under "name"; a raw one carries it under "label".
            # Reading only "label" silently dropped every section name on the
            # second pass -- seven unnamed sections, and nothing failed.
            return sec.get("label") if sec.get("label") is not None else sec.get("name")

        for i, sec in enumerate(raw["sections"]):
            label = _label(sec)
            row = {
                "from": ({"bar": sec["from_bar"], "beat": 1}
                         if sec.get("from_bar") is not None else _place(sec["start"])),
                "to": ({"bar": sec["to_bar"] + 1, "beat": 1}
                       if sec.get("to_bar") is not None else _place(sec["end"])),
                "name": label,
                "start": sec.get("start"),
                "end": sec.get("end"),
                "nth": i + 1,
                "like": label,
            }
            if any(_label(o) == label for o in raw["sections"][:i]):
                row["repeat"] = label
            if sec.get("also_heard") is not None:
                row["also_heard"] = sec["also_heard"]
            for extra in ("confidence", "edge", "sudden", "sure"):
                if extra in sec:
                    row[extra] = sec[extra]
            out["sections"].append(row)
    elif isinstance(raw.get("parts"), list):
        out["sections"] = [
            {
                "from": {"bar": p["from_bar"], "beat": 1},
                "to": {"bar": p["to_bar"] + 1, "beat": 1},
                "name": p.get("role"),
                "nth": p.get("nth"),
                "repeat": p.get("like") if p.get("returns") else None,
                "like": p.get("like"),
                "feels": p.get("feels"),
                "playing": p.get("playing"),
                "fullness": p.get("fullness"),
                "rise": p.get("rise"),
                "sure": p.get("sure"),
                "trades": p.get("trades"),
                "also_heard": p.get("also_heard"),
                "edge": p.get("edge"),
                "sudden": p.get("sudden"),
                "stems": p.get("stems"),
            }
            for p in raw["parts"]
        ]

    def _bar_energy():
        temporal = raw.get("stems_temporal") or {}
        lanes = [v for v in (temporal.get("stems") or {}).values()
                 if isinstance(v, list) and v]
        if not lanes or not grid.get("bars"):
            return None
        w = temporal.get("window_s") or 0.5
        n = min(len(v) for v in lanes)
        mean = [sum(v[i] for v in lanes) / len(lanes) for i in range(n)]

        def _at_beat_n(k):
            j = 0
            while j + 1 < len(_tempo) and _tempo[j + 1]["from_beat"] <= k:
                j += 1
            seg = _tempo[j]
            return seg["at_s"] + (k - seg["from_beat"]) * (60.0 / seg["bpm"])

        per = []
        for b in range(int(grid["bars"])):
            a = int(_at_beat_n(b * bpb) / w)
            z = max(a + 1, int(_at_beat_n((b + 1) * bpb) / w))
            cut = mean[max(0, a):min(n, z)]
            per.append(sum(cut) / len(cut) if cut else 0.0)
        top = max(per) if per else 0
        if not top > 0:
            return None
        return [round(v / top, 3) for v in per]

    if raw.get("energy"):
        out["energy"] = raw["energy"]
    elif isinstance((raw.get("bars") or {}).get("intensity"), list):
        out["energy"] = {"per": "bar", "from_bar": first_bar,
                         "values": raw["bars"]["intensity"]}
    else:
        _per = _bar_energy()
        if _per:
            out["energy"] = {"per": "bar", "from_bar": first_bar,
                             "values": _per, "normalised": "per-song-peak"}

    if raw.get("phrases"):
        out["phrases"] = raw["phrases"]

    bars = raw.get("bars") or {}
    for lane in ("width", "air", "pump", "pace"):
        if isinstance(bars.get(lane), list):
            out[lane] = bars[lane]
    if isinstance(bars.get("brightness"), list):
        out["brightness"] = bars["brightness"]
    for band in ("weight", "floor", "noisy", "sustained"):
        if isinstance(bars.get(band), list):
            out[band] = bars[band]
    said = {}
    for name, v in (raw.get("curve_tells") or {}).items():
        said["energy" if name == "intensity" else name] = v
    if said:
        out["tells"] = said

    if isinstance(out.get("energy"), dict) and "energy" in (out.get("tells") or {}):
        out["energy"]["tells"] = out["tells"]["energy"]

    for whole in ("groove", "ticks", "per_beat", "melody_phrases",
                  "phrase_grid", "scales", "presence", "lyrics",
                  "motion", "recording"):
        if raw.get(whole) is not None:
            out[whole] = raw[whole]

    curve_entries = {}
    for name in _CURVE_NAMES:
        if name == "energy":
            src = (out.get("energy") or {}).get("values") or bars.get("intensity")
        else:
            src = bars.get(name)
        if isinstance(src, list):
            fb = (out.get("energy") or {}).get("from_bar", first_bar) if name == "energy" else first_bar
            lane = "intensity" if name == "energy" else name
            entry = {"per": "bar", "from_bar": fb, "values": src}
            tells = (raw.get("curve_tells") or {}).get(lane)
            if tells is not None:
                entry["tells"] = tells
            curve_entries[name] = entry
    if curve_entries:
        out["curves"] = curve_entries

    stem_lanes = {}
    for s in _STEM_NAMES:
        if isinstance(bars.get(s), list):
            stem_lanes[s] = bars[s]
    if stem_lanes:
        out["stems"] = {"normalised": "per-stem-peak-within-song",
                        "from_bar": first_bar, "lanes": stem_lanes}

    _M_KEYS = ("is", "what", "sure", "weight", "strength",
               "for_beats", "for_bars", "then", "after", "leaves")
    if raw.get("moments"):
        out["moments"] = []
        for mo in raw["moments"]:
            if mo.get("at"):
                out["moments"].append(mo)
                continue
            if mo.get("time_s") is not None:
                m = {"at": _place(mo["time_s"])}
                for k, v in mo.items():
                    if v is not None:
                        m[k] = v
                out["moments"].append(m)
                continue
            m = {"at": {"bar": mo.get("bar"), "beat": mo.get("beat")}}
            for k, v in mo.items():
                if k not in ("bar", "beat") and v is not None:
                    m[k] = v
            out["moments"].append(m)
    elif isinstance(raw.get("events"), list):
        out["moments"] = []
        for ev in raw["events"]:
            m = {"at": {"bar": ev.get("bar"), "beat": ev.get("beat")}}
            for k in _M_KEYS:
                if ev.get(k) is not None:
                    m[k] = ev[k]
            out["moments"].append(m)

    _FAMILY = {
        "drums": ["drums", "kick", "snare", "hh", "toms", "percussion", "clap",
                  "cymbals", "ride", "crash", "shaker", "tambourine", "congas",
                  "bongos", "timpani"],
        "bass": ["bass", "double-bass", "sub"],
        "vocals": ["vocal", "lead-vocal", "back-vocal", "choir"],
    }

    def _family_of(name):
        low = name.lower()
        for fam, members in _FAMILY.items():
            if any(low == m or m in low for m in members):
                return fam
        return "other"

    def _per_bar_families():
        temporal = raw.get("stems_temporal") or {}
        lanes = temporal.get("stems") or {}
        if not lanes or not grid.get("bars"):
            return None
        w = temporal.get("window_s") or 0.5
        pots = {"drums": [], "bass": [], "vocals": [], "other": []}
        for name, v in lanes.items():
            if isinstance(v, list) and v:
                pots[_family_of(name)].append(v)

        def _at_beat_n(k):
            j = 0
            while j + 1 < len(_tempo) and _tempo[j + 1]["from_beat"] <= k:
                j += 1
            seg = _tempo[j]
            return seg["at_s"] + (k - seg["from_beat"]) * (60.0 / seg["bpm"])

        done = {}
        for fam, group in pots.items():
            if not group:
                continue
            n = min(len(v) for v in group)
            rows = []
            for b in range(int(grid["bars"])):
                a = int(_at_beat_n(b * bpb) / w)
                z = max(a + 1, int(_at_beat_n((b + 1) * bpb) / w))
                tot, seen = 0.0, 0
                for v in group:
                    for i in range(max(0, a), min(n, z)):
                        tot += v[i]
                        seen += 1
                rows.append(tot / seen if seen else 0.0)
            top = max(rows) if rows else 0
            done[fam] = [round(x / top, 6) if top > 0 else round(x, 6)
                         for x in rows]
        return done or None

    out["layers"] = dict(raw["layers"]) if raw.get("layers") else {}

    if "presence" not in out["layers"] and not raw.get("presence"):
        fam = _per_bar_families()
        if fam:
            spans = []

            def _state(x):
                return "full" if x >= 0.55 else ("light" if x >= 0.15 else "out")

            for stem, rows in fam.items():
                soft = []
                for i in range(len(rows)):
                    cut = sorted(rows[max(0, i - 1):i + 2])
                    soft.append(cut[len(cut) // 2])
                states = [_state(x) for x in soft]
                for i in range(1, len(states) - 1):
                    if states[i] != states[i - 1] and states[i - 1] == states[i + 1]:
                        states[i] = states[i - 1]
                run, start = (states[0] if states else None), 0
                for b in range(1, len(states) + 1):
                    now = states[b] if b < len(states) else None
                    if now != run:
                        if run != "out" and b - start >= 2:
                            spans.append({"from": {"bar": first_bar + start, "beat": 1},
                                          "to": {"bar": first_bar + b, "beat": 1},
                                          "stem": stem, "state": run})
                        run, start = now, b
            if spans:
                out["layers"]["presence"] = {"kind": "sparse",
                                             "derived_from": "stem lanes",
                                             "spans": spans}

    if ("subsection" not in out["layers"] and not isinstance(raw.get("phrases"), list)
            and out.get("sections")
            and isinstance(raw.get("moments"), list)):
        lane = (out.get("energy") or {}).get("values") or []
        _steps = sorted(abs(lane[i] - lane[i - 1]) for i in range(1, len(lane)))
        _typical = _steps[len(_steps) // 2] if _steps else 0
        _moved = max(0.03, 2 * _typical)
        _fam_rows = _per_bar_families() or {}

        def _trend(a, b):
            cut = lane[max(0, a - first_bar):max(1, b - first_bar)]
            if len(cut) < 2:
                return "steady"
            half = len(cut) // 2 or 1
            lo = sum(cut[:half]) / half
            hi = sum(cut[half:]) / (len(cut) - half)
            if hi - lo > _moved:
                return "intensifying"
            if lo - hi > _moved:
                return "easing"
            return "sustaining"

        def _word(doing, nth, last, name):
            if doing != "sustaining":
                return doing
            if nth == 1:
                return "establishing" if name == "intro" else "developing"
            if nth == last:
                return "closing" if name == "outro" else "resolving"
            return "sustaining"

        def _playing_in(a, b):
            on = []
            for fam, rows in _fam_rows.items():
                cut = rows[max(0, a - first_bar):max(1, b - first_bar)]
                if not cut:
                    continue
                if sum(cut) / len(cut) >= 0.15:
                    on.append(fam)
            return on

        spans = []
        for sec in out["sections"]:
            span = sec["to"]["bar"] - sec["from"]["bar"]
            phrase = 8 if span >= 16 else 4
            marks = set(range(sec["from"]["bar"] + phrase,
                              sec["to"]["bar"] - 1, phrase))
            for m in raw["moments"]:
                if m.get("time_s") is None:
                    continue
                b = _place(m["time_s"])["bar"]
                if sec["from"]["bar"] + 1 < b < sec["to"]["bar"] - 1:
                    marks.add(b)
            inside = sorted(marks)
            cuts = [sec["from"]["bar"]]
            for b in inside:
                if b - cuts[-1] >= 2:
                    cuts.append(b)
            cuts.append(sec["to"]["bar"])
            for i in range(len(cuts) - 1):
                spans.append({"from": {"bar": cuts[i], "beat": 1},
                              "to": {"bar": cuts[i + 1], "beat": 1},
                              "in": sec.get("name"), "in_nth": sec.get("nth"),
                              "nth": i + 1,
                              "doing": _word(_trend(cuts[i], cuts[i + 1]), i + 1,
                                             len(cuts) - 1, sec.get("name")),
                              "playing": _playing_in(cuts[i], cuts[i + 1])})
        if spans:
            out["layers"]["subsection"] = {
                "kind": "partition",
                "derived_from": "moments and the energy lane",
                "spans": spans}

    if "subsection" not in out["layers"] and isinstance(raw.get("phrases"), list):
        out["layers"]["subsection"] = {
            "kind": "sparse",
            "spans": [
                {
                    "from": {"bar": p["from_bar"], "beat": 1},
                    "to": {"bar": p["to_bar"] + 1, "beat": 1},
                    "in": p.get("in"), "in_nth": p.get("in_nth"),
                    "doing": p.get("doing"), "also": p.get("also"),
                    "says": p.get("says"), "energy": p.get("energy"),
                    "rise": p.get("rise"), "playing": p.get("playing"),
                    "has_break": p.get("break") is not None or bool(p.get("has_break")),
                    "break": p.get("break"),
                }
                for p in raw["phrases"]
            ],
        }

    if "presence" not in out["layers"] and isinstance(raw.get("presence"), dict):
        pres_spans = [
            {"from": {"bar": sp["from_bar"], "beat": 1},
             "to": {"bar": sp["to_bar"] + 1, "beat": 1},
             "stem": stem, "state": sp["is"]}
            for stem, spans in raw["presence"].items()
            for sp in spans if sp.get("is") != "out"
        ]
        if pres_spans:
            out["layers"]["presence"] = {"kind": "sparse", "spans": pres_spans}

    if "phrase" not in out["layers"] and raw.get("phrase_grid"):
        pg = raw["phrase_grid"]
        out["layers"]["phrase"] = {
            "kind": "rule",
            "every_bars": pg.get("every_bars"),
            "from_bar": pg.get("from_bar"),
        }

    if ("phrase" not in out["layers"] and not raw.get("phrase_grid")
            and isinstance(out.get("sections"), list) and len(out["sections"]) > 2):
        edges = [x["from"]["bar"] for x in out["sections"]]
        start = edges[0]
        best = None
        for per in (8, 4):
            on = sum(1 for b in edges if (b - start) % per == 0) / len(edges)
            if on >= 0.5:
                best = per
                break
        if best:
            out["layers"]["phrase"] = {"kind": "rule", "every_bars": best,
                                       "from_bar": start,
                                       "derived_from": "where the sections fall"}

    if not out["layers"]:
        del out["layers"]

    if isinstance(bars.get("chord"), list):
        out["harmony"] = {
            "from_bar": first_bar,
            "chords": bars["chord"],
            "confidence": bars.get("chord_sure") or [],
        }

    if isinstance(bars.get("chord"), list):
        changes = []
        prev = None
        chord_sure = bars.get("chord_sure") or []
        for i, name in enumerate(bars["chord"]):
            if name and name != prev:
                changes.append({
                    "at": {"bar": i + first_bar, "beat": 1},
                    "to": name,
                    "confidence": chord_sure[i] if i < len(chord_sure) else None,
                })
                prev = name
        out["chord_changes"] = changes

    if isinstance(bars.get("chord"), list):
        chord_sure = bars.get("chord_sure") or []
        out["chords"] = [
            {"bar": i + first_bar, "name": name,
             "sure": chord_sure[i] if i < len(chord_sure) else None}
            for i, name in enumerate(bars["chord"])
            if name
        ]

    if raw.get("key") or raw.get("chords"):
        out["key"] = dict(raw.get("key") or {})
        chords_obj = raw.get("chords")
        if chords_obj:
            out["key"]["changes_per_beat"] = chords_obj.get("changes_per_beat")

    if raw.get("chords"):
        out["chord_summary"] = {
            "changes_per_beat": raw["chords"].get("changes_per_beat"),
        }

    if raw.get("loudness"):
        out["loudness"] = raw["loudness"]
    if raw.get("feel"):
        out["feel"] = raw["feel"]

    pull = raw.get("lift") if isinstance(raw.get("lift"), list) else raw.get("tension")
    if isinstance(pull, list):
        out["lift"] = {"per": "beat", "from_bar": first_bar,
                       "from_beat": 1, "values": pull}
        out["tension"] = out["lift"]

    if isinstance(raw.get("releases"), list):
        out["releases"] = []
        for r in raw["releases"]:
            if r.get("bar") is not None and r.get("beat") is not None:
                at = {"bar": r["bar"], "beat": r["beat"]}
            else:
                at = _place(r["at_s"])
            one = {"at": at, "jump": r.get("jump", r.get("size"))}
            if r.get("at_s") is not None:
                one["at_s"] = r["at_s"]
            out["releases"].append(one)

    if raw.get("melody"):
        out["melody"] = raw["melody"]
    for k in ("lead", "voice"):
        if raw.get(k):
            out[k] = raw[k]

    if raw.get("signals"):
        out["signals"] = raw["signals"]

    if raw.get("made_by"):
        out["made_by"] = raw["made_by"]

    # A score that has already been through this formatter carries the chord
    # spans under "chords" as {of: "seconds", spans: [...]}; only a raw one has
    # btc_chords_raw. Building solely from the raw field dropped the whole chord
    # track on the second pass -- and the chords are where a lighting designer
    # reads the major-to-minor turn that the loudness curve cannot show.
    _pre = raw.get("chords")
    if isinstance(_pre, dict) and isinstance(_pre.get("spans"), list) and _pre["spans"]:
        out["chords"] = {"of": _pre.get("of", "seconds"), "spans": _pre["spans"]}

    btc = raw.get("btc_chords_raw")
    if isinstance(btc, list) and btc:
        spans = [{"start": c["start"], "end": c["end"], "chord": str(c["chord"])}
                 for c in btc
                 if isinstance(c, dict)
                 and isinstance(c.get("start"), (int, float))
                 and isinstance(c.get("end"), (int, float))]
        out["chords"] = {"of": "seconds", "spans": spans}
        if bar_sec > 0 and grid.get("bars"):
            per_bar = []
            for b in range(int(grid["bars"])):
                a = first_beat_s + b * bar_sec
                z = a + bar_sec
                best, best_ov = None, 0.0
                for c in spans:
                    ov = min(z, c["end"]) - max(a, c["start"])
                    if ov > best_ov:
                        best_ov, best = ov, c["chord"]
                per_bar.append(best if best and best != "N" else None)
            out["harmony"] = {"from_bar": first_bar, "chords": per_bar,
                              "confidence": [1 if c else None for c in per_bar]}
            seen = {}
            for c in per_bar:
                if c:
                    seen[c] = seen.get(c, 0) + 1
            if seen:
                top = max(seen.items(), key=lambda kv: kv[1])[0]
                m = re.match(r"^([A-G][#b]?)(.*)$", top)
                if m:
                    tail = m.group(2)
                    out["key"] = {"root": m.group(1),
                                  "scale": "minor" if ("min" in tail or tail.endswith("m")) else "major",
                                  "from": "most common BTC chord"}

    stems = raw.get("stems")
    if isinstance(stems, dict):
        lanes = out.get("stems") if isinstance(out.get("stems"), dict) and out["stems"].get("lanes") else None
        summary = sorted(
            ({"name": n, "rms": v.get("rms"), "peak": v.get("peak"), "db": v.get("db")}
             for n, v in stems.items() if isinstance(v, dict) and "rms" in v),
            key=lambda x: -(x["rms"] or 0))
        if summary:
            out["instruments"] = {"of": "whole recording", "heard": summary}
        elif not lanes:
            out["stems"] = stems
        if lanes:
            out["stems"] = lanes

    temporal = raw.get("stems_temporal")
    if isinstance(temporal, dict) and temporal.get("stems"):
        out["instruments_over_time"] = {
            "per": "window",
            "window_s": temporal.get("window_s"),
            "normalised": "per-instrument-peak-within-song",
            "lanes": temporal["stems"],
        }

    if raw.get("unavailable"):
        out["unavailable"] = raw["unavailable"]
    for whole in ("caption", "emotion", "rhythm", "key_tempo",
                  "beat_consensus", "sections_second_opinion"):
        if raw.get(whole) is not None:
            out[whole] = raw[whole]

    person = raw.get("personality") or raw.get("profile")
    if person:
        out["personality"] = person
        out["profile"] = person        # the old name, until everyone has moved

    for name in ("sections", "moments", "layers", "phrases", "harmony", "chords"):
        if out.get(name) is not None:
            out[name] = _stamp(out[name])

    en = out.get("energy")
    if isinstance(en, dict) and isinstance(en.get("values"), list) and "times" not in en:
        fb = en.get("from_bar", first_bar)
        en["from_s"] = round(max(0.0, _seconds_of(fb)), 3)
        en["times"] = [round(max(0.0, min(_seconds_of(fb + i), _length)), 3)
                       for i in range(len(en["values"]))]
        en["anchored"] = "one time per value, so the curve can be read without the grid"

    return out



def apply_window(out, w, grid):
    bpb = (grid or {}).get("beats_per_bar", 4)
    lo = w["from_bar"]
    hi = lo + (w.get("bars") or 0)

    def in_win(bar):
        return lo <= bar < hi

    def span_touches(sp):
        return sp["to"]["bar"] > lo and sp["from"]["bar"] < hi

    def slice_per_bar(obj):
        if not obj or not isinstance(obj.get("values"), list):
            return obj
        fb = obj.get("from_bar", 0)
        start = max(0, lo - fb)
        end = max(start, hi - fb)
        return {**obj, "from_bar": fb + start, "values": obj["values"][start:end]}

    if out.get("beats"):
        if isinstance(out["beats"], dict) and "list" in out["beats"]:
            lst = [b for b in out["beats"]["list"] if in_win(b[0])]
            out["beats"] = {"derived_from": "grid", "as": "[bar, beat]",
                            "count": len(lst), "list": lst}
        elif isinstance(out["beats"], list):
            out["beats"] = [b for b in out["beats"] if in_win(b.get("bar", 0))]

    if out.get("downbeats"):
        db = out["downbeats"]
        if isinstance(db, dict) and isinstance(db.get("list"), list):
            lst = [b for b in db["list"] if in_win(b[0])]
            out["downbeats"] = {"derived_from": "grid", "as": "[bar, beat]",
                                "count": len(lst), "list": lst}
        elif isinstance(db, list):
            out["downbeats"] = [b for b in db
                                if in_win((b.get("bar", 0) if isinstance(b, dict) else b[0]))]

    if out.get("sections"):
        out["sections"] = [sp for sp in out["sections"] if span_touches(sp)]

    if out.get("energy") and isinstance(out["energy"], dict) and "values" in out["energy"]:
        out["energy"] = slice_per_bar(out["energy"])

    if out.get("moments"):
        out["moments"] = [m for m in out["moments"]
                          if in_win(m.get("at", {}).get("bar", 0))]

    if out.get("curves"):
        out["curves"] = {k: slice_per_bar(v) for k, v in out["curves"].items()}

    if out.get("stems") and out["stems"].get("lanes"):
        fb = out["stems"].get("from_bar", 0)
        start = max(0, lo - fb)
        end = max(start, hi - fb)
        sliced = {}
        for k, v in out["stems"]["lanes"].items():
            sliced[k] = v[start:end] if isinstance(v, list) else v
        out["stems"] = {**out["stems"], "from_bar": fb + start, "lanes": sliced}

    if out.get("harmony"):
        fb = out["harmony"].get("from_bar", 0)
        start = max(0, lo - fb)
        end = max(start, hi - fb)
        out["harmony"] = {
            "from_bar": fb + start,
            "chords": out["harmony"]["chords"][start:end],
            "confidence": out["harmony"]["confidence"][start:end],
        }

    if out.get("chord_changes"):
        out["chord_changes"] = [c for c in out["chord_changes"] if in_win(c["at"]["bar"])]

    for name in ("lift", "tension"):
        row = out.get(name)
        if row and isinstance(row.get("values"), list):
            fb = row.get("from_bar", 0)
            start_beat = max(0, (lo - fb) * bpb)
            end_beat = max(start_beat, (hi - fb) * bpb)
            out[name] = {**row, "from_bar": lo, "from_beat": 1,
                         "values": row["values"][start_beat:end_beat]}

    if out.get("releases"):
        out["releases"] = [r for r in out["releases"] if in_win(r["at"]["bar"])]

    if isinstance(out.get("melody"), list):
        out["melody"] = [n for n in out["melody"] if in_win(n.get("bar", 0))]

    if isinstance(out.get("signals"), list):
        out["signals"] = [g for g in out["signals"]
                          if in_win((g.get("at") or g).get("bar", 0))]

    if out.get("layers"):
        for name in ("subsection", "presence"):
            layer = out["layers"].get(name)
            if layer and isinstance(layer.get("spans"), list):
                out["layers"][name] = {
                    **layer,
                    "spans": [sp for sp in layer["spans"] if span_touches(sp)],
                }

    return out



def filter_response(formatted, fields=None, known=None):
    if not fields:
        return formatted

    want = set(list(fields) + _ALWAYS)
    out = {k: v for k, v in formatted.items() if k in want}

    if known is not None:
        unknown = [f for f in fields if f not in known]
        if unknown:
            out["ignored"] = {"fields": unknown, "known": known}

    return out



def handle(body, fetch_score):
    """Process a score protocol request.

    body        -- the parsed JSON request body
    fetch_score -- callable(name, personality=None) -> parsed score dict.
                   `personality` is how the artist wants this song to look; the
                   hub embeds it when asked, or raises when it is missing.
                   A fetcher that takes only a name still works.
    """
    if not body or not isinstance(body.get("score"), str) or not body["score"]:
        raise ValueError('"score" field is required and must be a non-empty string')

    fields = body.get("fields")
    if fields is not None:
        if not isinstance(fields, list):
            raise ValueError('"fields" must be an array of strings')
        if any(not isinstance(f, str) for f in fields):
            raise ValueError('every entry in "fields" must be a string')

    person = body.get("personality")
    if person is None:
        person = body.get("profile")
    if person is not None:
        if not isinstance(person, str) or not person:
            raise ValueError('"personality" must be a non-empty string')

    try:
        raw = fetch_score(body["score"], person)
    except TypeError:
        if person is not None:
            raise
        raw = fetch_score(body["score"])

    if body.get("version") is not None and body["version"] != raw.get("version"):
        return {
            "error": f"asked for {body['score']}@{body['version']}, "
                     f"have {body['score']}@{raw.get('version')}",
            "note": "a score is immutable once published; a correction is a new version",
        }

    formatted = format_v1(raw)

    req_curves = body.get("curves")
    if req_curves and formatted.get("curves"):
        want = set(req_curves)
        formatted["curves"] = {k: v for k, v in formatted["curves"].items() if k in want}

    req_stems = body.get("stems")
    if req_stems and formatted.get("stems") and formatted["stems"].get("lanes"):
        want = set(req_stems)
        formatted["stems"]["lanes"] = {k: v for k, v in formatted["stems"]["lanes"].items() if k in want}

    req_moments = body.get("moments")
    if isinstance(req_moments, dict) and req_moments.get("min_weight") is not None:
        min_w = req_moments["min_weight"]
        if formatted.get("moments"):
            formatted["moments"] = [
                m for m in formatted["moments"] if _moment_weight(m) >= min_w
            ]

    w = body.get("window")
    formatted["window"] = {"from_bar": w["from_bar"], "bars": w.get("bars")} if w else "whole song"

    if w:
        formatted = apply_window(formatted, w, raw.get("grid"))

    return filter_response(formatted, fields=fields, known=KNOWN)
