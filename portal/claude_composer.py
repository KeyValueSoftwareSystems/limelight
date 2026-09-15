#!/usr/bin/env python3
import argparse
import json
import os
import re
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import composer as C
from validator import validate, format_report

WORK = os.path.join(HERE, "work")
DEFAULT_MODEL = "opus"
BUDGET = 24


def score_file(song):
    base = os.path.join(REPO, "hub", "files", "score")
    flat = os.path.join(base, song + ".score")
    if os.path.isfile(flat):
        return flat
    store = os.path.join(base, ".versions", song + ".score")
    try:
        ns = [int(x.split(".")[0]) for x in os.listdir(store)
              if x.endswith(".score") and x.split(".")[0].isdigit()]
    except OSError:
        return flat
    return os.path.join(store, "%d.score" % max(ns)) if ns else flat


def effect_behaviour(rig):
    try:
        out = subprocess.run(["node", os.path.join(HERE, "venues", "probe.js"), rig],
                             capture_output=True, text=True, timeout=120).stdout
    except Exception:
        return "  (could not measure the rig)"
    keep = [l for l in out.splitlines() if l.strip() and not l.startswith(rig)]
    return "\n".join("  " + l for l in keep)


def rig_facts(rig):
    at = os.path.join(HERE, "venues", rig, "manifest.json")
    lim = os.path.join(HERE, "limits.json")
    bits = []
    try:
        m = json.load(open(at))
        fx = m.get("fixtures") or {}
        bits.append(f"  {rig}: {fx.get('pars', '?')} PAR cans (RGB) and "
                    f"{fx.get('heads', '?')} moving head(s), {m.get('total_channels')} DMX channels.")
        if (fx.get("pars") or 0) <= 6:
            bits.append("  This is a SMALL rig. An extent that names half of it leaves the")
            bits.append("  other half dim, and effects that want many lamps - spectrum, chase -")
            bits.append("  have little room to read. Prefer whole-rig moves and colour.")
    except Exception:
        pass
    try:
        L = json.load(open(lim))
        mi = L.get("max_intensity") or {}
        bits.append(f"  Ceilings: pars {mi.get('par')}, head {mi.get('head')}.")
        for z in (L.get("keep_out") or []):
            bits.append(f"  KEEP OUT: the head may not throw light between "
                        f"{z.get('pan_from_deg')} and {z.get('pan_to_deg')} degrees "
                        f"({z.get('name')}). Aiming there blacks the head out.")
        st = L.get("strobe") or {}
        if not st.get("allowed", True):
            bits.append("  Strobe is FORBIDDEN in this venue; do not use strobing effects.")
    except Exception:
        pass
    return "\n".join(bits) or "  (rig unknown)"


