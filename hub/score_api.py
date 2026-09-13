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

KNOWN = [
    "song", "grid", "beats", "downbeats", "sections", "energy",
    "brightness", "width", "air", "pump", "pace", "weight", "floor",
    "noisy", "held",
    "groove", "ticks", "melody_phrases", "phrase_grid", "scales",
    "presence", "moments",
    "phrases", "layers", "chords", "key", "loudness", "feel",
    "curves", "stems", "harmony", "chord_changes", "chord_summary",
    "tension", "releases", "melody", "signals", "made_by",
    "lyrics", "tells", "motion", "recording",
]

_STEM_NAMES = ["drums", "bass", "vocals", "guitar", "piano", "other"]
_STEM_FOUR  = ["drums", "bass", "vocals", "other"]
_CURVE_NAMES = ["energy", "brightness", "width", "air", "pump", "pace",
                "weight", "floor", "noisy", "held"]
# The personality rides with the score when present, asked for or not: it is how
# the artist wants this song to look, and a consumer that forgot to ask should
# still get it. `profile` was the old name and is still sent alongside, so a
# reader written last week keeps working.
_ALWAYS = ["score", "version", "window", "grid", "personality", "profile"]


def _or(v, d):
    """Default on absence, never on falsiness. 0 and False are real values."""
    return d if v is None else v


