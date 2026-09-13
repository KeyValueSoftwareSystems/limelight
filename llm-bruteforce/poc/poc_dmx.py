#!/usr/bin/env python3
"""
POC: MVR/GDTF -> beat-synced DMX -> sACN stream.

THROWAWAY proof-of-concept. Goal: prove the *pipeline spine* end-to-end on a
real stage file, with NO music analysis yet (a synthetic 128 BPM beat grid
stands in for the encoder). If beams move in time in BlenderDMX, "can we
generate a DMX stream to control the lighting" is answered.

Approach that makes light actually come out:
  * parse the MVR patch (universe/address per fixture) from GeneralSceneDescription.xml
  * parse each GDTF -> per-channel attribute, byte offset(s), and DEFAULT value
  * build a BASE frame from GDTF defaults (this opens every shutter=32, centers pan/tilt)
  * each frame, override only Dimmer / colour / Pan / Tilt, handling both
    additive RGBW (Spiider/Tetra) and subtractive CMY (Esprite/LedPOINTE)

Modes:
  inspect   parse the MVR+GDTF rig, print fixtures / universes / a channel map
  check     render frames offline, validate bytes + prove beat-sync            [no network]
  selftest  stream a few seconds to loopback, receive + validate on the wire
  stream    live sACN stream for BlenderDMX to render                          [watch this]
"""
import argparse, os, sys, time, math, zipfile, tempfile, glob, colorsys
import xml.etree.ElementTree as ET

import pygdtf
from pygdtf.utils import get_dmx_channels

DEFAULT_ZIP = "/home/alnas/Documents/Code/KeyCode/2026/simulation/MVR-Stash/Circle Stage/Circle Stage.zip"
BPM = 128.0
FPS = 44
BEAT = 60.0 / BPM
BAR = BEAT * 4

# ---------- helpers --------------------------------------------------------

def _norm(s):
    """Normalize a mode name so 'Mode 1 - Standard 16 bit' == 'Mode 1 - Standard 16 - bit'."""
    return "".join((s or "").lower().split()).replace("-", "")

def dmx_bytes(value, n):
    """Split an int into n bytes, MSB first."""
    return [(int(value) >> (8 * (n - 1 - i))) & 0xFF for i in range(n)]

# ---------- rig model ------------------------------------------------------

class Fixture:
    def __init__(self, name, gdtf_spec, mode, address, pos):
        self.name = name
        self.gdtf_spec = gdtf_spec
        self.mode = mode
        self.address = address
        self.pos = pos
        idx0 = address - 1
        self.universe = idx0 // 512 + 1
        self.start_ch = idx0 % 512 + 1
        self.attr_offsets = {}   # attribute(str) -> list of [abs_coarse, (abs_fine...)]
        self.default_bytes = {}  # abs_channel -> default byte value
        self.footprint = 0

def extract_mvr(zip_path, workdir):
    outer = os.path.join(workdir, "outer")
    with zipfile.ZipFile(zip_path) as z:
        z.extractall(outer)
    mvrs = glob.glob(os.path.join(outer, "**", "*.mvr"), recursive=True)
    if not mvrs and zip_path.endswith(".mvr"):
        mvrs = [zip_path]
    if not mvrs:
        sys.exit("No .mvr found in archive")
    inner = os.path.join(workdir, "mvr")
    with zipfile.ZipFile(mvrs[0]) as z:
        z.extractall(inner)
    return os.path.join(inner, "GeneralSceneDescription.xml"), inner

def parse_matrix_pos(text):
    try:
        vecs = [v for v in text.replace("}", "}|").split("|") if v.strip()]
        x, y, z = (float(p) for p in vecs[-1].strip().strip("{}").split(","))
        return (x, y, z)
    except Exception:
        return (0.0, 0.0, 0.0)

def load_fixtures(scene_xml):
    root = ET.parse(scene_xml).getroot()
    out = []
    for f in root.iter("Fixture"):
        spec = f.findtext("GDTFSpec")
        addr_el = f.find("Addresses/Address")
        if spec is None or addr_el is None:
            continue
        try:
            address = int(addr_el.text)
        except (TypeError, ValueError):
            continue
        out.append(Fixture(f.get("name", "?"), spec, f.findtext("GDTFMode"),
                           address, parse_matrix_pos(f.findtext("Matrix") or "")))
    return out