def brief_for(song, overview, effects_block, hub, rig="arc4-head"):
    EFFECT_BEHAVIOUR = effect_behaviour(rig)
    RIG_FACTS = rig_facts(rig)
    ask = os.path.join(REPO, "portal", "ask.py")
    SCORE_AT = score_file(song)
    return "\n".join(
        [
            f"Compose the lighting show for `{song}`.",
            "",
            "THE SONG, AS MEASURED",
            "",
            C.format_overview(overview),
            "",
            "THE EFFECT CATALOG",
            "",
            effects_block,
            "",
            "ASKING THE SCORE FOR MORE",
            "",
            "The brief above is structure. Detail is a shell command away, and you",
            "are expected to use it - a show written from the summary alone is a show",
            f"that could have been written for any song. Budget about {BUDGET} calls.",
            "",
            f"    HUB_URL={hub} python3 {ask} {song} <question> [args]",
            "",
            "    lane harp 110 125            does the harp actually carry that span?",
            "    compare lead-vocal,back-vocal 22 39    do two voices alternate or overlap?",
            "    onsets 40 48                 how busy are the drums into the drop?",
            "    chords 48 82 / melody 48 82  what the harmony and the tune do",
            "    moment 16 / section 2        everything known about one of them",
            "",
            "THE SCORE ITSELF",
            "",
            "Nothing above is the whole file. The score is on disk and you may read it",
            "directly for anything these questions do not cover - every beat time, the",
            "per-bar emotion curves, the chord list, 39 instrument lanes at half-second",
            "resolution, the melody notes:",
            "",
            f"    {SCORE_AT}",
            "",
            "    jq '.emotion[] | {start, energy, brightness, groove, mode}' <file>",
            "    jq '.beats | length' <file>      jq '.stems_temporal.stems | keys' <file>",
            "",
            "Beats are measured, not computed from bpm, and this song may change tempo -",
            "so if you want the instant a bar lands, read the beat rather than multiplying.",
            "",
            "Spend them where a cue depends on the answer. Whether the harp earns its",
            "own lamp depends on the harp's lane; whether two vocals may trade places",
            "depends on comparing them. Do not ask about spans you will not light.",
            "",
            "WHAT THE SCORE MEANS",
            "",
            "Nothing in the file is a model's opinion; every field is measured.",
            "",
            "  moments    an instant worth answering. `intensity` is 0..1 WITHIN this",
            "             song, so 1.00 means the biggest of its kind here, not in music.",
            "             climax = the fullest passage, peak = the loudest stretch - they",
            "             are different claims and often different places.",
            "  sections   the song's form. The NAME is a pop-song label and may be wrong",
            "             for this music; the numbers under it are not. Never light a",
            "             section from its name alone - read what is playing in it.",
            "  emotion    energy / brightness / groove measured per bar, 0..10 WITHIN this",
            "             song, and mode -1 minor to +1 major. Scaled per song, so 7 is",
            "             mid here, not loud in absolute terms.",
            "  lanes      39 separated instruments at half-second resolution, each with",
            "             its dB in the mix. This is what the audience actually hears.",
            "  beats      measured beat times, not bpm arithmetic. On a song that changes",
            "             tempo the two disagree by over a second by the end.",
            "",
            "HOW THE LAMPS ACTUALLY BEHAVE",
            "",
            "Measured by rendering each effect on this rig and reading the DMX:",
            "",
            EFFECT_BEHAVIOUR,
            "",
            "  peak/floor are the rig's average level 0..1, swing is peak minus floor,",
            "  `lit` is how many of the lamps it touches. An effect with swing near zero",
            "  changes colour or place, not brightness.",
            "",
            "THE RIG YOU ARE WRITING FOR",
            "",
            RIG_FACTS,
            "",
            "DESIGNING LIKE A PERSON, NOT A LABEL",
            "",
            "  A section called `intro` is not automatically dark. On this song the",
            "  intro carries ten instruments including the loudest vocal in the track,",
            "  and a `drone` at 0.12 over it reads as a fault, not a choice. Set the",
            "  resting level from what is PLAYING - the instrument list above gives you",
            "  dB and coverage for every lane.",
            "  Contrast is the whole craft: if everything is at 0.8 nothing is bright,",
            "  and if everything is at 0.15 the rig looks broken. Give a song a floor",
            "  and a ceiling and spend the range.",
            "  A gesture is worth having only if the thing before it was different.",
            "  Hold a look; change it when the music changes, not on a timer.",
            "  DECLARE A PALETTE AND STAY IN IT. Start the plan with `palette`: three",
            "  to five colours, each with a name and a reason, and then every colour",
            "  anywhere in the show must be one of them:",
            "",
            '      "palette": [',
            '        {"name": "saffron", "rgb": [1, 0.72, 0.28],',
            '         "why": "the major mode this song lives in"},',
            '        {"name": "indigo",  "rgb": [0.3, 0.38, 0.85],',
            '         "why": "for the minor trench at moment 4"},',
            '        {"name": "white",   "rgb": [1, 1, 1], "why": "hits only"} ],',
            "",
            "  A show that invents a slightly different amber for every cue looks",
            "  random, because it is - the last one used thirteen colours of which",
            "  eight were the same orange a few degrees apart. Two or three colours",
            "  used with discipline read as a decision. Anything you write that is not",
            "  in the palette is snapped to the nearest entry, so choose the palette",
            "  deliberately and then spend it.",
            "",
            "  Colour carries meaning here: mode below zero is minor, above is major,",
            "  and brightness is a measured timbre, not a mood word. Tie palette",
            "  entries to those measurements in their `why`.",
            "",
            "  EVERY SECTION NEEDS SOMETHING CONTINUOUS OVER IT. A state is a still",
            "  frame held for the whole section - on its own the rig does not move for",
            "  thirty seconds and an audience reads it as broken. A BINDING is what",
            "  makes the rig answer the music second by second, and it is the only",
            "  thing that does. Three exist and all are measured, not guessed:",
            "",
            "    follow  <stream>            level rides that instrument's envelope",
            "    accent  threshold=<0..1>    flashes ABOVE a bed on drum onsets",
            "    split   <streamA>,<streamB> two halves of the rig trade on two lanes",
            "",
            "  THE RIG MUST NEVER SIT STILL FOR LONG. In a real show nothing holds a",
            "  frame for ten seconds. A `follow` on a voice or a string pad moves",
            "  smoothly and will not, on its own, make a rig look alive - it needs",
            "  something percussive layered with it. `accent` is that: it rides the",
            "  measured onset envelope, which peaks near 0.45 on this song, so a",
            "  threshold around 0.10 fires on roughly a third of the track and a",
            "  threshold above 0.2 never fires at all.",
            "",
            "  Bindings LAYER. A section may carry several and they combine, so the",
            "  designer's normal move is available: the wash follows the voice while",
            "  the pars answer the kick. One binding per section is a thin section.",
            "",
            "  Bind every section to a stream that actually carries it - the instrument",
            "  list gives you dB and coverage, and `compare` tells you whether two",
            "  lanes alternate. A section may be left still only if you say why in its",
            "  `why`, and stillness must be the exception.",
            "  Nothing downstream will add movement for you. If the plan does not ask",
            "  for it, the rig holds a frame - and a person opening this show in the",
            "  editor must be able to see and change every reason it moves.",
            "",
            "  USE THE WHOLE VOCABULARY. There are 34 effects across four dimensions,",
            "  and a show built from wash, drone and impact is three of them. Brightness",
            "  is the least interesting thing a rig does; an audience reads colour and",
            "  movement first. A song of any length wants several colour moves and",
            "  several place moves, not one of each. If you reach for the same effect",
            "  twice, ask whether the second one wanted a different dimension.",
            "  What you must NOT do is decorate: every cue still answers something",
            "  measured. Variety in HOW you answer, never in WHETHER there is anything",
            "  to answer.",
            "",
            "WHAT TO WRITE",
            "",
            "Write your show to `plan.json` in the working directory, as one JSON",
            "object with `plan`, `states`, `bindings` and `gestures`, exactly the shape",
            "the system prompt describes. Nothing else goes in that file.",
            "",
            "Every section index 0..N-1 needs exactly one state or it renders as",
            "darkness on the rig. Anchor every gesture to a moment, section or span",
            "that the brief already numbered - never compute a bar yourself.",
            "",
            "Then reply with one short paragraph on what you decided and why. The file",
            "is the deliverable; the reply is for the person reading the log.",
        ]
    )