# ---------------------------------------------------------------------------
# format_v1
# ---------------------------------------------------------------------------

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

    out["score"] = raw.get("score")
    out["version"] = raw.get("version")

    # ---- song ----
    if raw.get("song"):
        out["song"] = dict(raw["song"])
        # The grid counted the bars; deriving them from the length is only a
        # fallback. Preferring the derivation gave song.bars 127 while grid.bars
        # said 124 for the same song -- two fields that both mean "how many
        # bars", disagreeing, with nothing to say which to believe.
        if out["song"].get("bars") is None:
            if grid.get("bars") is not None:
                out["song"]["bars"] = grid["bars"]
            elif out["song"].get("length_s") and bpm:
                out["song"]["bars"] = math.ceil((out["song"]["length_s"] - first_beat_s) / bar_sec)

    # ---- grid (with holds_from / holds_to) ----
    if raw.get("grid"):
        out["grid"] = dict(raw["grid"])
        if raw["grid"].get("holds_from_s") is not None:
            i = (raw["grid"]["holds_from_s"] - first_beat_s) / beat_sec
            out["grid"]["holds_from"] = {"bar": first_bar + int(i // bpb), "beat": int(i % bpb) + 1}
        if raw["grid"].get("holds_to_s") is not None:
            i = (raw["grid"]["holds_to_s"] - first_beat_s) / beat_sec
            out["grid"]["holds_to"] = {"bar": first_bar + int(i // bpb), "beat": int(i % bpb) + 1}

    # ---- beats ----
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
        out["downbeats"] = [e for e, b in zip(out["beats"], raw["beats"])
                            if isinstance(b, dict) and b.get("downbeat")]

    # ---- sections ----
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
                # Which section this repeats, how cleanly it sits in that
                # group, whether it trades back and forth inside itself, and
                # whether a model that shares nothing with our detectors heard
                # the same boundary. The JS formatter carried these and this
                # one did not.
                "repeats_as": p.get("repeats_as"),
                "sure": p.get("sure"),
                "trades": p.get("trades"),
                "also_heard": p.get("also_heard"),
                "edge": p.get("edge"),
                "sudden": p.get("sudden"),
                "stems": p.get("stems"),
            }
            for p in raw["parts"]
        ]

    # ---- energy (backward compat) ----
    if raw.get("energy"):
        out["energy"] = raw["energy"]
    elif isinstance((raw.get("bars") or {}).get("intensity"), list):
        out["energy"] = {"per": "bar", "from_bar": first_bar,
                         "values": raw["bars"]["intensity"]}

    # ---- bare per-bar lanes (backward compat) ----
    if raw.get("phrases"):
        out["phrases"] = raw["phrases"]

    bars = raw.get("bars") or {}
    for lane in ("width", "air", "pump", "pace"):
        if isinstance(bars.get(lane), list):
            out[lane] = bars[lane]
    if isinstance(bars.get("brightness"), list):
        out["brightness"] = bars["brightness"]
    # air and brightness are both the top of the spectrum; nothing measured the
    # bottom, which is most of what a drop feels like.
    for band in ("weight", "floor", "noisy", "held"):
        if isinstance(bars.get(band), list):
            out[band] = bars[band]
    # These three were carried by the JS formatter and not this one, which is
    # the same drift in the other direction.
    said = {}
    for name, v in (raw.get("curve_tells") or {}).items():
        said["energy" if name == "intensity" else name] = v
    if said:
        out["tells"] = said

    if isinstance(out.get("energy"), dict) and "energy" in (out.get("tells") or {}):
        out["energy"]["tells"] = out["tells"]["energy"]

    for whole in ("groove", "ticks", "melody_phrases",
                  "phrase_grid", "scales", "presence", "lyrics",
                  "motion", "recording"):
        if raw.get(whole) is not None:
            out[whole] = raw[whole]

    # ---- curves ----
    curve_entries = {}
    for name in _CURVE_NAMES:
        if name == "energy":
            src = (raw.get("energy") or {}).get("values") or bars.get("intensity")
        else:
            src = bars.get(name)
        if isinstance(src, list):
            fb = (raw.get("energy") or {}).get("from_bar", first_bar) if name == "energy" else first_bar
            lane = "intensity" if name == "energy" else name
            curve_entries[name] = {"per": "bar", "from_bar": fb, "values": src,
                                   "tells": (raw.get("curve_tells") or {}).get(lane)}
    if curve_entries:
        out["curves"] = curve_entries

    # ---- stems ----
    stem_lanes = {}
    for s in _STEM_NAMES:
        if isinstance(bars.get(s), list):
            stem_lanes[s] = bars[s]
    if stem_lanes:
        out["stems"] = {"normalised": "per-stem-peak-within-song",
                        "from_bar": first_bar, "lanes": stem_lanes}

    # ---- moments ----
    # A moment says where it is as `at: {bar, beat}`, whichever source it came
    # from. The pipeline writes bar and beat flat at the top of the object and
    # the events fallback nested them, so the same field arrived in two shapes
    # depending on which branch fired -- and a consumer reading m["at"] worked
    # on one score and raised on the next.
    _M_KEYS = ("is", "what", "sure", "weight", "strength",
               "for_beats", "for_bars", "then", "after", "leaves")
    if raw.get("moments"):
        out["moments"] = []
        for mo in raw["moments"]:
            if mo.get("at"):
                out["moments"].append(mo)
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

    # ---- layers ----
    if raw.get("layers"):
        out["layers"] = dict(raw["layers"])
    elif bars:
        lanes = {}
        for stem in _STEM_NAMES:
            if isinstance(bars.get(stem), list):
                lanes[stem] = bars[stem]
        if lanes:
            out["layers"] = lanes

    if "layers" not in out:
        out["layers"] = {}

    # layers.subsection (from phrases)
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
                    "has_break": p.get("has_break"),
                    "break": p.get("break"),
                }
                for p in raw["phrases"]
            ],
        }

    # layers.presence (from parts[].stems)
    if "presence" not in out["layers"] and isinstance(raw.get("parts"), list):
        pres_spans = []
        for part in raw["parts"]:
            stems = part.get("stems")
            if not stems:
                continue
            for stem, info in stems.items():
                state = info if isinstance(info, str) else (info.get("is") if isinstance(info, dict) else None)
                if state and state != "none":
                    pres_spans.append({
                        "from": {"bar": part["from_bar"], "beat": 1},
                        "to": {"bar": part["to_bar"] + 1, "beat": 1},
                        "stem": stem, "state": state,
                    })
        if pres_spans:
            out["layers"]["presence"] = {"kind": "sparse", "spans": pres_spans}

    # layers.phrase (from phrase_grid)
    if "phrase" not in out["layers"] and raw.get("phrase_grid"):
        pg = raw["phrase_grid"]
        out["layers"]["phrase"] = {
            "kind": "rule",
            "every_bars": pg.get("every_bars"),
            "from_bar": pg.get("from_bar"),
            "boundaries_on_grid": pg.get("boundaries_on_grid"),
        }

    if not out["layers"]:
        del out["layers"]

    # ---- harmony ----
    if isinstance(bars.get("chord"), list):
        out["harmony"] = {
            "from_bar": first_bar,
            "chords": bars["chord"],
            "confidence": bars.get("chord_sure") or [],
        }

    # ---- chord_changes (derived) ----
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

    # ---- chords (backward compat) ----
    if isinstance(bars.get("chord"), list):
        chord_sure = bars.get("chord_sure") or []
        out["chords"] = [
            {"bar": i + first_bar, "name": name,
             "sure": chord_sure[i] if i < len(chord_sure) else None}
            for i, name in enumerate(bars["chord"])
            if name
        ]

    # ---- key ----
    if raw.get("key") or raw.get("chords"):
        out["key"] = dict(raw.get("key") or {})
        chords_obj = raw.get("chords")
        if chords_obj:
            out["key"]["changes_per_beat"] = chords_obj.get("changes_per_beat")

    # ---- chord_summary ----
    if raw.get("chords"):
        out["chord_summary"] = {
            "changes_per_beat": raw["chords"].get("changes_per_beat"),
        }

    if raw.get("loudness"):
        out["loudness"] = raw["loudness"]
    if raw.get("feel"):
        out["feel"] = raw["feel"]

    # ---- tension ----
    if isinstance(raw.get("tension"), list):
        out["tension"] = {"per": "beat", "from_bar": first_bar,
                          "from_beat": 1, "values": raw["tension"]}

    # ---- releases (seconds to positions) ----
    if isinstance(raw.get("releases"), list):
        out["releases"] = []
        for r in raw["releases"]:
            if r.get("bar") is not None and r.get("beat") is not None:
                at = {"bar": r["bar"], "beat": r["beat"]}
            else:
                i = (r["at_s"] - first_beat_s) / beat_sec
                at = {"bar": first_bar + int(i // bpb), "beat": int(i % bpb) + 1}
            one = {"at": at, "size": r.get("size")}
            if r.get("at_s") is not None:
                one["at_s"] = r["at_s"]
            if r.get("lead_beats") is not None:
                one["lead_beats"] = r["lead_beats"]
            out["releases"].append(one)

    # ---- melody: the notes of the lead line and the voice ----
    if raw.get("melody"):
        out["melody"] = raw["melody"]
    for k in ("lead", "voice"):
        if raw.get(k):
            out[k] = raw[k]

    # ---- signals: changes the pipeline noticed that are not moments ----
    if raw.get("signals"):
        out["signals"] = raw["signals"]

    # ---- made_by ----
    if raw.get("made_by"):
        out["made_by"] = raw["made_by"]

    # ---- personality: the artist's layer, embedded by the hub on pull ----
    person = raw.get("personality") or raw.get("profile")
    if person:
        out["personality"] = person
        out["profile"] = person        # the old name, until everyone has moved

    return out


# ---------------------------------------------------------------------------
# apply_window
# ---------------------------------------------------------------------------

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

    # beats
    if out.get("beats"):
        if isinstance(out["beats"], dict) and "list" in out["beats"]:
            lst = [b for b in out["beats"]["list"] if in_win(b[0])]
            out["beats"] = {"derived_from": "grid", "as": "[bar, beat]",
                            "count": len(lst), "list": lst}
        elif isinstance(out["beats"], list):
            out["beats"] = [b for b in out["beats"] if in_win(b.get("bar", 0))]

    # downbeats arrive in two shapes: the wrapped {list: [[bar, beat], ...]} a
    # score may carry, and the plain list of entries the formatter derives from
    # beats. Windowing assumed the wrapped one, so any windowed request that
    # included downbeats raised. The Node half already guarded for both.
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

    # curves
    if out.get("curves"):
        out["curves"] = {k: slice_per_bar(v) for k, v in out["curves"].items()}

    # stems
    if out.get("stems") and out["stems"].get("lanes"):
        fb = out["stems"].get("from_bar", 0)
        start = max(0, lo - fb)
        end = max(start, hi - fb)
        sliced = {}
        for k, v in out["stems"]["lanes"].items():
            sliced[k] = v[start:end] if isinstance(v, list) else v
        out["stems"] = {**out["stems"], "from_bar": fb + start, "lanes": sliced}

    # harmony
    if out.get("harmony"):
        fb = out["harmony"].get("from_bar", 0)
        start = max(0, lo - fb)
        end = max(start, hi - fb)
        out["harmony"] = {
            "from_bar": fb + start,
            "chords": out["harmony"]["chords"][start:end],
            "confidence": out["harmony"]["confidence"][start:end],
        }

    # chord_changes
    if out.get("chord_changes"):
        out["chord_changes"] = [c for c in out["chord_changes"] if in_win(c["at"]["bar"])]

    # tension
    if out.get("tension") and isinstance(out["tension"].get("values"), list):
        fb = out["tension"].get("from_bar", 0)
        start_beat = max(0, (lo - fb) * bpb)
        end_beat = max(start_beat, (hi - fb) * bpb)
        out["tension"] = {
            **out["tension"],
            "from_bar": lo, "from_beat": 1,
            "values": out["tension"]["values"][start_beat:end_beat],
        }

    # releases
    if out.get("releases"):
        out["releases"] = [r for r in out["releases"] if in_win(r["at"]["bar"])]

    # melody — a list of notes, each at its own bar and beat
    if isinstance(out.get("melody"), list):
        out["melody"] = [n for n in out["melody"] if in_win(n.get("bar", 0))]

    # signals — same shape as moments, flat or nested
    if isinstance(out.get("signals"), list):
        out["signals"] = [g for g in out["signals"]
                          if in_win((g.get("at") or g).get("bar", 0))]

    # layers — subsection and presence spans
    if out.get("layers"):
        for name in ("subsection", "presence"):
            layer = out["layers"].get(name)
            if layer and isinstance(layer.get("spans"), list):
                out["layers"][name] = {
                    **layer,
                    "spans": [sp for sp in layer["spans"] if span_touches(sp)],
                }

    return out


# ---------------------------------------------------------------------------
# filter_response
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# handle
# ---------------------------------------------------------------------------

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

    # either spelling on the way in; `profile` was the name until this layer was
    # called a personality, and a request written last week still has to work
    person = body.get("personality")
    if person is None:
        person = body.get("profile")
    if person is not None:
        if not isinstance(person, str) or not person:
            raise ValueError('"personality" must be a non-empty string')

    try:
        raw = fetch_score(body["score"], person)
    except TypeError:
        # a fetcher that predates this takes the name alone
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

    # selective curves
    req_curves = body.get("curves")
    if req_curves and formatted.get("curves"):
        want = set(req_curves)
        formatted["curves"] = {k: v for k, v in formatted["curves"].items() if k in want}

    # selective stems
    req_stems = body.get("stems")
    if req_stems and formatted.get("stems") and formatted["stems"].get("lanes"):
        want = set(req_stems)
        formatted["stems"]["lanes"] = {k: v for k, v in formatted["stems"]["lanes"].items() if k in want}

    # moments min_weight filter
    req_moments = body.get("moments")
    if isinstance(req_moments, dict) and req_moments.get("min_weight") is not None:
        min_w = req_moments["min_weight"]
        if formatted.get("moments"):
            formatted["moments"] = [
                m for m in formatted["moments"]
                if (m.get("weight") if m.get("weight") is not None else 1) >= min_w
            ]

    w = body.get("window")
    formatted["window"] = {"from_bar": w["from_bar"], "bars": w.get("bars")} if w else "whole song"

    if w:
        formatted = apply_window(formatted, w, raw.get("grid"))

    return filter_response(formatted, fields=fields, known=KNOWN)
