#!/usr/bin/env python3
"""Live Art-Net probe driver: animate/hold channels, stream continuously.

Used to hunt for a moving head's functions by producing an obvious motion
on one channel and asking the operator y/n. Streams until stopped, blacks
out cleanly on exit.

Usage:
  probe.py osc <abs_ch> <lo> <hi> <period_s> [hold ch=val ...]
  probe.py hold [ch=val ...]
"""
import socket, struct, time, signal, sys, math

GATEWAY = "2.0.0.100"
BIND_IP = "2.0.0.1"
PORT    = 6454
NET     = 0
SUBUNI  = 1
HZ      = 40

sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock.bind((BIND_IP, 0))
_seq = 0

def send(f):
    global _seq
    _seq = (_seq % 255) + 1
    pkt = (b"Art-Net\x00" + struct.pack("<H", 0x5000) + struct.pack(">H", 14)
           + bytes([_seq, 0, SUBUNI, NET]) + struct.pack(">H", 512) + bytes(f))
    sock.sendto(pkt, (GATEWAY, PORT))

def shutdown(*_):
    for _ in range(3):
        send([0] * 512); time.sleep(0.02)
    sys.exit(0)
signal.signal(signal.SIGTERM, shutdown)
signal.signal(signal.SIGINT, shutdown)

def parse_holds(items):
    d = {}
    for it in items:
        if "=" in it:
            c, v = it.split("="); d[int(c)] = int(v)
    return d

args = sys.argv[1:]
mode = args[0] if args else "hold"

if mode == "osc":
    ch = int(args[1]); lo = int(args[2]); hi = int(args[3]); period = float(args[4])
    hold = parse_holds(args[5:])
    print(f"Oscillating DMX ch {ch}: {lo}<->{hi} over {period}s. holds={hold}")
    t0 = time.time()
    while True:
        t = time.time() - t0
        s = (math.sin(2 * math.pi * t / period) + 1) / 2      # eased 0..1
        val = int(round(lo + (hi - lo) * s))
        f = [0] * 512
        for c, v in hold.items(): f[c - 1] = v
        f[ch - 1] = val
        send(f); time.sleep(1.0 / HZ)

elif mode == "hold":
    hold = parse_holds(args[1:])
    print(f"Holding {hold or 'all zeros'}.")
    while True:
        f = [0] * 512
        for c, v in hold.items(): f[c - 1] = v
        send(f); time.sleep(1.0 / HZ)

elif mode == "step":
    # Square-wave jump on <ch> between lo/hi every <period>s, holding others.
    # Useful for testing a "speed" channel: watch how fast the jump itself
    # visibly happens, not just the end position.
    ch = int(args[1]); lo = int(args[2]); hi = int(args[3]); period = float(args[4])
    hold = parse_holds(args[5:])
    print(f"Stepping DMX ch {ch}: {lo} <-> {hi} every {period}s (square wave). holds={hold}")
    t0 = time.time()
    state = 0
    while True:
        t = time.time() - t0
        new_state = int(t // period) % 2
        val = hi if new_state else lo
        f = [0] * 512
        for c, v in hold.items(): f[c - 1] = v
        f[ch - 1] = val
        send(f); time.sleep(1.0 / HZ)
