#!/usr/bin/env python3
"""Interactive DMX channel discovery for an unknown moving head.

Streams Art-Net continuously (so the head stays under DMX control and does
NOT fall back to its auto/self-run program), then walks one channel at a
time while you watch the fixture. You type what each channel does; at the
end it prints a channel map you can hand back for building real controls.

HOW TO USE
  1. Set the CONFIG values below to match your rig (especially START_ADDR:
     read it off the head's display -> A004 means 4, A002 means 2).
  2. Run it in a terminal where you can see the moving head:
         python3 dmx_discover.py
     (optional: python3 dmx_discover.py <START_ADDR> <NUM_CHANNELS>)
  3. For each channel it ramps 0 -> full -> 0. Watch the head, then answer.

  Per-channel prompt commands:
     <text>   record what it did (pan, tilt, dimmer, shutter, color, gobo,
              focus, prism, nothing, ...)
     r        repeat the sweep on this channel
     h <val>  HOLD this channel at <val> from here on, then label it.
              Use this on the dimmer/shutter channel to keep the beam OPEN
              so pan/tilt/color/gobo become visible on later channels.
              (dimmer is usually h 255; a shutter may open at a mid value)
     b        go back one channel
     q        quit early and print the map

  TIP: the beam is often dark until you find the shutter and/or dimmer.
  If early channels look like "nothing", find the beam channel, `h` it open,
  then use `b` to revisit the earlier channels now that you can see the beam.
"""
import socket, struct, threading, time, sys

# ===================== CONFIG =====================
GATEWAY      = "2.0.0.100"   # the Art-Net gateway you ping
BIND_IP      = "2.0.0.1"     # this machine's address on the Art-Net LAN
PORT         = 6454          # Art-Net UDP port
NET          = 0             # Art-Net Net
SUBUNI       = 1             # universe 1 (Sub-Net<<4 | Universe)
START_ADDR   = 4             # moving head's DMX start address (match its display!)
NUM_CHANNELS = 16            # how many channels to probe (>= the head's mode)
HZ           = 40            # refresh rate
SWEEP_SECS   = 6.0           # seconds per channel sweep
# ==================================================

# optional CLI overrides: python3 dmx_discover.py <start_addr> <num_channels>
if len(sys.argv) > 1:
    START_ADDR = int(sys.argv[1])
if len(sys.argv) > 2:
    NUM_CHANNELS = int(sys.argv[2])

frame    = [0] * 512
baseline = {}                 # 1-based abs channel -> held value (beam-open, etc.)
results  = {}                 # relative channel -> description
lock     = threading.Lock()
_stop    = False

sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock.bind((BIND_IP, 0))


def sender():
    """Background thread: continuously stream the current frame."""
    seq = 0
    while not _stop:
        seq = (seq % 255) + 1
        with lock:
            data = bytes(frame)
        pkt = (b"Art-Net\x00" + struct.pack("<H", 0x5000) + struct.pack(">H", 14)
               + bytes([seq, 0, SUBUNI, NET]) + struct.pack(">H", 512) + data)
        sock.sendto(pkt, (GATEWAY, PORT))
        time.sleep(1.0 / HZ)


def set_frame(overrides):
    """frame = all zeros + baseline holds + this-channel overrides."""
    with lock:
        for i in range(512):
            frame[i] = 0
        for ch, v in baseline.items():
            frame[ch - 1] = v
        for ch, v in overrides.items():
            frame[ch - 1] = v


def sweep_channel(abs_ch, seconds=SWEEP_SECS):
    """Triangle ramp 0 -> 255 -> 0 on abs_ch, keeping baseline held."""
    steps = int(seconds * HZ)
    for i in range(steps + 1):
        t = i / steps
        val = int(round(255 * (1 - abs(2 * t - 1))))   # 0->255->0
        set_frame({abs_ch: val})
        time.sleep(1.0 / HZ)
    set_frame({})


def main():
    global _stop
    print(f"\nArt-Net universe {SUBUNI} -> gateway {GATEWAY}")
    print(f"Probing moving head at DMX address {START_ADDR}, {NUM_CHANNELS} channels.")
    print("Streaming a steady signal so the head stays parked. Watch the fixture.\n")
    print("Commands: <text>=record  r=repeat  h <val>=hold beam open  b=back  q=quit\n")

    threading.Thread(target=sender, daemon=True).start()
    time.sleep(0.3)

    rel = 1
    while rel <= NUM_CHANNELS:
        abs_ch = START_ADDR + rel - 1
        held = ", ".join(f"DMX{c}={v}" for c, v in baseline.items()) or "none"
        print(f"\n=== fixture channel {rel}  (DMX {abs_ch}) ===   [beam-hold: {held}]")
        sweep_channel(abs_ch)
        ans = input(f"  ch{rel}: what did it do?  > ").strip()

        low = ans.lower()
        if low == "r":
            continue
        if low == "b":
            rel = max(1, rel - 1)
            continue
        if low == "q":
            break
        if low.startswith("h"):
            parts = ans.split()
            val = int(parts[1]) if len(parts) > 1 else 255
            baseline[abs_ch] = val
            lbl = input(f"  ch{rel}: label for this held channel? > ").strip()
            results[rel] = f"{lbl or 'beam (dimmer/shutter)'}  [held at {val}]"
            print(f"  -> holding DMX {abs_ch} at {val} from now on.")
            rel += 1
            continue

        results[rel] = ans or "nothing"
        rel += 1

    # park everything, keep streaming zeros while the map is on screen
    baseline.clear()
    set_frame({})
    time.sleep(0.2)

    print("\n================ CHANNEL MAP ================")
    for r in sorted(results):
        print(f"  fixture ch {r:2d}  (DMX {START_ADDR + r - 1:3d}) : {results[r]}")
    print("=============================================")
    print("Paste this back and I'll build proper controls (pan/tilt/color/etc.).")

    input("\nHead parked on a steady zero signal. Press Enter to exit.\n"
          "(After exit no DMX is sent, so the head may resume its auto-program.)")
    _stop = True
    time.sleep(0.1)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        _stop = True
        print("\nInterrupted.")
