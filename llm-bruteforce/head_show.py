#!/usr/bin/env python3
"""Head show: the flower choreography for the moving head, on ITS OWN universe.

The head now lives on Art-Net universe 0 (node port 0); the RGB PAR stays on
universe 1 and is driven by flower_show.py from a separate process. This
script only ever addresses UNIVERSES (default [0]), so it cannot touch the PAR.

Cycle (loops forever):
  pass A  pan sweeps PAN_MIN -> PAN_MAX   single flower gobo, prism OFF
  pass B  pan sweeps PAN_MAX -> PAN_MIN   same gobo, prism ON (6 copies)
While pan sweeps, tilt rides a gentle half-sine (TILT_BASE -> +TILT_SWING ->
back) so the spot traces a curved arc. Colour wheel sits in slow rainbow spin.

Usage:  python3 head_show.py [universe[,universe...]] [off]      (default 0)
        e.g. "0,2,3" sends the same frame to several universes at once
        off = no show: hold the head dark (dim 0) and straight up (tilt 127),
              streaming steadily so it never falls back to its auto program

Every tunable lives in CONFIG. Parks dark-and-still on Ctrl-C / SIGTERM.
"""
import math, socket, struct, time, signal, sys

# ================= CONFIG =================
GATEWAY, BIND_IP, PORT = "2.0.0.100", "2.0.0.1", 6454
NET, HZ  = 0, 40
_args    = [a for a in sys.argv[1:] if a != "off"]
UNIVERSES = [int(u) for u in _args[0].split(",")] if _args else [0]   # head is on universe 0; PAR (universe 1) is NOT ours
OFF_MODE = "off" in sys.argv[1:]

HEAD = 4                                  # moving head start address (set on the head's display)
# channel offsets from HEAD (confirmed by live probing)
PAN, TILT, SPEED, DIM, STROBE, COLOR, GOBO, PRISM, MACRO = range(9)

PAN_MIN, PAN_MAX = 43, 213                # ~360 deg of pan per pass (assumes 540 deg travel)
TILT_BASE   = 100                         # off-vertical so pan makes the spot TRAVEL (127 = straight up = spin in place)
TILT_SWING  = 12                          # tilt wave amplitude during a pass (0 = flat arc)
SPEED_VAL   = 180                         # head smoothing; higher hides the 1-step moves on slow passes
DIM_VAL     = 30                          # "really low brightness" (~12%); 60 reads better for debugging
COLOR_SPIN  = 150                         # slow rainbow spin (confirmed)
GOBO_FLOWER = 80                          # flower (confirmed)
PRISM_OFF, PRISM_ON = 0, 100              # 100 = 6 copies (confirmed)
SWEEP_SECS  = 40                          # one pass ("really slow"); 8 for a quick legibility demo
BLINK_SECS  = 0                           # dark marker between passes; 0.25 is handy when debugging
OFF_PAN, OFF_TILT = 128, 127              # "off" pose: pan centred, beam straight up
# ==========================================

sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock.bind((BIND_IP, 0))
_seq = 0
_cur = {"pan": PAN_MIN, "tilt": TILT_BASE}   # last commanded position, so park() holds still


def send(f):
    global _seq
    _seq = (_seq % 255) + 1
    for uni in UNIVERSES:
        pkt = (b"Art-Net\x00" + struct.pack("<H", 0x5000) + struct.pack(">H", 14)
               + bytes([_seq, 0, uni & 0xFF, NET]) + struct.pack(">H", 512) + bytes(f))
        sock.sendto(pkt, (GATEWAY, PORT))


def frame(pan, tilt, prism, dim=DIM_VAL):
    """Full frame for the head's universe. Nothing but the head is patched here."""
    _cur["pan"], _cur["tilt"] = pan, tilt
    f = [0] * 512
    b = HEAD - 1
    f[b + PAN]    = int(round(pan))
    f[b + TILT]   = int(round(tilt))
    f[b + SPEED]  = SPEED_VAL
    f[b + DIM]    = dim
    f[b + STROBE] = 0
    f[b + COLOR]  = COLOR_SPIN
    f[b + GOBO]   = GOBO_FLOWER
    f[b + PRISM]  = prism
    f[b + MACRO]  = 0
    return f


def park(*_):
    # Beam off, prism out, HOLD position. Never send all-zeros: that commands
    # pan/tilt 0 at max speed and whips the head across the room.
    for _ in range(5):
        send(frame(_cur["pan"], _cur["tilt"], PRISM_OFF, dim=0)); time.sleep(0.02)
    print("\nhead parked dark, exiting.", flush=True)
    sys.exit(0)


signal.signal(signal.SIGTERM, park)
signal.signal(signal.SIGINT, park)


def smoothstep(t):
    return t * t * (3 - 2 * t)


def hold(pan, tilt, prism, dim, secs):
    for _ in range(int(secs * HZ)):
        send(frame(pan, tilt, prism, dim)); time.sleep(1.0 / HZ)


def sweep(start, end, prism, secs=SWEEP_SECS):
    steps = int(secs * HZ)
    for i in range(steps + 1):
        t = i / steps
        pan  = start + (end - start) * smoothstep(t)
        tilt = TILT_BASE + TILT_SWING * math.sin(math.pi * t)   # 0 -> +swing -> 0
        send(frame(pan, tilt, prism))
        time.sleep(1.0 / HZ)


if OFF_MODE:
    print(f"head OFF: universes {UNIVERSES} -> {GATEWAY}, head@{HEAD} held at dim=0 pan={OFF_PAN} tilt={OFF_TILT} (straight up)", flush=True)
    while True:
        hold(OFF_PAN, OFF_TILT, PRISM_OFF, 0, 1)

print(f"head show: universes {UNIVERSES} -> {GATEWAY}, head@{HEAD} | pan {PAN_MIN}<->{PAN_MAX} "
      f"tilt {TILT_BASE}+{TILT_SWING} {SWEEP_SECS}s/pass dim={DIM_VAL} color={COLOR_SPIN} "
      f"gobo={GOBO_FLOWER} prism={PRISM_OFF}/{PRISM_ON}", flush=True)

# settle: move to the start position with the beam dark (~2s)
hold(PAN_MIN, TILT_BASE, PRISM_OFF, 0, 2)

n = 0
while True:
    n += 1
    hold(PAN_MIN, TILT_BASE, PRISM_OFF, 0, BLINK_SECS)
    print(f"pass {n}A  ->  single flower", flush=True)
    sweep(PAN_MIN, PAN_MAX, PRISM_OFF)
    hold(PAN_MAX, TILT_BASE, PRISM_ON, 0, BLINK_SECS)
    print(f"pass {n}B  <-  prism on, 6 flowers", flush=True)
    sweep(PAN_MAX, PAN_MIN, PRISM_ON)
