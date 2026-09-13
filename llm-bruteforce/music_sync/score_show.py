#!/usr/bin/env python3
"""Render a light show for the universe-0 rig from a hub score.

  score_show.py ../levels.score.json --wav ../levels.cache.wav            # auto bar shift, seed 1
  score_show.py ../levels.score.json --wav ../levels.cache.wav --seed 7 --save-plan ../levels.plan.json
  score_show.py ../levels.score.json --wav ../levels.cache.wav --plan ../levels.plan.json
  score_show.py --hub http://192.168.1.38:8770 --score levels --wav ../levels.cache.wav

Reads the score (sections, phrases, moments, per-bar lanes, chords), converts it to
seconds (measuring the whole-bar shift against the audio when a wav is given), builds
cues, draws effects from the library (effects.py) with a seeded random or takes them
from a saved plan, renders 41-channel frames and writes <name>.lights.json next to the
wav so the control panel (server.py) can play it. Nothing is sent to the rig here.
"""
import argparse
import json
import math
import os
import shutil
import sys
import urllib.request

import numpy as np

import rig
import concert
from effects import LIBRARY, Look
from score import Score, align_bar_shift
import arrange

HERE = os.path.dirname(os.path.abspath(__file__))
GAMMA = concert.GAMMA


def render(sc, cues, fps=40, activity=None):
    """41-channel frames for the cues. If `activity` is a dict it is filled with
    {event_name: [[from_s, to_s], ...]}: the spans in which that rule-fired event actually
    changed the frame (a strobe pop, a blackout beat), for the panel's library card."""
    n = int(math.ceil(sc.duration * fps))
    frames = np.zeros((n, 41), dtype=np.uint8)
    hs = concert.HeadState(fps)
    fired = {}                      # event name -> list of frame indices where it changed the look
    ci = 0
    for i in range(n):
        t = i / fps
        while ci < len(cues) - 1 and t >= cues[ci].to_s:
            ci += 1
        cue = cues[ci] if cues and cues[ci].contains(t) else arrange.cue_at(cues, t)
        look = Look()
        if cue is None:
            LIBRARY["dark_hold"].render(_gap(t, sc), sc, t, look)
            LIBRARY["park_fade"].render(_gap(t, sc), sc, t, look)
        else:
            LIBRARY[cue.par].render(cue, sc, t, look, cue.params)
            LIBRARY[cue.head].render(cue, sc, t, look, cue.params)
            for name in cue.events:
                before = _snapshot(look) if activity is not None else None
                LIBRARY[name].render(cue, sc, t, look, cue.params)
                if before is not None and _snapshot(look) != before:
                    fired.setdefault(name, []).append(i)
        f = [0] * 512
        for a, (col, lvl, strobe) in look.par.items():
            enc = tuple(max(0.0, min(1.0, c * lvl)) ** GAMMA for c in col)
            rig.set_par(f, a, enc, 1.0, 255)
            f[a - 1 + rig.PAR_STROBE] = int(max(0, min(255, strobe)))
        h = look.head
        pan, tilt = (hs.pan, hs.tilt) if (look.hold_head and hs.pan is not None) else (h["pan"], h["tilt"])
        st = hs.step(pan, tilt, max(0.0, min(1.0, h["dim"])), h["colour"], h["gobo"], h["prism"], h["strobe"])
        rig.set_head(f, st["pan"], st["tilt"], 255 * st["dim"], st["colour_val"], st["gobo"], st["prism"],
                     rig.SPEED_FAST, st["strobe"])
        frames[i] = f[:41]
    if activity is not None:
        for name, idx in fired.items():
            activity[name] = _spans(idx, fps)
    return frames


def _snapshot(look):
    return (tuple(sorted((a, tuple(round(c, 4) for c in col), round(l, 4), s) for a, (col, l, s) in look.par.items())),
            tuple(sorted((k, v if isinstance(v, str) else round(float(v), 4)) for k, v in look.head.items())),
            look.hold_head)


def _spans(frame_indices, fps, gap=1):
    """Merge consecutive frame indices (allowing `gap` missing frames) into [from_s, to_s] spans."""
    spans = []
    for i in frame_indices:
        if spans and i - spans[-1][1] <= gap + 1:
            spans[-1][1] = i
        else:
            spans.append([i, i])
    return [[round(a / fps, 3), round((b + 1) / fps, 3)] for a, b in spans]


def _gap(t, sc):
    return arrange.Cue(role="gap", from_s=t, to_s=t + sc.bar_s, from_bar=sc.bar_at(t), to_bar=sc.bar_at(t) + 1)


