#!/usr/bin/env python3
"""Best-guess light show for Alan Walker - "Faded" (90 BPM, 3:32), no audio.

Sections laid on the 8-bar grid at 90 BPM (bar = 2.667 s):
  intro 0:00  verse1 0:11  build1 0:32  DROP1 0:53  verse2 1:15  build2 1:36  DROP2 1:57
  anthem ("where are you now") 2:19  build3 2:40  DROP3 2:51  outro 3:12 - 3:32

  faded_show.py                  render + play live (universe 0), gain 0.35
  faded_show.py --gain 0.6 --start 50   start 50 s in (just before drop 1)
  faded_show.py --render-only    just write "Faded (guess).lights.json" next to this file
Ctrl-C -> PARs dark, head parked (pan centre, tilt up, dimmer 0), exit.
"""
import argparse, json, math, os, signal, sys, time

import numpy as np

import rig
from artnet import Sender
from concert import Timeline, render, park_frame

BPM = 90.0
BAR = 4 * 60.0 / BPM
HERE = os.path.dirname(os.path.abspath(__file__))


def faded_timeline():
    b = lambda n: n * BAR
    sections = [                      # (bars, phase)
        (4, "intro"), (8, "verse"), (8, "build"), (8, "drop"),
        (8, "verse"), (8, "build"), (8, "drop"),
        (8, "anthem"), (4, "build"), (8, "drop"),
        (7.5, "outro"),
    ]
    phases, t = [], 0.0
    for bars, name in sections:
        phases.append({"start": t, "end": t + b(bars), "phase": name}); t += b(bars)
    return Timeline(BPM, phases)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--gain", type=float, default=0.35, help="intensity scale for PAR colours and head dimmer")
    ap.add_argument("--start", type=float, default=0.0, help="seconds into the show")
    ap.add_argument("--fps", type=int, default=40)
    ap.add_argument("--render-only", action="store_true")
    ap.add_argument("--no-net", action="store_true")
    ap.add_argument("--gateway", default="2.0.0.100")
    args = ap.parse_args(argv)

    tl = faded_timeline()
    frames, meta = render(tl, fps=args.fps)
    out = os.path.join(HERE, "Faded (guess).lights.json")
    with open(out, "w") as fh:
        json.dump({"source": "Alan Walker - Faded (structure guess, no audio)", "wav": None, "style": "concert",
                   "fps": args.fps, "duration": meta["duration"], "tempo": BPM, "rig": "universe0-4par-head",
                   "beats": [round(i * 60.0 / BPM, 4) for i in range(int(meta["duration"] * BPM / 60))],
                   "downbeats": [round(i * BAR, 4) for i in range(int(meta["duration"] / BAR))],
                   "sections": [p["start"] for p in meta["phases"]], "phases": meta["phases"],
                   "frames": frames.tolist()}, fh)
    print(f"rendered {len(frames)} frames ({meta['duration']:.0f} s) -> {out}", flush=True)
    for p in meta["phases"]:
        print(f"  {int(p['start'] // 60)}:{p['start'] % 60:05.2f}  {p['phase']}", flush=True)
    if args.render_only:
        return

    mask = np.asarray(rig.intensity_mask(), dtype=bool)
    scaled = frames.astype(float)
    scaled[:, mask] *= args.gain
    scaled = np.clip(np.round(scaled), 0, 255).astype(np.uint8)

    class Null:
        def send(self, v): pass
        def blackout(self, **k): pass
    sender = Null() if args.no_net else Sender(gateway=args.gateway, universe=rig.UNIVERSE, pad_to=512)

    def bye(*_):
        sender.blackout(pause=0.02, frame=park_frame())
        print("\nPARs dark, head parked, exiting", flush=True); sys.exit(0)
    signal.signal(signal.SIGINT, bye); signal.signal(signal.SIGTERM, bye)

    print(f"playing from {args.start:.1f} s at gain {args.gain} -> {'NO NET' if args.no_net else args.gateway}", flush=True)
    t0 = time.monotonic() - args.start
    last_phase = None
    while True:
        t = time.monotonic() - t0
        i = int(t * args.fps)
        if i >= len(scaled):
            break
        ph = tl.phase_at(t)
        name = ph.name if ph else "end"
        if name != last_phase:
            print(f"  {int(t // 60)}:{t % 60:05.2f}  -> {name}", flush=True); last_phase = name
        try:
            sender.send(scaled[i])
        except OSError as e:
            print(f"send failed: {e}", flush=True); time.sleep(1); t0 += 1; continue
        time.sleep(max(0.0, (i + 1) / args.fps - (time.monotonic() - t0)))
    bye()


if __name__ == "__main__":
    main()