def resolve_channels(fixtures, gdtf_dir):
    """Fill each fixture's attr_offsets and default_bytes from its GDTF profile+mode."""
    cache = {}       # (spec, normmode) -> (channels list, footprint)
    profiles = {}
    for fx in fixtures:
        key = (fx.gdtf_spec, _norm(fx.mode))
        if key not in cache:
            if fx.gdtf_spec not in profiles:
                profiles[fx.gdtf_spec] = pygdtf.FixtureType(os.path.join(gdtf_dir, fx.gdtf_spec))
            prof = profiles[fx.gdtf_spec]
            chosen = next((m.name for m in prof.dmx_modes if _norm(m.name) == _norm(fx.mode)),
                          prof.dmx_modes[0].name)
            chans = []
            footprint = 0
            for brk in get_dmx_channels(prof, mode=chosen):
                for ch in brk:
                    offs = ch.offset or []
                    if not offs:
                        continue
                    footprint = max(footprint, max(offs))
                    dval = getattr(ch.default, "value", 0) or 0
                    chans.append((str(ch.attribute), offs, dval))
            cache[key] = (chans, footprint)
        chans, footprint = cache[key]
        fx.footprint = footprint
        base = fx.address - 1
        for attr, offs, dval in chans:
            abs_offs = [base + o for o in offs]        # 1-based absolute channels
            fx.attr_offsets.setdefault(attr, []).append(abs_offs)
            for ch_abs, bval in zip(abs_offs, dmx_bytes(dval, len(offs))):
                fx.default_bytes[ch_abs] = bval
    return fixtures

def build_base_frame(fixtures):
    base = {}
    for fx in fixtures:
        for ch_abs, bval in fx.default_bytes.items():
            u = (ch_abs - 1) // 512 + 1
            base.setdefault(u, bytearray(512))[(ch_abs - 1) % 512] = bval
    return base

def universes_of(base_frame):
    return sorted(base_frame.keys())

# ---------- writing values -------------------------------------------------

def set_abs(frame, ch_abs, val):
    u = (ch_abs - 1) // 512 + 1
    c = (ch_abs - 1) % 512
    frame.setdefault(u, bytearray(512))[c] = max(0, min(255, int(val)))

def set_attr(frame, fx, attr, value):
    """Set coarse byte to value (0-255), zero the fine byte, for every channel of this attr."""
    for offs in fx.attr_offsets.get(attr, []):
        set_abs(frame, offs[0], value)
        if len(offs) > 1:
            set_abs(frame, offs[1], 0)

def set_color(frame, fx, r, g, b):
    if "ColorAdd_R" in fx.attr_offsets:               # additive RGBW
        set_attr(frame, fx, "ColorAdd_R", r)
        set_attr(frame, fx, "ColorAdd_G", g)
        set_attr(frame, fx, "ColorAdd_B", b)
        if "ColorAdd_W" in fx.attr_offsets:
            set_attr(frame, fx, "ColorAdd_W", 0)
    elif "ColorSub_C" in fx.attr_offsets:             # subtractive CMY
        set_attr(frame, fx, "ColorSub_C", 255 - r)
        set_attr(frame, fx, "ColorSub_M", 255 - g)
        set_attr(frame, fx, "ColorSub_Y", 255 - b)

# ---------- the throwaway "show" (128 BPM grid) ----------------------------

PALETTE = [(255, 40, 40), (40, 120, 255), (255, 180, 30),
           (60, 255, 120), (200, 40, 255), (255, 255, 255)]

def env_kick(t):
    return max(0.0, 1.0 - (t / BEAT) % 1.0) ** 1.6

def hue_rgb(h):
    r, g, b = colorsys.hsv_to_rgb(h % 1.0, 1.0, 1.0)
    return int(r * 255), int(g * 255), int(b * 255)

