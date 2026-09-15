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
                    "per_beat", "caption", "emotions", "streams", "lanes"],
        "curves": ["energy"],
    })
    return data


def format_overview(data):
    """Format the score overview into a compact string for the LLM."""
    lines = []

    cap = data.get("caption") or data.get("song", {}).get("title", "untitled")
    lines.append(f"SONG: {cap}")

    g = data.get("grid") or {}
    lines.append(f"TEMPO: {g.get('bpm', '?')} bpm, {g.get('beats_per_bar', 4)}/4, {g.get('bars', '?')} bars")

    k = data.get("key") or {}
    if k:
        lines.append(f"KEY: {k.get('name', '?')} (root={k.get('root', '?')}, hue={k.get('hue', '?')})")

    sections = data.get("sections") or []
    lines.append(f"\nSECTIONS ({len(sections)}):")
    for i, s in enumerate(sections):
        name = s.get("name", "unnamed")
        fr = s.get("from", {})
        to = s.get("to", {})
        lines.append(f"  [{i}] {name}: bar {fr.get('bar', '?')} → {to.get('bar', '?')}")

    moments = data.get("moments") or []
    lines.append(f"\nMOMENTS ({len(moments)}):")
    for i, m in enumerate(moments):
        at = m.get("at", {})
        lines.append(
            f"  [{i}] bar {at.get('bar', '?')} beat {at.get('beat', '?')} "
            f"t={m.get('time_s', '?')}s type={m.get('type', '?')} "
            f"intensity={m.get('intensity', '?')} — {m.get('description', '')}"
        )

    emotions = data.get("emotions") or []
    if emotions:
        lines.append(f"\nEMOTION SPANS ({len(emotions)}):")
        for i, e in enumerate(emotions):
            lines.append(f"  [{i}] {e.get('from_s', '?')}s–{e.get('to_s', '?')}s: {e.get('text', '')}")

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


def handle_tool_call(name, args, overview):
    """Handle a tool call from the LLM by forwarding to the hub or reading the overview."""
    sections = overview.get("sections") or []
    moments = overview.get("moments") or []

    if name == "moment":
        idx = args.get("index", 0)
        if 0 <= idx < len(moments):
            return json.dumps(moments[idx])
        return json.dumps({"error": f"moment {idx} out of range (0..{len(moments)-1})"})

    if name == "section":
        idx = args.get("index", 0)
        if 0 <= idx < len(sections):
            return json.dumps(sections[idx])
        return json.dumps({"error": f"section {idx} out of range"})

    if name == "lane":
        try:
            data = hub_score({
                "score": overview["_song"],
                "fields": ["per_beat"],
                "lane": args.get("name"),
                "from_s": args.get("from_s", 0),
                "to_s": args.get("to_s", 300),
            })
            lane_data = data.get("per_beat", {}).get(args.get("name"), {})
            if not lane_data:
                return json.dumps({"summary": f"lane '{args.get('name')}' returned no data in range"})
            return json.dumps({"lane": args.get("name"), "data": lane_data})
        except Exception as e:
            return json.dumps({"summary": f"lane '{args.get('name')}': {e}"})

    if name == "onsets":
        try:
            data = hub_score({
                "score": overview["_song"],
                "fields": ["onsets"],
                "from_bar": args.get("from_bar", 1),
                "to_bar": args.get("to_bar", 999),
                "threshold": args.get("threshold", 0.5),
            })
            return json.dumps(data.get("onsets", {"summary": "no onset data"}))
        except Exception as e:
            return json.dumps({"summary": f"onsets: {e}"})

    if name == "compare":
        return json.dumps({
            "summary": f"compare {args.get('streams', [])} over bars {args.get('from_bar')}-{args.get('to_bar')}: "
                       f"data requires hub lane analysis (forwarded as-is)"
        })

    if name == "chords":
        try:
            data = hub_score({
                "score": overview["_song"],
                "fields": ["chords"],
                "from_s": args.get("from_s", 0),
                "to_s": args.get("to_s", 300),
            })
            return json.dumps(data.get("chords", {"summary": "no chord data"}))
        except Exception as e:
            return json.dumps({"summary": f"chords: {e}"})

    if name == "melody":
        try:
            data = hub_score({
                "score": overview["_song"],
                "fields": ["melody"],
                "from_s": args.get("from_s", 0),
                "to_s": args.get("to_s", 300),
            })
            return json.dumps(data.get("melody", {"summary": "no melody data"}))
        except Exception as e:
            return json.dumps({"summary": f"melody: {e}"})

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
            max_tokens=8192,
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
                max_tokens=8192,
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
