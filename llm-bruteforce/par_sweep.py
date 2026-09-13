#!/usr/bin/env python3
"""Test sweep for the four 7-channel PARs on universe 0 (addresses 1, 8, 15, 22).

A bright pulse travels PAR1 -> PAR4 -> PAR1 (ping-pong), crossfading between
neighbours, while the colour rotates once through the spectrum every
hue_period seconds. Dimmer (+0) held at 255, strobe/program/speed (+4..+6) at 0.
Frames carry Length=28 (ch1-28 only).

Usage: par_sweep.py [step_s=0.5] [hue_period_s=12]     Ctrl-C / SIGTERM -> all 0.
"""
import colorsys, signal, sys, time
import os; sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "music_sync"))
from artnet import Sender

PARS = [1, 8, 15, 22]           # start address of each PAR (7-ch: dim R G B strobe prog speed)
N = 28
step = float(sys.argv[1]) if len(sys.argv) > 1 else 0.5
hue_period = float(sys.argv[2]) if len(sys.argv) > 2 else 12.0
s = Sender(universe=0)

def frame(levels, rgb):
    f = [0] * N
    for a, l in zip(PARS, levels):
        f[a - 1] = 255                                   # master dimmer
        for k, c in enumerate(rgb):
            f[a + k] = int(round(255 * c * l))           # R G B at +1 +2 +3
    return f

def bye(*_):
    for _ in range(5): s.send([0] * N); time.sleep(0.02)
    print("all channels 0, exiting", flush=True); sys.exit(0)
signal.signal(signal.SIGTERM, bye); signal.signal(signal.SIGINT, bye)

print(f"par_sweep: universe 0, PARs @{PARS}, step {step}s, hue period {hue_period}s", flush=True)
cycle = 6 * step                                         # 1 -> 4 -> 1 = 6 steps
t0 = time.time(); last = -1
while True:
    t = time.time() - t0
    ph = (t % cycle) / cycle
    p = 3 * (1 - abs(2 * ph - 1))                        # position 0..3..0
    levels = [max(0.0, 1 - abs(i - p)) for i in range(4)]
    rgb = colorsys.hsv_to_rgb((t / hue_period) % 1, 1, 1)
    at = int(round(p))
    if at != last:
        print(f"  -> PAR {at + 1} (@{PARS[at]})", flush=True); last = at
    try:
        s.send(frame(levels, rgb))
    except OSError as e:
        print(f"send failed: {e}", flush=True); time.sleep(1); continue
    time.sleep(1 / 40)
