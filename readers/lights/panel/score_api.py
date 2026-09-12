"""The score protocol in Python — format, window, filter.

A direct port of the Node score server's contract (server/format/v1.js,
server/handler.js, server/filter.js) so the lights panel can speak the
same protocol without a running Node process.

    handle(body, fetch_score)   the entry point
    format_v1(raw)              raw .score dict  ->  response-shaped dict
    apply_window(out, w, grid)  clip to a bar range (rule 4: never re-anchor)
    filter_response(fmt, fields, known)  keep only what was asked for
"""

KNOWN = [
    "song", "grid", "beats", "downbeats", "sections", "energy",
    "brightness", "width", "air", "pump", "pace", "moments",
    "phrases", "layers", "chords", "key", "loudness", "feel",
]

_STEMS = ["drums", "bass", "vocals", "guitar", "piano", "other"]
_ALWAYS = ["score", "version", "window", "grid"]


# ---------------------------------------------------------------------------
# format_v1 — Python port of server/format/v1.js format()
# ---------------------------------------------------------------------------

def format_v1(raw):
    out = {}
    out["score"] = raw.get("score")
    out["version"] = raw.get("version")

    if raw.get("song"):
        out["song"] = raw["song"]

    if raw.get("grid"):
        out["grid"] = raw["grid"]

    if raw.get("beats"):
        out["beats"] = raw["beats"]
    if raw.get("downbeats"):
        out["downbeats"] = raw["downbeats"]

    # sections: prefer layers.form.spans, fall back to parts
    layers = raw.get("layers") or {}
    form = layers.get("form") or {}
    spans = form.get("spans")
    if spans:
        out["sections"] = [
            {"from": sp["from"], "to": sp["to"],
             "name": sp.get("name"), "repeat": sp.get("repeat")}
            for sp in spans
        ]
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
                "stems": p.get("stems"),
            }
            for p in raw["parts"]
        ]

    # energy
    if raw.get("energy"):
        out["energy"] = raw["energy"]
    elif isinstance((raw.get("bars") or {}).get("intensity"), list):
        out["energy"] = raw["bars"]["intensity"]

    if raw.get("phrases"):
        out["phrases"] = raw["phrases"]

    # per-bar texture lanes
    bars = raw.get("bars") or {}
    for lane in ("width", "air", "pump", "pace"):
        if isinstance(bars.get(lane), list):
            out[lane] = bars[lane]

    # moments
    if raw.get("moments"):
        out["moments"] = raw["moments"]
    elif isinstance(raw.get("events"), list):
        out["moments"] = []
        for ev in raw["events"]:
            m = {
                "at": {"bar": ev.get("bar"), "beat": ev.get("beat")},
                "is": ev.get("is"),
                "strength": ev.get("strength"),
            }
            for opt in ("for_bars", "then", "after", "leaves"):
                if ev.get(opt) is not None:
                    m[opt] = ev[opt]
            out["moments"].append(m)

    # layers
    if raw.get("layers"):
        out["layers"] = raw["layers"]
    elif bars:
        lanes = {}
        for stem in _STEMS:
            if isinstance(bars.get(stem), list):
                lanes[stem] = bars[stem]
        if lanes:
            out["layers"] = lanes

    # chords from bars.chord
    if isinstance(bars.get("chord"), list):
        grid = raw.get("grid") or {}
        first_bar = 0 if (grid.get("first_beat_s") or 0) > 0.2 else 1
        chord_sure = bars.get("chord_sure") or []
        out["chords"] = [
            {"bar": i + first_bar, "name": name,
             "sure": chord_sure[i] if i < len(chord_sure) else None}
            for i, name in enumerate(bars["chord"])
            if name
        ]

    # brightness
    if isinstance(bars.get("brightness"), list):
        out["brightness"] = bars["brightness"]

    # key
    if raw.get("key") or raw.get("chords"):
        out["key"] = dict(raw.get("key") or {})
        chords = raw.get("chords")
        if chords:
            out["key"]["chords_say"] = {
                "root": chords.get("root"),
                "scale": chords.get("scale"),
                "confidence": chords.get("confidence"),
            }
            out["key"]["changes_per_beat"] = chords.get("changes_per_beat")

    if raw.get("loudness"):
        out["loudness"] = raw["loudness"]
    if raw.get("feel"):
        out["feel"] = raw["feel"]

    return out


# ---------------------------------------------------------------------------
# apply_window — Python port of handler.js applyWindow()
# Rule 4: a window clips, it does not re-anchor.
# ---------------------------------------------------------------------------

def apply_window(out, w, grid):
    bpb = (grid or {}).get("beats_per_bar", 4)
    lo = w["from_bar"]
    hi = lo + (w.get("bars") or 0)

    def in_win(bar):
        return lo <= bar < hi

    def span_touches(sp):
        return sp["to"]["bar"] > lo and sp["from"]["bar"] < hi

    if out.get("beats"):
        lst = [b for b in out["beats"]["list"] if in_win(b[0])]
        out["beats"] = {"derived_from": "grid", "as": "[bar, beat]",
                        "count": len(lst), "list": lst}

    if out.get("downbeats"):
        lst = [b for b in out["downbeats"]["list"] if in_win(b[0])]
        out["downbeats"] = {"derived_from": "grid", "as": "[bar, beat]",
                            "count": len(lst), "list": lst}

    if out.get("sections"):
        out["sections"] = [sp for sp in out["sections"] if span_touches(sp)]

    if out.get("energy") and isinstance(out["energy"], dict):
        E = out["energy"]
        start = max(0, lo - E.get("from_bar", 0))
        end = max(start, hi - E.get("from_bar", 0))
        out["energy"] = {
            "per": E.get("per"),
            "from_bar": E.get("from_bar", 0) + start,
            "values": E.get("values", [])[start:end],
        }

    if out.get("moments"):
        out["moments"] = [m for m in out["moments"]
                          if in_win(m.get("at", {}).get("bar", 0))]

    return out


# ---------------------------------------------------------------------------
# filter_response — Python port of server/filter.js
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
# handle — orchestrator, mirrors server/handler.js handle()
# ---------------------------------------------------------------------------

def handle(body, fetch_score):
    """Process a score protocol request.

    body        -- the parsed JSON request body
    fetch_score -- callable(name) -> parsed score dict
    """
    if not body or not isinstance(body.get("score"), str) or not body["score"]:
        raise ValueError('"score" field is required and must be a non-empty string')

    fields = body.get("fields")
    if fields is not None:
        if not isinstance(fields, list):
            raise ValueError('"fields" must be an array of strings')
        if any(not isinstance(f, str) for f in fields):
            raise ValueError('every entry in "fields" must be a string')

    raw = fetch_score(body["score"])

    if body.get("version") is not None and body["version"] != raw.get("version"):
        return {
            "error": f"asked for {body['score']}@{body['version']}, "
                     f"have {body['score']}@{raw.get('version')}",
            "note": "a score is immutable once published; a correction is a new version",
        }

    formatted = format_v1(raw)

    w = body.get("window")
    formatted["window"] = {"from_bar": w["from_bar"], "bars": w.get("bars")} if w else "whole song"

    if w:
        formatted = apply_window(formatted, w, raw.get("grid"))

    return filter_response(formatted, fields=fields, known=KNOWN)
