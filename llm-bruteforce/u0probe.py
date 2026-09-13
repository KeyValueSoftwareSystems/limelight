#!/usr/bin/env python3
"""Universe-0 live probe / hold tool for the 2026-09-12 rig (Art-Net -> 2.0.0.100).

  u0probe.py osc  CH LO HI PERIOD [opts...]   triangle LO->HI->LO on CH
  u0probe.py hold [opts...]
opts:  ch=val            hold a channel
       ch~lo~hi~period   extra oscillator (triangle)
       pars=STEP         layer the PAR test sweep (ping-pong pulse, rotating hue) on PARs @1 @8 @15 @22
       pargain=0..1      brightness of that PAR layer
       512=0             force full 512-channel frames
Ctrl-C / SIGTERM -> every channel 0, exit.  One sender per universe: stop other senders first.

Rig: 4 PARs, 7-ch mode @1 @8 @15 @22 (+0 dim +1 R +2 G +3 B +4 strobe +5 program +6 speed; keep +5/+6 at 0)
     moving head, 13-ch mode @29: 29 pan 30 pan-fine 31 tilt 32 tilt-fine 33 p/t speed (0 fast..255 slow)
     34 dimmer 35 strobe (0 open) 36 colour 37 gobo (80 flower) 38 prism (100 = 6 copies) 39 MOVEMENT MACRO keep 0
     40 no visible effect keep 0  41 RESET keep 0
"""
import signal, sys, time
import os; sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "music_sync"))
from artnet import Sender

PARK = {}   # head park removed 2026-09-12 (head moving to @29); pass it explicitly if needed
args = sys.argv[1:]; mode = args[0] if args else "hold"
holds = dict(PARK); oscs = {}; par_step = None; par_gain = 1.0
import colorsys
PARS = [1, 8, 15, 22]
def parse(items):
    global par_step, par_gain
    for it in items:
        if it.startswith("pars="):
            par_step = float(it[5:]); continue
        if it.startswith("pargain="):
            par_gain = float(it[8:]); continue
        if "~" in it:
            c, lo, hi, per = it.split("~"); oscs[int(c)] = (int(lo), int(hi), float(per)); continue
        c, v = it.split("="); holds[int(c)] = int(v)
if mode == "osc":
    ch, lo, hi, period = int(args[1]), int(args[2]), int(args[3]), float(args[4]); parse(args[5:])
else:
    ch = None; parse(args[1:])
n = max([22, 28 if par_step else 0, ch or 0] + list(holds) + list(oscs)); n += n % 2
s = Sender(universe=0)
def frame(val=None):
    f = [0] * n
    if par_step:
        cyc = 6 * par_step; ph = ((time.time() - t0) % cyc) / cyc; pos = 3 * (1 - abs(2 * ph - 1))
        rgb = colorsys.hsv_to_rgb(((time.time() - t0) / 12.0) % 1, 1, 1)
        for i, a in enumerate(PARS):
            lvl = max(0.0, 1 - abs(i - pos)); f[a - 1] = 255
            for k, c in enumerate(rgb): f[a + k] = int(round(255 * c * lvl * par_gain))
    for c, v in holds.items(): f[c - 1] = v
    if ch and val is not None: f[ch - 1] = val
    for c, (lo, hi, per) in oscs.items():
        ph = ((time.time() - t0) % per) / per
        f[c - 1] = int(round(lo + (hi - lo) * (1 - abs(2 * ph - 1))))
    return f
def bye(*_):
    holds.clear(); oscs.clear()
    for _ in range(5): s.send(frame()); time.sleep(0.02)
    print("all channels 0, exiting", flush=True); sys.exit(0)
signal.signal(signal.SIGTERM, bye); signal.signal(signal.SIGINT, bye)
t0 = time.time()
print(f"universe 0, Length={n}, mode={mode}, ch={ch}, holds={holds}, oscs={oscs}", flush=True)
while True:
    val = None
    if ch:
        ph = ((time.time() - t0) % period) / period
        val = int(round(lo + (hi - lo) * (1 - abs(2 * ph - 1))))
    try: s.send(frame(val))
    except OSError as e: print(f"send failed: {e}", flush=True); time.sleep(1); continue
    time.sleep(1 / 40)
