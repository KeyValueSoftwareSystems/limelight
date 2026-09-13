#!/usr/bin/env python3
"""Cycling test signatures for the 3-channel PAR (ac90) at DMX 1-3.

Standalone PAR tester. Run it ONLY when nothing else is streaming to the
PAR's universe: the node at 2.0.0.100 keys merge sources by IP, so two
senders from this machine on one universe just overwrite each other and
the PAR flickers (confirmed 2026-09-10). For the head + PAR show use
head_show.py (head, universe 0) and flower_show.py (PAR, universe 1).
Packets carry Length=3, so channels 4+ are never written by this script.

Modes (loops forever, Ctrl-C / SIGTERM blacks out channels 1-3 and exits):
  chase  (default)  ch1, ch2, ch3 take turns ramping 0 -> 255 -> 0, one at a
                    time, so you can tell which channel is which by eye
  hue               all three run as phase-shifted sine waves (RGB colour wheel)
  step              ch1, ch2, ch3 snap to full one at a time (square wave)

Usage:
  python3 par_cycle.py [chase|hue|step] [period_s] [peak 0-255]
    period_s  seconds for ONE channel's turn (chase/step) or one full
              colour rotation (hue). default 2.0
    peak      max level. default 255
"""
import math, signal, socket, struct, sys, time

GATEWAY, BIND_IP, PORT = "2.0.0.100", "2.0.0.1", 6454
NET, SUBUNI, HZ        = 0, 1, 40
FIRST_CH, NUM_CH       = 1, 3          # PAR occupies DMX 1..3

mode   = sys.argv[1] if len(sys.argv) > 1 else "chase"
period = float(sys.argv[2]) if len(sys.argv) > 2 else 2.0
peak   = int(sys.argv[3]) if len(sys.argv) > 3 else 255
if mode not in ("chase", "hue", "step"):
    sys.exit(__doc__)

sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock.bind((BIND_IP, 0))
_seq = 0
LENGTH = FIRST_CH - 1 + NUM_CH          # bytes actually sent (3)


def send(vals):
    """ArtDmx with Length=LENGTH: only DMX 1..LENGTH are on the wire."""
    global _seq
    _seq = (_seq % 255) + 1
    data = bytes([0] * (FIRST_CH - 1) + [max(0, min(255, int(round(v)))) for v in vals])
    pkt = (b"Art-Net\x00" + struct.pack("<H", 0x5000) + struct.pack(">H", 14)
           + bytes([_seq, 0, SUBUNI, NET]) + struct.pack(">H", LENGTH) + data)
    sock.sendto(pkt, (GATEWAY, PORT))


def blackout(*_):
    for _ in range(5):
        send([0] * NUM_CH); time.sleep(0.02)
    print("\nPAR channels 1-3 blacked out, exiting.", flush=True)
    sys.exit(0)


signal.signal(signal.SIGTERM, blackout)
signal.signal(signal.SIGINT, blackout)


def levels(t):
    if mode == "hue":
        # three sines 120 deg apart -> smooth colour wheel, one rotation per period
        return [peak * (math.sin(2 * math.pi * (t / period - i / NUM_CH)) + 1) / 2
                for i in range(NUM_CH)]
    turn   = int(t // period) % NUM_CH           # which channel owns this slot
    phase  = (t % period) / period               # 0..1 inside the slot
    if mode == "step":
        lvl = peak
    else:                                        # chase: triangle 0 -> peak -> 0
        lvl = peak * (1 - abs(2 * phase - 1))
    return [lvl if i == turn else 0 for i in range(NUM_CH)]


print(f"par_cycle: universe {SUBUNI} -> {GATEWAY}, DMX {FIRST_CH}-{FIRST_CH+NUM_CH-1}, "
      f"mode={mode} period={period}s peak={peak}, packet Length={LENGTH} (head untouched)",
      flush=True)

t0 = time.time()
last_turn = -1
while True:
    t = time.time() - t0
    if mode != "hue":
        turn = int(t // period) % NUM_CH
        if turn != last_turn:
            print(f"  -> DMX {FIRST_CH + turn} active", flush=True)
            last_turn = turn
    send(levels(t))
    time.sleep(1.0 / HZ)
