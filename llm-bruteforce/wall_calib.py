#!/usr/bin/env python3
"""Wall calibration: the head pans left-right across a wall; as the modelled spot passes
each PAR's wall position, that PAR lights in the head's current colour.

Geometry (cm): fixtures on a 150 cm-radius arc, head at 0 deg, PARs @8/@15 at +-17 deg,
@1/@22 at +-32.5 deg. Wall WALL cm in front of the head. PAR spot lateral offset = chord
position of the PAR (150*sin(theta)); the spot from the head lands at WALL*tan(pan angle).

All tunables are key=val args (defaults in CAPS below). Every pass (one direction) steps to
the next colour-wheel slot; PAR colour is the GUESSED colour of that slot.
  tilt=40       head tilt DMX that puts the spot at PAR-spot height (127 = straight up)
  pan0=169      pan DMX facing the wall centre (verified)
  dpd=2.118     pan degrees per DMX step (540/255)
  wall=90       head-to-wall distance
  span=50       sweep half-angle in degrees
  period=6      seconds per pass (one direction)
  width=18      spot half-width on the wall (cm) for the PAR fade
  flip=0        1 = mirror PAR order if they light in reverse
  hdim=60       head dimmer     pgain=0.3   PAR brightness
  blank=0.8     seconds the head stays dark at each pass change while the colour wheel travels
Frames: 512 channels, universe 0. Ctrl-C/SIGTERM -> all 0 except head parked.
"""
import math, signal, sys, time
import os; sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "music_sync"))
from artnet import Sender

P = dict(blank=0.8, tilt=40, pan0=169, dpd=540 / 255, wall=90.0, span=50.0, period=6.0, width=18.0, flip=0, hdim=60, pgain=0.3)
for a in sys.argv[1:]:
    k, v = a.split("="); P[k] = float(v)
R = 150.0
PARS = [(1, -32.5), (8, -17.0), (15, 17.0), (22, 32.5)]        # (address, angle on the arc)
par_x = [R * math.sin(math.radians(th)) * (-1 if P["flip"] else 1) for _, th in PARS]

from rig import COLOURS
SLOTS = [(v, n, rgb) for n, v, rgb in COLOURS]   # verified wheel mapping (rig.py)

HEAD = 29
s = Sender(universe=0)

def frame(pan, colour_val, rgb, levels, hdim=None):
    f = [0] * 512
    for (a, _), lvl in zip(PARS, levels):
        f[a - 1] = 255
        for k in range(3): f[a + k] = int(round(255 * rgb[k] * lvl * P["pgain"]))
    h = HEAD - 1
    f[h] = int(round(pan)); f[h + 2] = int(P["tilt"]); f[h + 4] = 0
    f[h + 5] = int(P["hdim"] if hdim is None else hdim); f[h + 6] = 0; f[h + 7] = colour_val
    return f

def bye(*_):
    park = frame(P["pan0"], 0, (0, 0, 0), [0, 0, 0, 0]); park[HEAD - 1 + 5] = 0
    for _ in range(5): s.send(park); time.sleep(0.02)
    print("dark, head parked, exiting", flush=True); sys.exit(0)
signal.signal(signal.SIGTERM, bye); signal.signal(signal.SIGINT, bye)

span_dmx = P["span"] / P["dpd"]
print(f"wall_calib: {P}", flush=True)
print(f"  PAR wall x (cm): {[round(x) for x in par_x]}  sweep pan {P['pan0'] - span_dmx:.0f}..{P['pan0'] + span_dmx:.0f}", flush=True)
t0 = time.time(); last_pass = -1
while True:
    t = time.time() - t0
    npass = int(t // P["period"]); ph = (t % P["period"]) / P["period"]
    direction = 1 if npass % 2 == 0 else -1                       # even pass: left->right
    ang = -direction * P["span"] + direction * 2 * P["span"] * ph  # degrees, linear in time
    pan = P["pan0"] + ang / P["dpd"]
    x_spot = P["wall"] * math.tan(math.radians(ang))
    val, name, rgb = SLOTS[npass % len(SLOTS)]
    if npass != last_pass:
        print(f"  pass {npass}: {'L->R' if direction > 0 else 'R->L'}  colour slot {val} = {name}", flush=True); last_pass = npass
    levels = [math.exp(-0.5 * ((x_spot - x) / P["width"]) ** 2) for x in par_x]
    hdim = 0 if (t % P["period"]) < P["blank"] else None      # hide the wheel travelling
    try: s.send(frame(pan, val, rgb, levels, hdim))
    except OSError as e: print(f"send failed: {e}", flush=True); time.sleep(1); continue
    time.sleep(1 / 40)
