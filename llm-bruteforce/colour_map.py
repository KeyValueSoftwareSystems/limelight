#!/usr/bin/env python3
"""Colour-wheel mapping run for the head @29 (13-ch mode).

Head sits still (pan PAN0, tilt TILT, dimmer HDIM) and steps its colour-wheel value
0, 8, 16, ... 120 (16 steps, STEP_S seconds each), looping. The PARs act as a metronome:
a short white blink on every step, a double blink at the start of the cycle (value 0).
Read the colours aloud/typed in order, one per step.
  python colour_map.py [pan0=169] [tilt=40] [hdim=60] [step_s=3] [pgain=0.3] [marker=1 (PAR address used as blinker)] [lo=0] [hi=127] [inc=8]
"""
import signal, sys, time
import os; sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "music_sync"))
from artnet import Sender

P = dict(pan0=169, tilt=40, hdim=60, step_s=3.0, pgain=0.3, lo=0, hi=127, inc=8, marker=1)
for a in sys.argv[1:]:
    k, v = a.split("="); P[k] = float(v)
VALUES = list(range(int(P["lo"]), int(P["hi"]) + 1, int(P["inc"])))
PARS = [1, 8, 15, 22]; HEAD = 29
s = Sender(universe=0)

def frame(colour_val, par_level):
    f = [0] * 512
    for a in PARS:
        f[a - 1] = 255
        if a == int(P["marker"]):
            for k in range(3): f[a + k] = int(round(255 * par_level * P["pgain"]))
    h = HEAD - 1
    f[h] = int(P["pan0"]); f[h + 2] = int(P["tilt"]); f[h + 5] = int(P["hdim"]); f[h + 7] = int(colour_val)
    return f

def bye(*_):
    park = frame(0, 0); park[HEAD - 1 + 5] = 0
    for _ in range(5): s.send(park); time.sleep(0.02)
    print("dark, head parked, exiting", flush=True); sys.exit(0)
signal.signal(signal.SIGTERM, bye); signal.signal(signal.SIGINT, bye)

print(f"colour_map: {len(VALUES)} steps {VALUES}, {P['step_s']} s each, cycle {len(VALUES) * P['step_s']:.0f} s", flush=True)
t0 = time.time(); last = -1
while True:
    t = time.time() - t0
    i = int(t // P["step_s"]) % len(VALUES); ph = t % P["step_s"]
    if i != last:
        print(f"  step {i + 1:2d}: colour value {VALUES[i]}", flush=True); last = i
    blink = 1.0 if ph < 0.25 or (i == 0 and 0.5 < ph < 0.75) else 0.0
    try: s.send(frame(VALUES[i], blink))
    except OSError as e: print(f"send failed: {e}", flush=True); time.sleep(1); continue
    time.sleep(1 / 40)
