#!/usr/bin/env python3
"""Enumerate a lighting-sequence palette with an LLM, grounded in a rig's layout.

This is the LLM half of enumeration: the model proposes many diverse sequences and
their per-context suitability scores; preflight.js then VALIDATES each against the
rig's real capabilities (only supported caps/groups, safe, in range) and merges the
survivors with the heuristic base. Generation runs ONCE per layout and is cached to
<layout>.palette.json; the runtime arranger reads the cache and is fully
deterministic -- no LLM at play time.

    pip install anthropic
    export ANTHROPIC_API_KEY=...        # or `ant auth login`
    python3 readers/lights/generate.py [readers/lights/arc4-head.layout.json] [--n 100]

Model defaults to claude-sonnet-5 (enough for structured palette generation); pass
--model to override. Output: <layout>.palette.json (a JSON array of sequences).
"""
import argparse, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
CONTEXTS = ["intro", "verse", "break", "build", "drop", "outro", "silence", "final_drop"]


def rig_facts(layout):
    """Capabilities and groups present, derived from the layout + driver profiles."""
    prof_dir = os.path.join(HERE, "drivers", "profiles")
    profiles = {}
    for f in layout["fixtures"]:
        t = f["type"]
        if t not in profiles:
            profiles[t] = json.load(open(os.path.join(prof_dir, f"{t}.profile.json")))
    caps, pars, movers, strobers = set(), 0, 0, 0
    for f in layout["fixtures"]:
        can = profiles[f["type"]]["can"]
        caps.update(can)
        if "colour" in can and "level" in can and "move" not in can:
            pars += 1
        if "move" in can:
            movers += 1
        if "strobe" in can:
            strobers += 1
    groups = []
    if pars:
        groups += ["all_pars", "arc"]
    if pars >= 2:
        groups += ["inner", "outer"]
    if movers:
        groups.append("head")
    if strobers:
        groups.append("strobers")
    return sorted(caps), groups, {"pars": pars, "movers": movers}


SEQUENCE_SCHEMA = {
    "type": "object",
    "properties": {
        "sequences": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "kind": {"enum": ["individual", "compound", "combination"]},
                    "boldness": {"enum": ["ambient", "accent", "hero"]},
                    "description": {"type": "string"},
                    "requires": {
                        "type": "object",
                        "properties": {
                            "groups": {"type": "array", "items": {"type": "string"}},
                            "caps": {"type": "array", "items": {"type": "string"}},
                        },
                        "required": ["groups", "caps"],
                    },
                    "occupies": {"type": "array", "items": {"type": "string"}},
                    "gesture": {"type": "object"},
                    "suitability": {
                        "type": "object",
                        "properties": {c: {"type": "number"} for c in CONTEXTS},
                        "required": CONTEXTS,
                    },
                },
                "required": ["id", "kind", "boldness", "requires", "occupies", "suitability"],
            },
        }
    },
    "required": ["sequences"],
}


def prompt(caps, groups, n):
    return f"""Generate {n} DISTINCT lighting SEQUENCES for a specific rig, as taste-graded data.

Capabilities present (use ONLY these): {", ".join(caps)}.
Groups you may target: {", ".join(groups)}.
PARs: RGB colour + level + strobe on a ~65 deg arc (inner = 2 nearest centre, outer =
2 outermost, arc = all 4 left-to-right for chases). Head: a MECHANICAL colour WHEEL
(white/red/yellow/blue/green/pink/orange/light blue -- step adjacent slots or change on
a dark beat), level, smooth pan/tilt (0..1, slew-limited downstream), gobo, prism, spin.
Never reference raw DMX channels -- only intents: colour, level, strobe, pan, tilt,
gobo, prism, spin.

Contexts to score (0..1 each), by meaning: intro (ambient, low), verse (groove),
break (space, hard hits from dark), build (rising tension -> escalate), drop (climax,
boldest), outro (winding down), silence (RESTRAINT -- hero effects score 0),
final_drop (the LAST drop -- your boldest sequences score highest here).

Taste on THIS small rig: symmetric inner/outer alternation reads STRONG; 4-lamp chases
read MODEST; the head is the hero motion + independent colour voice; contrast gestures
need a dark floor; ambient gestures own intro/outro/silence. Score honestly.

Cover breadth: colour washes/holds in many palettes, pair call-and-response, mirrored
pairs, chases/pulses, hard hits, strobe pops/bursts, whitening ramps, breathe, pre-drop
blackouts, and MANY head gestures (sweeps, figure-8, spiral, tilt-kick, corner-snap,
roam, colour-step, colour-spin, gobo cycle, prism fan). Include COMPOUND sequences
(scripted arcs) and COMBINATION sequences (concurrent layers whose occupies do not
collide). requires.caps must be a subset of the capabilities above; combination
occupies must have no duplicate token; every suitability value in 0..1; ids unique."""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("layout", nargs="?", default=os.path.join(HERE, "arc4-head.layout.json"))
    ap.add_argument("--n", type=int, default=100)
    ap.add_argument("--model", default="claude-sonnet-5")
    args = ap.parse_args()

    try:
        import anthropic
    except ImportError:
        sys.exit("anthropic SDK not installed: pip install anthropic")

    layout = json.load(open(args.layout))
    caps, groups, counts = rig_facts(layout)
    print(f"rig {layout.get('rig')}: caps={caps} groups={groups} ({counts})")

    try:
        client = anthropic.Anthropic()
    except Exception as e:
        sys.exit(f"no Anthropic credentials ({e}); set ANTHROPIC_API_KEY or run `ant auth login`")

    # Stream: the palette is a large structured output.
    with client.messages.stream(
        model=args.model,
        max_tokens=64000,
        thinking={"type": "adaptive"},
        output_config={"format": {"type": "json_schema", "schema": SEQUENCE_SCHEMA}},
        messages=[{"role": "user", "content": prompt(caps, groups, args.n)}],
    ) as stream:
        msg = stream.get_final_message()

    text = "".join(b.text for b in msg.content if b.type == "text")
    data = json.loads(text)
    seqs = data["sequences"]

    base = os.path.basename(args.layout).replace(".layout.json", "").replace(".json", "")
    out = os.path.join(os.path.dirname(args.layout), base + ".palette.json")
    json.dump(seqs, open(out, "w"), indent=1)
    print(f"wrote {len(seqs)} sequences -> {os.path.relpath(out, HERE)}")
    print("now run: node readers/lights/preflight.js  (validates + merges + caches the matrix)")


if __name__ == "__main__":
    main()
