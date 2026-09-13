#!/usr/bin/env python3
"""Flower show: repeating gobo choreography for the moving head.

Cycle (loops forever, ~17s at the defaults):
  blink   quarter-second dark = "new phase" marker
  pass A  pan sweeps PAN_MIN -> PAN_MAX   single flower gobo, prism OFF
  blink
  pass B  pan sweeps PAN_MAX -> PAN_MIN   same gobo, prism ON (6 copies)

Compound move: while pan sweeps, tilt rides a gentle half-sine wave
(TILT_BASE -> +TILT_SWING -> back), so the spot traces a curved arc across
the ceiling rather than a flat line. TILT_BASE is set off-vertical on
purpose: with the beam straight up (127) pan only spins the pattern in place.

Colour wheel sits in its slow rainbow-spin range the whole time.

PAR layer: the 3-ch RGB PAR at PAR_ADDR shares this universe, so it is
composited into the same frames (two senders on one universe would fight).
It cross-fades R->G->B->R on its own wall-clock, independent of head phases.

Every tunable lives in CONFIG. Parks dark-and-still on Ctrl-C / SIGTERM.
"""
import math, socket, struct, time, signal, sys

# ================= CONFIG =================
GATEWAY, BIND_IP, PORT = "2.0.0.100", "2.0.0.1", 6454
NET, SUBUNI, HZ        = 0, 1, 40

HEAD = 4                                  # moving head start address
# channel offsets from HEAD (confirmed by live probing)
PAN, TILT, SPEED, DIM, STROBE, COLOR, GOBO, PRISM, MACRO = range(9)

PAN_MIN, PAN_MAX = 43, 213                # ~360 deg of pan per pass (assumes 540 deg travel)
TILT_BASE   = 100                         # off-vertical so pan makes the spot TRAVEL (127 = straight up = spin in place)
TILT_SWING  = 12                          # tilt wave amplitude during a pass (0 = flat arc)
SPEED_VAL   = 180                         # head smoothing; higher hides the 1-step moves on slow passes (use ~60 for fast demos)
DIM_VAL     = 30                          # "really low brightness" (~12%); 60 reads better for debugging
COLOR_SPIN  = 150                         # slow rainbow spin (confirmed)
GOBO_FLOWER = 80                          # flower (confirmed)
PRISM_OFF, PRISM_ON = 0, 100              # 100 = 6 copies (confirmed)
SWEEP_SECS  = 40                          # one pass ("really slow"); 8 for a quick legibility demo
BLINK_SECS  = 0                           # dark marker between passes; 0.25 is handy when debugging

# PAR layer: 3-ch RGB fixture sharing the universe, slow R->G->B->R cross-fade
PAR_ADDR      = 1                         # PAR start address (ch1=R ch2=G ch3=B)
PAR_FADE_SECS = 15                        # seconds per colour-to-colour fade (full R->G->B->R = 3x this)
PAR_LEVEL     = 255                       # PAR peak level; 0 = PAR off
# ==========================================

sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock.bind((BIND_IP, 0))
_seq = 0
_cur = {"pan": PAN_MIN, "tilt": TILT_BASE}   # last commanded position, so park() holds still
T0 = time.time()                             # PAR fade runs on wall-clock, independent of head phases


def send(f):
    global _seq
    _seq = (_seq % 255) + 1
    pkt = (b"Art-Net\x00" + struct.pack("<H", 0x5000) + struct.pack(">H", 14)
           + bytes([_seq, 0, SUBUNI, NET]) + struct.pack(">H", 512) + bytes(f))
    sock.sendto(pkt, (GATEWAY, PORT))


def frame(pan, tilt, prism, dim=DIM_VAL, par=True):
    """Full universe frame: PAR (1-3) cross-fading, head driven. Macro always 0."""
    _cur["pan"], _cur["tilt"] = pan, tilt
    f = [0] * 512
    if par and PAR_LEVEL:
        f[PAR_ADDR - 1:PAR_ADDR + 2] = par_rgb(time.time() - T0)
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
        send(frame(_cur["pan"], _cur["tilt"], PRISM_OFF, dim=0, par=False)); time.sleep(0.02)
    sys.exit(0)


signal.signal(signal.SIGTERM, park)
signal.signal(signal.SIGINT, park)


def smoothstep(t):
    return t * t * (3 - 2 * t)


def par_rgb(t):
    """Slow R->G->B->R cross-fade. Complementary blend: one colour falls as
    the next rises, so total output stays level and there's no dark gap."""
    phase = (t / PAR_FADE_SECS) % 3
    k = int(phase)
    s = smoothstep(phase - k)
    out, inc = int(round(PAR_LEVEL * (1 - s))), int(round(PAR_LEVEL * s))
    return ((out, inc, 0), (0, out, inc), (inc, 0, out))[k]   # R->G, G->B, B->R


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


print(f"flower show: pan {PAN_MIN}<->{PAN_MAX} tilt {TILT_BASE}+{TILT_SWING} "
      f"{SWEEP_SECS}s/pass dim={DIM_VAL} color={COLOR_SPIN} gobo={GOBO_FLOWER} "
      f"prism={PRISM_OFF}/{PRISM_ON} blink={BLINK_SECS}s | "
      f"PAR@{PAR_ADDR} R->G->B->R {PAR_FADE_SECS}s/fade level={PAR_LEVEL}", flush=True)

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