def render_frame(fixtures, base, t, x_span):
    frame = {u: bytearray(buf) for u, buf in base.items()}   # copy defaults (shutters open etc.)
    beat_i = int(t / BEAT)
    bar_col = PALETTE[(beat_i // 4) % len(PALETTE)]
    kick = env_kick(t)
    lo, hi = x_span
    for i, fx in enumerate(fixtures):
        n = fx.gdtf_spec.lower()          # reliable type id (name attr is inconsistent)
        xn = 0.5 if hi == lo else (fx.pos[0] - lo) / (hi - lo)
        if "esprite" in n:                         # moving heads (CMY): sweep + wash
            set_attr(frame, fx, "Dimmer", 180 + 60 * kick)
            set_attr(frame, fx, "Pan", 128 + 110 * math.sin(2 * math.pi * (t / (BAR * 2)) + xn * math.pi))
            set_attr(frame, fx, "Tilt", 150)
            set_color(frame, fx, *bar_col)
        elif "ledpointe" in n:                     # CMY beams: pulse to the kick, colour chase
            set_attr(frame, fx, "Dimmer", 255 * kick)
            set_color(frame, fx, *hue_rgb(xn + t * 0.15))
        elif "spiider" in n:                       # RGBW wash: continuous hue + gentle pulse
            set_attr(frame, fx, "Dimmer", 140 + 80 * kick)
            set_color(frame, fx, *hue_rgb(t * 0.08 + i * 0.05))
        else:                                      # Tetra bars (RGBW): running chase
            phase = (t / BEAT + xn * 2) % 1.0
            set_attr(frame, fx, "Dimmer", 255 * max(0.0, 1.0 - phase * 2))
            set_color(frame, fx, *bar_col)
    return frame

# ---------- modes ----------------------------------------------------------

def load_rig(zip_path, workdir):
    scene_xml, gdtf_dir = extract_mvr(zip_path, workdir)
    fixtures = load_fixtures(scene_xml)
    resolve_channels(fixtures, gdtf_dir)
    return fixtures, build_base_frame(fixtures)

def x_span_of(fixtures):
    xs = [f.pos[0] for f in fixtures]
    return (min(xs), max(xs))

def mode_inspect(fixtures, base):
    print(f"\n{'='*66}\n  RIG: {len(fixtures)} fixtures\n{'='*66}")
    bytype = {}
    for fx in fixtures:
        bytype.setdefault(fx.gdtf_spec, []).append(fx)
    for spec, fxs in sorted(bytype.items()):
        f0 = fxs[0]
        color = "RGBW" if "ColorAdd_R" in f0.attr_offsets else ("CMY" if "ColorSub_C" in f0.attr_offsets else "?")
        print(f"\n  {len(fxs):3d} x {spec}")
        print(f"        mode: {f0.mode}  (footprint {f0.footprint} ch, colour {color})")
        print(f"        controllable: {', '.join(sorted(f0.attr_offsets.keys()))[:110]}")
    print(f"\n  universes in use: {universes_of(base)}")
    xs = [fx.pos[0] for fx in fixtures]
    print(f"  stage X span (mm): {min(xs):.0f} .. {max(xs):.0f}")
    fx = fixtures[0]
    print(f"\n  sample resolved patch  [{fx.name}] @ U{fx.universe}/ch{fx.start_ch}:")
    for attr in ("Dimmer", "Pan", "Tilt", "Shutter1", "ColorSub_C", "ColorAdd_R"):
        if attr in fx.attr_offsets:
            print(f"        {attr:12s} -> abs channels {fx.attr_offsets[attr][:3]}")

def mode_check(fixtures, base):
    x_span = x_span_of(fixtures)
    us = universes_of(base)
    print(f"\nRendering 2s @ {FPS}fps over {len(us)} universes {us} ...")
    frames, bad, moved = 0, 0, set()
    prev = None
    for k in range(int(2 * FPS)):
        fr = render_frame(fixtures, base, k / FPS, x_span)
        frames += 1
        for u, buf in fr.items():
            if len(buf) != 512 or any(b < 0 or b > 255 for b in buf):
                bad += 1
        if prev:
            for u, buf in fr.items():
                pb = prev.get(u)
                for c in range(512):
                    if pb is None or pb[c] != buf[c]:
                        moved.add((u, c + 1))
        prev = fr
    print(f"  frames rendered: {frames}   invalid buffers: {bad}")
    print(f"  channels that MOVE over 2s: {len(moved)} on universes {sorted(set(u for u,_ in moved))}")
    # beat-sync proof: dimmer of one LedPOINTE across one beat should rise->fall
    pick = next((fx for fx in fixtures if "ledpointe" in fx.gdtf_spec.lower()), fixtures[0])
    ch = pick.attr_offsets["Dimmer"][0][0]
    print(f"\n  {pick.name} Dimmer (coarse ch {ch}) across one beat — proves beat-sync:")
    row = ""
    for k in range(0, int(BEAT * FPS) + 1, 3):
        fr = render_frame(fixtures, base, k / FPS, x_span)
        u = (ch - 1)//512 + 1; c = (ch-1) % 512
        v = fr[u][c]
        row += f"{k/FPS*1000:5.0f}ms:{v:<4}"
    print("   " + row)
    ok = bad == 0 and len(moved) > 0
    print(f"\n  RESULT: {'PASS' if ok else 'FAIL'} — DMX frames valid and beat-synced.")
    return ok

def _run_stream(sender, fixtures, base, seconds, uni_offset):
    x_span = x_span_of(fixtures)
    base_us = universes_of(base)
    t0 = time.time(); sent = 0
    while time.time() - t0 < seconds:
        t = time.time() - t0
        fr = render_frame(fixtures, base, t, x_span)
        for u in base_us:
            sender[u + uni_offset].dmx_data = tuple(fr.get(u, base[u]))
        sent += 1
        time.sleep(max(0, (sent / FPS) - (time.time() - t0)))
    for u in base_us:                                   # blackout tail
        sender[u + uni_offset].dmx_data = tuple(bytearray(512))
    time.sleep(0.1)
    return sent

def mode_stream(fixtures, base, seconds, multicast, host, uni_offset):
    import sacn
    us = [u + uni_offset for u in universes_of(base)]
    print(f"Streaming {seconds:.0f}s to universes {us} "
          f"({'multicast' if multicast else 'unicast '+host}) @ {FPS}fps. Ctrl-C to stop.")
    # bind_port 5569 so we don't fight BlenderDMX's receiver on 5568 (same machine)
    sender = sacn.sACNsender(bind_port=5569, fps=FPS, universeDiscovery=False)
    sender.start()
    for u in us:
        sender.activate_output(u)
        if multicast:
            sender[u].multicast = True
        else:
            sender[u].destination = host
    try:
        sent = _run_stream(sender, fixtures, base, seconds, uni_offset)
        print(f"  sent {sent} frames (~{sent/max(1,seconds):.0f} fps)")
    finally:
        sender.stop()

def mode_selftest(fixtures, base, seconds=3):
    import sacn
    base_us = universes_of(base)
    test_u = base_us[0]
    got = {"count": 0, "last": None, "moved": set()}
    recv = sacn.sACNreceiver()
    recv.start()

    @recv.listen_on('universe', universe=test_u)
    def _cb(packet):
        data = packet.dmxData
        got["count"] += 1
        if got["last"] is not None:
            for i in range(min(len(data), len(got["last"]))):
                if data[i] != got["last"][i]:
                    got["moved"].add(i + 1)
        got["last"] = data

    time.sleep(0.3)
    # bind sender to a different source port so it doesn't collide with the
    # receiver on 5568 (sACN dest port is fixed at 5568); unicast over loopback.
    sender = sacn.sACNsender(bind_port=5569, fps=FPS, universeDiscovery=False)
    sender.start()
    for u in base_us:
        sender.activate_output(u)
        sender[u].multicast = False
        sender[u].destination = "127.0.0.1"
    _run_stream(sender, fixtures, base, seconds, 0)
    time.sleep(0.3)
    sender.stop(); recv.stop()
    print(f"\n  SELF-TEST on universe {test_u} (unicast loopback):")
    print(f"    packets RECEIVED: {got['count']}")
    print(f"    channels seen CHANGING on the wire: {len(got['moved'])}")
    ok = got["count"] > 0 and len(got["moved"]) > 0
    print(f"    -> {'PASS: valid, changing DMX confirmed on the wire' if ok else 'no packets captured (loopback blocked in this env)'}")
    return ok

# ---------- main -----------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["inspect", "check", "selftest", "stream"])
    ap.add_argument("--zip", default=DEFAULT_ZIP)
    ap.add_argument("--seconds", type=float, default=30)
    ap.add_argument("--unicast", metavar="HOST", default=None,
                    help="unicast to HOST instead of multicast (e.g. 127.0.0.1)")
    ap.add_argument("--universe-offset", type=int, default=0,
                    help="shift universe numbers if BlenderDMX numbering differs")
    args = ap.parse_args()
    with tempfile.TemporaryDirectory() as wd:
        fixtures, base = load_rig(args.zip, wd)
        if not fixtures:
            sys.exit("No fixtures parsed.")
        if args.mode == "inspect":
            mode_inspect(fixtures, base)
        elif args.mode == "check":
            mode_check(fixtures, base)
        elif args.mode == "selftest":
            mode_selftest(fixtures, base, min(args.seconds, 4))
        elif args.mode == "stream":
            mode_stream(fixtures, base, args.seconds,
                        multicast=(args.unicast is None),
                        host=args.unicast or "", uni_offset=args.universe_offset)

if __name__ == "__main__":
    main()
