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


def brief_for(song, overview, effects_block, hub):
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