def lights_doc(sc, cues, frames, fps, wav, source, plan):
    beats, downs = sc.grid_beats()
    return {
        "rig": "universe0-4par-head",
        "style": "score",
        "source": source,
        "wav": wav,
        "fps": fps,
        "duration": sc.duration,
        "tempo": sc.bpm,
        "beats": beats,
        "downbeats": downs,
        "sections": [round(c.from_s, 4) for c in cues],
        "phases": [{"start": round(c.from_s, 4), "end": round(c.to_s, 4), "phase": c.role_key} for c in cues],
        "score_bar_shift": sc.bar_shift,
        "plan": plan,
        "frames": np.asarray(frames, dtype=int).tolist(),
    }


def fetch_score(hub, name):
    req = urllib.request.Request(hub.rstrip("/") + "/hub/score", data=json.dumps({"score": name}).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("score", nargs="?", help="path to a <name>.score.json (or omit and use --hub/--score)")
    ap.add_argument("--hub", help="hub base URL to fetch the score from, e.g. http://192.168.1.38:8770")
    ap.add_argument("--score", dest="score_name", help="score name on the hub (with --hub)")
    ap.add_argument("--wav", help="the song's audio (decoded wav); copied next to the output as <name>.cache.wav")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--plan", help="use the effects saved in this plan file instead of drawing them")
    ap.add_argument("--save-plan", help="write the drawn plan here (edit it, then pass it back with --plan)")
    ap.add_argument("--bar-shift", default="auto", help="whole bars added to every score bar: auto (measure against --wav), or -1/0/1")
    ap.add_argument("--out", help="output .lights.json (default: <name>.lights.json in the parent folder)")
    ap.add_argument("--fps", type=int, default=40)
    ap.add_argument("--dry", action="store_true", help="plan only, render nothing")
    args = ap.parse_args(argv)

    if args.hub:
        name = args.score_name or (os.path.basename(args.score).split(".")[0] if args.score else None)
        if not name:
            ap.error("--hub needs --score NAME")
        doc = fetch_score(args.hub, name)
        args.score = args.score or os.path.join(os.path.dirname(HERE), f"{name}.score.json")
        with open(args.score, "w") as fh:
            json.dump(doc, fh, indent=1)
        print(f"fetched score {name!r} -> {args.score}", flush=True)
    else:
        if not args.score:
            ap.error("give a score file or --hub/--score")
        with open(args.score) as fh:
            doc = json.load(fh)
    name = doc.get("score") or os.path.basename(args.score).split(".")[0]
    out_dir = os.path.dirname(os.path.abspath(args.out)) if args.out else os.path.dirname(HERE)
    out = args.out or os.path.join(out_dir, f"{name}.lights.json")

    shift_table = None
    if args.bar_shift == "auto":
        if args.wav and os.path.isfile(args.wav):
            shift, shift_table = align_bar_shift(doc, args.wav)
            print(f"bar shift measured against the audio: {shift:+d}  (dB agreement {shift_table})", flush=True)
        else:
            shift = 0
            print("no --wav to measure the bar shift against; assuming 0", flush=True)
    else:
        shift = int(args.bar_shift)
    sc = Score(doc, bar_shift=shift)

    cues = arrange.build_cues(sc)
    if args.plan:
        with open(args.plan) as fh:
            pdoc = json.load(fh)
        arrange.choose(cues, seed=int(pdoc.get("seed") or args.seed))
        arrange.apply_plan(cues, pdoc)
        seed = pdoc.get("seed")
    else:
        arrange.choose(cues, seed=args.seed)
        seed = args.seed
    plan = arrange.plan_doc(sc, cues, seed)
    for row in arrange.table(cues):
        print("  " + row, flush=True)
    if args.save_plan:
        with open(args.save_plan, "w") as fh:
            json.dump(plan, fh, indent=1)
        print(f"plan -> {args.save_plan}", flush=True)
    if args.dry:
        return

    wav_name = None
    if args.wav and os.path.isfile(args.wav):
        wav_name = f"{name}.cache.wav"
        dest = os.path.join(out_dir, wav_name)
        if os.path.abspath(dest) != os.path.abspath(args.wav):
            shutil.copyfile(args.wav, dest)
    activity = {}
    frames = render(sc, cues, fps=args.fps, activity=activity)
    plan["activity"] = activity
    with open(out, "w") as fh:
        json.dump(lights_doc(sc, cues, frames, args.fps, wav_name, f"{name} (hub score)", plan), fh)
    print(f"wrote {out} ({len(frames)} frames @ {args.fps} fps, {sc.duration:.1f} s)" + (f" + {wav_name}" if wav_name else ""), flush=True)


if __name__ == "__main__":
    main()