def run_claude(work, brief, system_prompt, model, turns):
    cmd = [
        "claude",
        "-p",
        brief,
        "--append-system-prompt",
        system_prompt,
        "--allowed-tools",
        "Bash",
        "Read",
        "Write",
        "--permission-mode",
        "acceptEdits",
        "--max-turns",
        str(turns),
        "--model",
        model,
    ]
    r = subprocess.run(
        cmd,
        cwd=work,
        capture_output=True,
        text=True,
        timeout=1800,
        stdin=subprocess.DEVNULL,
    )
    return r.returncode, (r.stdout or "").strip(), (r.stderr or "").strip()


def read_plan(work):
    at = os.path.join(work, "plan.json")
    if os.path.isfile(at):
        with open(at) as f:
            return json.load(f)
    return None


def compose(song, model=None, hub=None, turns=60, keep=False):
    model = model or DEFAULT_MODEL
    if hub:
        C.HUB = hub.rstrip("/")
    hub = C.HUB

    catalog = json.load(open(C.CATALOG_FILE))["effects"]
    system_prompt = (
        open(C.PROMPT_FILE)
        .read()
        .replace("{effects_block}", C.build_effects_block(catalog))
    )
    overview = C.fetch_overview(song)

    work = os.path.join(WORK, f"{song}.claude")
    if os.path.isdir(work) and not keep:
        shutil.rmtree(work)
    os.makedirs(work, exist_ok=True)

    brief = brief_for(song, overview, C.build_effects_block(catalog), hub)
    with open(os.path.join(work, "brief.md"), "w") as f:
        f.write(brief)

    code, out, err = run_claude(work, brief, system_prompt, model, turns)
    plan = read_plan(work)
    if plan is None:
        block = re.search(r"\{[\s\S]*\}", out or "")
        if block:
            try:
                plan = json.loads(block.group(0))
            except json.JSONDecodeError:
                plan = None
    if plan is None:
        raise RuntimeError(
            f"the composer wrote no plan.json (exit {code})\n"
            f"--- stdout ---\n{out[-1500:]}\n--- stderr ---\n{err[-800:]}"
        )

    cleaned, report = validate(plan, catalog, overview)
    return cleaned, report, overview, out, work


def main():
    ap = argparse.ArgumentParser(description="Compose a lighting show with Claude")
    ap.add_argument("song")
    ap.add_argument("--hub", default=C.HUB)
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--turns", type=int, default=60)
    ap.add_argument("--out", default=None)
    ap.add_argument("--keep", action="store_true")
    args = ap.parse_args()

    print(f"composing '{args.song}' with claude ({args.model})...", flush=True)
    plan, report, overview, said, work = compose(
        args.song, model=args.model, hub=args.hub, turns=args.turns, keep=args.keep
    )

    print(format_report(report))
    print(f"\nplan: {plan.get('plan', '(none)')}")
    print(
        f"states:   {len(plan.get('states', []))} of {len(overview.get('sections') or [])} sections"
    )
    print(f"bindings: {len(plan.get('bindings', []))}")
    print(f"gestures: {len(plan.get('gestures', []))}")
    if said:
        print(f"\nthe composer says:\n{said[-1200:]}")

    out = args.out or os.path.join(WORK, f"{args.song}.plan.json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w") as f:
        json.dump(plan, f, indent=1)
    print(f"\nwrote -> {out}\nworkings in {work}")


if __name__ == "__main__":
    main()
