"""The LLM composer: given a score and an effect catalog, compose a lighting show.

Runs ONCE per song, offline. Never between the music and the lamps. The output is
a show plan (states, bindings, gestures) that the baker turns into DMX frames.

See architecture.md for the full design.

  python3 portal/composer.py <song_name> [--hub URL] [--model MODEL]

Requires: pip install groq
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)

HUB = os.environ.get("HUB_URL", "http://127.0.0.1:8770")
CATALOG_FILE = os.path.join(HERE, "effects.json")
PROMPT_FILE = os.path.join(HERE, "composer-prompt.md")


# ── hub helpers ───────────────────────────────────────────────────────────────

def hub_get(path):
    with urllib.request.urlopen(HUB + path, timeout=20) as r:
        return json.load(r)


def hub_score(body):
    req = urllib.request.Request(
        HUB + "/hub/score",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


# ── score overview ────────────────────────────────────────────────────────────

def fetch_overview(song):
    """Fetch the overview for a song: sections, moments, streams, caption, grid."""
    data = hub_score({
        "score": song,
        "fields": ["grid", "song", "sections", "moments", "curves", "key",
                   "per_beat", "caption", "emotion", "presence", "chords"],
        "curves": ["energy", "brightness", "groove"],
    })
    return data


def _section_weight(data, sec):
    sc = _score_of(data) if data.get("_song") else {}
    stp = sc.get("stems_temporal") or {}
    lanes = stp.get("stems") or {}
    if not lanes:
        return ""
    w = stp.get("window_s") or 0.5
    n = min(len(v) for v in lanes.values())
    whole = [sum(v[i] for v in lanes.values()) / len(lanes) for i in range(n)]
    order = sorted(whole)
    lo = order[int(len(order) * 0.05)]
    hi = order[int(len(order) * 0.95)]
    a_s, b_s = sec.get("start"), sec.get("end")
    if a_s is None or b_s is None or hi <= lo:
        return ""
    seg = whole[int(a_s / w):int(b_s / w) + 1]
    if not seg:
        return ""
    mean = sum(seg) / len(seg)
    rel = max(0.0, min(1.0, (mean - lo) / (hi - lo)))
    busy = sum(1 for nm, v in lanes.items()
               if sum(1 for x in v[int(a_s / w):int(b_s / w) + 1] if x > 0.2)
               > 0.25 * max(1, int((b_s - a_s) / w)))
    return f"   [loudness {rel:.2f} of this song's range, {busy} instruments carrying]"


def format_overview(data):
    """Format the score overview into a compact string for the LLM."""
    lines = []

    cap = data.get("caption") or data.get("song", {}).get("title", "untitled")
    if isinstance(cap, str) and len(cap) > 240:
        cap = cap[:237].rstrip() + "…"        # keep the input small for tight-context models
    lines.append(f"SONG: {cap}")

    g = data.get("grid") or {}
    lines.append(f"TEMPO: {g.get('bpm', '?')} bpm, {g.get('beats_per_bar', 4)}/4, {g.get('bars', '?')} bars")
    steady = g.get("steady")
    if isinstance(steady, (int, float)):
        lines.append(f"  grid.steady {steady:.2f} - how even the beat is; under 0.35 do not trust a bar number")
    if (g.get("tempo") or []) and len(g["tempo"]) > 1:
        moves = ", ".join(f"{t.get('bpm')} bpm from {t.get('at_s')}s" for t in g["tempo"][:4])
        lines.append(f"  THIS SONG CHANGES TEMPO: {moves}")

    k = data.get("key") or {}
    if k:
        lines.append(f"KEY: {k.get('name', '?')} (root={k.get('root', '?')}, hue={k.get('hue', '?')})")

    sections = data.get("sections") or []
    lines.append(f"\nSECTIONS ({len(sections)}):")
    for i, s in enumerate(sections):
        name = s.get("name", "unnamed")
        fr = s.get("from", {})
        to = s.get("to", {})
        lines.append(f"  [{i}] {name}: bar {fr.get('bar', '?')} → {to.get('bar', '?')}"
                     + _section_weight(data, s))

    moments = data.get("moments") or []
    lines.append(f"\nMOMENTS ({len(moments)}):")
    for i, m in enumerate(moments):
        at = m.get("at", {})
        lines.append(
            f"  [{i}] bar {at.get('bar', '?')} beat {at.get('beat', '?')} "
            f"t={m.get('time_s', '?')}s type={m.get('type', '?')} "
            f"intensity={m.get('intensity', '?')} — {m.get('description', '')}"
        )

    # Emotion spans are prose, not placement data (rule 2: measurement places,
    # prose characterises). Listing all of them blew the context window on small
    # models, so summarise here and let the model pull detail with tools if needed.
    emotions = data.get("emotion") or data.get("emotions") or []
    if emotions:
        dims = ("energy", "brightness", "groove", "mode")
        span = {}
        for k in dims:
            vals = [e[k] for e in emotions if isinstance(e.get(k), (int, float))]
            if vals:
                span[k] = (min(vals), max(vals))
        lines.append(f"\nHOW IT FEELS ({len(emotions)} measured spans)")
        if span:
            lines.append("  across this song: " + ", ".join(
                f"{k} {lo:.1f}..{hi:.1f}" for k, (lo, hi) in span.items()))
        for i, sec in enumerate(sections):
            a_s, b_s = sec.get("start"), sec.get("end")
            if a_s is None or b_s is None:
                continue
            inside = [e for e in emotions
                      if e.get("start") is not None and a_s <= e["start"] < b_s]
            if not inside:
                continue
            bit = []
            for k in dims:
                vals = [e[k] for e in inside if isinstance(e.get(k), (int, float))]
                if vals:
                    bit.append(f"{k} {sum(vals)/len(vals):.1f}")
            named = {}
            for e in inside:
                n = e.get("emotion")
                if n:
                    named[n] = named.get(n, 0) + 1
            top = max(named, key=named.get) if named else ""
            lines.append(f"  [{i}] {sec.get('name', '?')}: " + ", ".join(bit)
                         + (f"  — mostly {top}" if top else ""))
        lines.append("  energy/brightness/groove are 0..10 within this song; mode is -1 minor "
                     "to +1 major. They are measured per bar, not written by a model.")

    sc = _score_of(data) if data.get("_song") else {}
    lanes = ((sc.get("stems_temporal") or {}).get("stems")) or {}
    loud = sc.get("stems") or {}
    if lanes:
        w = (sc.get("stems_temporal") or {}).get("window_s") or 0.5
        rows = []
        for nm, v in lanes.items():
            top = max(v) if v else 0
            if top < 0.12:
                continue
            on = [i for i, x in enumerate(v) if x >= 0.25 * top]
            if not on:
                continue
            db = (loud.get(nm) or {}).get("db")
            rows.append((db if isinstance(db, (int, float)) else -99, nm, top,
                         round(on[0] * w, 1), round(on[-1] * w, 1),
                         len(on) / max(len(v), 1)))
        rows.sort(key=lambda r: -r[0])
        lines.append(f"\nWHAT IS PLAYING ({len(rows)} instrument lanes, loudest first)")
        for db, nm, top, a_s, b_s, share in rows[:26]:
            when = "throughout" if share > 0.6 else f"{a_s:.0f}s-{b_s:.0f}s"
            lines.append(f"  {nm:16s} {db:6.1f} dB  peak {top:.2f}  plays {share:.0%} of the song, {when}")
        if len(rows) > 26:
            lines.append(f"  ...and {len(rows)-26} quieter lanes; ask `lane <name> <from_s> <to_s>` for any of them")
        lines.append("  Every one of these is a stream you may bind or point a lamp at.")

    streams = data.get("streams") or data.get("lanes") or []
    if streams:
        names = []
        for s in streams:
            if isinstance(s, str):
                names.append(s)
            elif isinstance(s, dict):
                names.append(s.get("name", s.get("id", "?")))
        lines.append(f"\nSTREAMS ({len(names)}): {', '.join(names)}")

    return "\n".join(lines)


# ── tool definitions (OpenAI format for Groq) ────────────────────────────────

TOOL_DEFINITIONS = [
    {
        "type": "function",
        "function": {
            "name": "lane",
            "description": "Get the level of a named instrument lane over a time range.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Lane/stream name from the overview"},
                    "from_s": {"type": "number", "description": "Start time in seconds"},
                    "to_s": {"type": "number", "description": "End time in seconds"},
                },
                "required": ["name", "from_s", "to_s"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "onsets",
            "description": "Get drum/percussive onsets in a bar range above a threshold.",
            "parameters": {
                "type": "object",
                "properties": {
                    "from_bar": {"type": "integer"},
                    "to_bar": {"type": "integer"},
                    "threshold": {"type": "number", "description": "0..1, onsets above this"},
                },
                "required": ["from_bar", "to_bar"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "compare",
            "description": "Compare two or more streams over a bar range.",
            "parameters": {
                "type": "object",
                "properties": {
                    "streams": {"type": "array", "items": {"type": "string"}},
                    "from_bar": {"type": "integer"},
                    "to_bar": {"type": "integer"},
                },
                "required": ["streams", "from_bar", "to_bar"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "chords",
            "description": "Get chord changes over a time range.",
            "parameters": {
                "type": "object",
                "properties": {
                    "from_s": {"type": "number"},
                    "to_s": {"type": "number"},
                },
                "required": ["from_s", "to_s"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "melody",
            "description": "Get melody contour over a time range.",
            "parameters": {
                "type": "object",
                "properties": {
                    "from_s": {"type": "number"},
                    "to_s": {"type": "number"},
                },
                "required": ["from_s", "to_s"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "moment",
            "description": "Get full detail on a single moment by index.",
            "parameters": {
                "type": "object",
                "properties": {
                    "index": {"type": "integer"},
                },
                "required": ["index"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "section",
            "description": "Get full detail on a section by index.",
            "parameters": {
                "type": "object",
                "properties": {
                    "index": {"type": "integer"},
                },
                "required": ["index"],
            },
        },
    },
]


_SCORES = {}


def _score_of(overview):
    song = overview.get("_song")
    if song in _SCORES:
        return _SCORES[song]
    base = os.path.join(REPO, "hub", "files", "score")
    at = os.path.join(base, song + ".score")
    if not os.path.isfile(at):
        store = os.path.join(base, ".versions", song + ".score")
        try:
            ns = [int(x.split(".")[0]) for x in os.listdir(store)
                  if x.endswith(".score") and x.split(".")[0].isdigit()]
            at = os.path.join(store, "%d.score" % max(ns)) if ns else at
        except OSError:
            pass
    try:
        with open(at) as fh:
            _SCORES[song] = json.load(fh)
    except OSError:
        _SCORES[song] = {}
    return _SCORES[song]


def _bar_phase(sc, bpb):
    flags = [i for i, b in enumerate(sc.get("beats") or [])
             if isinstance(b, dict) and b.get("downbeat")]
    return (flags[0] % bpb) if flags else 0


def _sec_of_bar(sc, bar):
    g = sc.get("grid") or {}
    bpb = g.get("beats_per_bar") or 4
    beats = [b.get("t") if isinstance(b, dict) else b for b in (sc.get("beats") or [])]
    beats = [t for t in beats if isinstance(t, (int, float))]
    i = max(0, _bar_phase(sc, bpb) + (int(bar) - 1) * bpb)
    if beats and i < len(beats):
        return float(beats[i])
    if beats:
        return float(beats[-1])
    return (g.get("first_beat_s") or 0) + (bar - 1) * bpb * 60.0 / (g.get("bpm") or 120)


def handle_tool_call(name, args, overview):
    """Handle a tool call from the LLM by forwarding to the hub or reading the overview."""
    sections = overview.get("sections") or []
    moments = overview.get("moments") or []

    def _turn_at(ov, t, look=2.5, top=6):
        try:
            sc = _score_of(ov)
        except Exception:
            return {}
        st = sc.get("stems_temporal") or {}
        lanes = st.get("stems") or {}
        w = st.get("window_s") or 0.5
        summ = sc.get("stems") or {}
        b0, b1 = int(max(0, t - look) / w), int(t / w)
        a0, a1 = int(t / w), int((t + look) / w)
        rows = []
        for lane, ser in lanes.items():
            pre = ser[b0:b1] or [0]
            post = ser[a0:a1] or [0]
            mb, ma = sum(pre) / len(pre), sum(post) / len(post)
            if max(mb, ma) < 0.12:
                continue
            rows.append((ma - mb, lane, round(mb, 2), round(ma, 2),
                         (summ.get(lane) or {}).get("db")))
        rows.sort(key=lambda r: -abs(r[0]))
        arriving = [{"lane": l, "before": b, "after": a, "db_in_mix": d}
                    for chg, l, b, a, d in rows if chg > 0.08][:top]
        leaving = [{"lane": l, "before": b, "after": a, "db_in_mix": d}
                   for chg, l, b, a, d in rows if chg < -0.08][:top]
        return {"window_s": look, "arriving": arriving, "leaving": leaving,
                "verdict": ("light should arrive" if len(arriving) > len(leaving)
                            else "light should leave" if leaving else "no clear turn")}
    def _playing_in(ov, t0, t1, top=10):
        try:
            sc = _score_of(ov)
        except Exception:
            return []
        st = sc.get("stems_temporal") or {}
        lanes = st.get("stems") or {}
        w = st.get("window_s") or 0.5
        summ = sc.get("stems") or {}
        a0, a1 = int(t0 / w), max(int(t0 / w) + 1, int(t1 / w))
        rows = []
        for lane, ser in lanes.items():
            part = ser[a0:a1]
            if not part:
                continue
            pk = max(part)
            if pk < 0.12:
                continue
            cov = sum(1 for x in part if x > 0.15) / len(part)
            db = (summ.get(lane) or {}).get("db")
            rows.append({"lane": lane, "peak": round(pk, 2),
                         "coverage": round(cov, 2),
                         "mean": round(sum(part) / len(part), 2),
                         "db_in_mix": db})
        rows.sort(key=lambda r: (-r["peak"], -r["coverage"]))
        return rows[:top]

    if name == "moment":
        idx = args.get("index", 0)
        if 0 <= idx < len(moments):
            m = dict(moments[idx])
            t = m.get("time_s")
            if isinstance(t, (int, float)):
                m["what_changes"] = _turn_at(overview, t)
            return json.dumps(m)
        return json.dumps({"error": f"moment {idx} out of range (0..{len(moments)-1})"})



    if name == "section":
        idx = args.get("index", 0)
        if 0 <= idx < len(sections):
            sec = dict(sections[idx])
            t0 = sec.get("start")
            t1 = sec.get("end")
            if isinstance(t0, (int, float)) and isinstance(t1, (int, float)):
                sec["playing"] = _playing_in(overview, t0, t1)
            return json.dumps(sec)
        return json.dumps({"error": f"section {idx} out of range"})

    sc = _score_of(overview)

    if name == "lane":
        want = args.get("name")
        a, b = float(args.get("from_s", 0)), float(args.get("to_s", 1e9))
        lanes = ((sc.get("stems_temporal") or {}).get("stems")) or {}
        v = lanes.get(want)
        if v is None:
            near = [k for k in lanes if want and want.lower() in k.lower()]
            return json.dumps({"summary": f"no lane called '{want}'",
                               "did_you_mean": near[:6] or sorted(lanes)[:12]})
        w = (sc.get("stems_temporal") or {}).get("window_s") or 0.5
        i, j = max(0, int(a / w)), min(len(v), int(b / w) + 1)
        seg = v[i:j]
        if not seg:
            return json.dumps({"summary": f"'{want}' has no samples between {a}s and {b}s"})
        top = max(seg)
        loud = (sc.get("stems") or {}).get(want) or {}
        on = [k for k, x in enumerate(seg) if x >= 0.25 * max(top, 1e-9)]
        return json.dumps({
            "lane": want, "from_s": a, "to_s": b, "window_s": w,
            "mean": round(sum(seg) / len(seg), 3), "peak": round(top, 3),
            "carries_from_s": round(a + on[0] * w, 2) if on else None,
            "carries_to_s": round(a + on[-1] * w, 2) if on else None,
            "share_of_span_playing": round(len(on) / len(seg), 3),
            "db_in_mix": loud.get("db"),
            "shape": [round(x, 2) for x in seg[:: max(1, len(seg) // 24)]],
        })

    if name == "onsets":
        hits = ((sc.get("rhythm") or {}).get("hits")) or []
        thr = float(args.get("threshold", 0.0) or 0.0)
        a = _sec_of_bar(sc, int(args.get("from_bar", 1)))
        b = _sec_of_bar(sc, int(args.get("to_bar", 9999)) + 1)
        got = [h for h in hits
               if isinstance(h, dict) and h.get("t") is not None
               and a <= h["t"] < b and (h.get("intensity") or 0) >= thr]
        if not got:
            return json.dumps({"summary": f"no onsets above {thr} between {a:.1f}s and {b:.1f}s"})
        span = max(b - a, 1e-9)
        return json.dumps({
            "from_bar": args.get("from_bar"), "to_bar": args.get("to_bar"),
            "from_s": round(a, 2), "to_s": round(b, 2),
            "count": len(got), "per_second": round(len(got) / span, 2),
            "mean_intensity": round(sum(h.get("intensity", 0) for h in got) / len(got), 3),
            "busiest_second": round(max(
                ((sum(1 for h in got if t <= h["t"] < t + 1), t)
                 for t in [a + k for k in range(int(span))]), default=(0, a))[1], 1),
        })

    if name == "compare":
        names = args.get("streams") or []
        a = _sec_of_bar(sc, int(args.get("from_bar", 1)))
        b = _sec_of_bar(sc, int(args.get("to_bar", 9999)) + 1)
        stp = sc.get("stems_temporal") or {}
        lanes = stp.get("stems") or {}
        w = stp.get("window_s") or 0.5
        out = {}
        cut = {}
        for n in names:
            v = lanes.get(n)
            if v is None:
                out[n] = "no such lane"
                continue
            i, j = max(0, int(a / w)), min(len(v), int(b / w) + 1)
            seg = v[i:j]
            cut[n] = seg
            out[n] = {"mean": round(sum(seg) / max(len(seg), 1), 3),
                      "peak": round(max(seg) if seg else 0, 3)}
        pair = None
        keys = [k for k in cut if cut[k]]
        if len(keys) >= 2:
            x, y = cut[keys[0]], cut[keys[1]]
            n = min(len(x), len(y))
            gate = 0.25
            both = sum(1 for k in range(n) if x[k] > gate and y[k] > gate)
            either = sum(1 for k in range(n) if x[k] > gate or y[k] > gate)
            pair = {"lanes": keys[:2],
                    "overlap_share": round(both / max(either, 1), 3),
                    "verdict": ("they alternate" if both / max(either, 1) < 0.35
                                else "they play together")}
        return json.dumps({"from_s": round(a, 2), "to_s": round(b, 2),
                           "lanes": out, "together": pair})

    if name == "chords":
        a, b = float(args.get("from_s", 0)), float(args.get("to_s", 1e9))
        raw = sc.get("btc_chords_raw") or sc.get("chords") or []
        spans = []
        for c in raw:
            if not isinstance(c, dict):
                continue
            st, en = c.get("start"), c.get("end")
            if st is None or en is None or en <= a or st >= b:
                continue
            spans.append({"start": round(float(st), 2), "end": round(float(en), 2),
                          "chord": c.get("chord") or c.get("label")})
        if not spans:
            return json.dumps({"summary": f"no chords between {a}s and {b}s"})
        turns = len(spans)
        held = max(spans, key=lambda x: x["end"] - x["start"])
        return json.dumps({"of": "seconds, absolute in the song",
                           "from_s": a, "to_s": b, "changes": turns,
                           "per_minute": round(turns / max((b - a) / 60, 1e-9), 1),
                           "longest_held": held,
                           "spans": spans[:40]})

    if name == "melody":
        a, b = float(args.get("from_s", 0)), float(args.get("to_s", 1e9))
        notes = [n for n in (sc.get("melody") or [])
                 if isinstance(n, dict) and n.get("start") is not None
                 and a <= float(n["start"]) < b]
        if not notes:
            return json.dumps({"summary": f"no melody notes between {a}s and {b}s"})
        ps = [n.get("pitch") for n in notes if isinstance(n.get("pitch"), (int, float))]
        first, last = notes[0], notes[-1]
        half = max(1, len(ps) // 2)
        rise = (sum(ps[-half:]) / half) - (sum(ps[:half]) / half) if ps else 0
        return json.dumps({
            "of": "seconds, absolute in the song",
            "from_s": a, "to_s": b, "notes": len(notes),
            "lowest_midi": min(ps) if ps else None, "highest_midi": max(ps) if ps else None,
            "contour": "rising" if rise > 1.5 else "falling" if rise < -1.5 else "level",
            "semitones_moved": round(rise, 1),
            "first_note_s": round(float(first["start"]), 2),
            "last_note_s": round(float(last["start"]), 2),
            "notes_per_second": round(len(notes) / max(b - a, 1e-9), 2),
        })

    return json.dumps({"error": f"unknown tool '{name}'"})


# ── effects block for the prompt ──────────────────────────────────────────────

def build_effects_block(catalog):
    """Format the catalog effects into a compact block for the system prompt,
    including dial types and valid ranges so the LLM knows what values to emit."""
    lines = []
    for e in catalog:
        dial_parts = []
        for dk, dv in e.get("dials", {}).items():
            if isinstance(dv, dict):
                default = dv.get("default")
                lo, hi = dv.get("min"), dv.get("max")
                if lo is not None and hi is not None:
                    dial_parts.append(f"{dk}={default} ({lo}..{hi})")
                elif isinstance(default, list):
                    dial_parts.append(f"{dk}={default} (rgb 0-1 or hex)")
                elif isinstance(default, str):
                    dial_parts.append(f"{dk}=\"{default}\"")
                else:
                    dial_parts.append(f"{dk}={default}")
            else:
                dial_parts.append(f"{dk}={dv}")
        fires = ", ".join(e.get("fires_on", []))
        span = ""
        if e.get("span_anchors"):
            span = f"  (anchor with {' + '.join(e['span_anchors'])})"
        lines.append(
            f"  {e['id']} ({e['kind']}, {e['dimension']}): {e['blurb']}{span}\n"
            f"    dials: {', '.join(dial_parts) if dial_parts else '(none)'}\n"
            f"    fires on: {fires}\n"
            f"    returns: {e.get('returns', True)}"
        )
    return "\n".join(lines)


# ── compose ───────────────────────────────────────────────────────────────────

DEFAULT_MODEL = "openai/gpt-oss-20b"


def compose(song, model=None, max_retries=1):
    """Compose a lighting show for a song using Groq.

    Returns (show_plan, report, overview) on success.
    Raises on fatal failure.
    """
    try:
        from groq import Groq
    except ImportError:
        raise RuntimeError("groq SDK not installed: pip install groq")

    model = model or DEFAULT_MODEL

    catalog = json.load(open(CATALOG_FILE))["effects"]
    prompt_template = open(PROMPT_FILE).read()
    effects_block = build_effects_block(catalog)
    system_prompt = prompt_template.replace("{effects_block}", effects_block)

    overview = fetch_overview(song)
    overview["_song"] = song
    overview_text = format_overview(overview)

    client = Groq()
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": f"Compose a lighting show for this song.\n\n{overview_text}"},
    ]

    tool_calls_used = 0
    max_tool_calls = 20

    for attempt in range(max_retries + 1):
        kwargs = dict(
            model=model,
            messages=messages,
            max_tokens=3072,
            temperature=0.7,
        )
        if tool_calls_used < max_tool_calls:
            kwargs["tools"] = TOOL_DEFINITIONS
            kwargs["tool_choice"] = "auto"

        response = client.chat.completions.create(**kwargs)
        msg = response.choices[0].message

        # handle tool use loop
        while msg.tool_calls and tool_calls_used < max_tool_calls:
            messages.append(msg)

            for tc in msg.tool_calls:
                tool_calls_used += 1
                try:
                    args = json.loads(tc.function.arguments)
                except json.JSONDecodeError:
                    args = {}
                result = handle_tool_call(tc.function.name, args, overview)
                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": result,
                })

            kwargs2 = dict(
                model=model,
                messages=messages,
                max_tokens=3072,
                temperature=0.7,
            )
            if tool_calls_used < max_tool_calls:
                kwargs2["tools"] = TOOL_DEFINITIONS
                kwargs2["tool_choice"] = "auto"

            response = client.chat.completions.create(**kwargs2)
            msg = response.choices[0].message

        text = msg.content or ""

        try:
            plan = json.loads(text)
        except json.JSONDecodeError:
            start = text.find("{")
            end = text.rfind("}") + 1
            if start >= 0 and end > start:
                try:
                    plan = json.loads(text[start:end])
                except json.JSONDecodeError:
                    if attempt < max_retries:
                        messages.append({"role": "assistant", "content": text})
                        messages.append({"role": "user", "content": "Your response was not valid JSON. Please return only a JSON object with the shape specified."})
                        continue
                    raise ValueError("could not parse JSON from composer response")
            else:
                if attempt < max_retries:
                    messages.append({"role": "assistant", "content": text})
                    messages.append({"role": "user", "content": "Your response was not valid JSON. Please return only a JSON object with the shape specified."})
                    continue
                raise ValueError("could not parse JSON from composer response")

        # validate
        from validator import validate, format_report
        cleaned, report = validate(plan, catalog, overview)

        errors = [r for r in report if r["level"] == "error"]
        # the validator fills uncovered sections; if it had to fill (nearly) all of
        # them the model gave us essentially no states, which is worth one retry.
        n_sections = len(overview.get("sections") or [])
        n_filled = len([r for r in report if r.get("code") == "state_filled"])
        model_states = max(0, len(cleaned.get("states", [])) - n_filled)
        too_few_states = n_sections > 0 and model_states < max(1, n_sections // 2)

        if (errors or too_few_states) and attempt < max_retries:
            parts = []
            if errors:
                parts.append(f"Validation found {len(errors)} error(s):\n{format_report(errors)}")
            if too_few_states:
                parts.append(
                    f"You placed a resting state on only {model_states} of {n_sections} sections. "
                    f"Every section 0..{n_sections-1} MUST have exactly one state, or it renders as "
                    f"darkness. Add the missing section states (drone for quiet, wash for full) and "
                    f"return the corrected JSON.")
            messages.append({"role": "assistant", "content": text})
            messages.append({"role": "user", "content": "\n\n".join(parts)})
            continue

        return cleaned, report, overview

    raise RuntimeError("composer failed after retries")


# ── CLI ───────────────────────────────────────────────────────────────────────

def main():
    global HUB
    ap = argparse.ArgumentParser(description="Compose a lighting show for a song")
    ap.add_argument("song", help="Song name (e.g. raga-of-revenge)")
    ap.add_argument("--hub", default=HUB)
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--out", default=None, help="Output file (default: portal/work/<song>.plan.json)")
    args = ap.parse_args()
    HUB = args.hub.rstrip("/")

    print(f"composing show for '{args.song}' using {args.model} (Groq)...")
    plan, report, overview = compose(args.song, model=args.model)

    from validator import format_report
    print(format_report(report))
    print(f"\nplan: {plan.get('plan', '(none)')}")
    print(f"states:   {len(plan.get('states', []))}")
    print(f"bindings: {len(plan.get('bindings', []))}")
    print(f"gestures: {len(plan.get('gestures', []))}")

    out = args.out or os.path.join(HERE, "work", f"{args.song}.plan.json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w") as f:
        json.dump(plan, f, indent=1)
    print(f"\nwrote -> {out}")


if __name__ == "__main__":
    main()
