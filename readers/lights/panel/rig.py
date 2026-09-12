"""Rig facts for the universe-0 setup, verified by live probing on 2026-09-12.

Geometry (cm): fixtures on the perimeter of a 150 cm-radius circle, one ~65 deg arc,
head at 0 deg, PARs @8/@15 at +-17 deg, @1/@22 at +-32.5 deg. Wall ~90 cm in front of
the head; PARs aim 20 deg above horizontal.
"""
import math

UNIVERSE = 0
FRAME_LEN = 512

# ---- PARs: 7-channel mode, offsets from the start address -----------------
PAR_ADDRS = [1, 8, 15, 22]                    # physical order along the arc
PAR_ANGLE_DEG = {1: -32.5, 8: -17.0, 15: 17.0, 22: 32.5}
PAR_DIM, PAR_R, PAR_G, PAR_B, PAR_STROBE, PAR_PROG, PAR_SPEED = range(7)   # PROG and SPEED: keep 0

# ---- Moving head: 13-channel mode @29, absolute channels ------------------
HEAD = 29
H_PAN, H_PAN_FINE, H_TILT, H_TILT_FINE, H_SPEED, H_DIM, H_STROBE, H_COLOUR, H_GOBO, H_PRISM, H_MACRO, H_UNUSED, H_RESET = range(29, 42)
HEAD_KEEP_ZERO = (H_MACRO, H_UNUSED, H_RESET)  # macro wanders the room, reset re-homes
PAN_WALL_CENTRE = 169          # pan DMX facing the wall centre (higher = anticlockwise)
PAN_DEG_PER_DMX = 540 / 255    # confirmed to within a few percent (42 steps ~ 90 deg)
TILT_WALL = 40                 # spot at PAR-beam height on the wall; 127 = straight up
TILT_UP = 127
SPEED_FAST, SPEED_SLOW = 0, 255
GOBO_OPEN, GOBO_FLOWER = 0, 80
PRISM_OFF, PRISM_6 = 0, 100
STROBE_OPEN = 0

# Colour wheel: 8 discrete slots of 16 DMX (0-15 white, 16-31 red, ...), read off 2026-09-12.
# value = safe midpoint of each slot; rgb = PAR colour that matches it (tune by eye).
COLOURS = [
    ("white",      4,   (1.00, 1.00, 1.00)),
    ("red",        20,  (1.00, 0.00, 0.00)),
    ("yellow",     36,  (1.00, 0.85, 0.00)),
    ("blue",       52,  (0.00, 0.00, 1.00)),
    ("green",      68,  (0.00, 1.00, 0.00)),
    ("pink",       84,  (1.00, 0.00, 0.55)),
    ("orange",     100, (1.00, 0.30, 0.00)),
    ("light blue", 116, (0.00, 0.60, 1.00)),
]
COLOUR_BY_NAME = {n: (v, rgb) for n, v, rgb in COLOURS}
COLOUR_SPIN_MIN = 150          # >= ~150 the wheel spins continuously (faster toward 255)

WALL_DIST = 90.0
ARC_RADIUS = 150.0


def par_wall_x(addr):
    """Lateral offset (cm) of a PAR's spot on the wall, from the head's centre line."""
    return ARC_RADIUS * math.sin(math.radians(PAR_ANGLE_DEG[addr]))


def head_spot_x(pan_dmx):
    """Lateral offset (cm) of the head's spot on the wall for a pan DMX value."""
    return WALL_DIST * math.tan(math.radians((pan_dmx - PAN_WALL_CENTRE) * PAN_DEG_PER_DMX))


def pan_for_x(x_cm):
    return PAN_WALL_CENTRE + math.degrees(math.atan2(x_cm, WALL_DIST)) / PAN_DEG_PER_DMX


def blank_frame():
    """All zero, which is safe for every fixture here except that the head runs its own
    program if DMX stops entirely, so keep sending frames."""
    return [0] * FRAME_LEN


def set_par(f, addr, rgb, level=1.0, dim=255):
    f[addr - 1 + PAR_DIM] = dim
    for k in range(3):
        f[addr + k] = max(0, min(255, int(round(255 * rgb[k] * level))))


def set_head(f, pan, tilt, dim, colour=0, gobo=0, prism=0, speed=SPEED_FAST, strobe=STROBE_OPEN):
    for ch, v in ((H_PAN, pan), (H_TILT, tilt), (H_SPEED, speed), (H_DIM, dim),
                  (H_STROBE, strobe), (H_COLOUR, colour), (H_GOBO, gobo), (H_PRISM, prism)):
        f[ch - 1] = max(0, min(255, int(round(v))))
    for ch in HEAD_KEEP_ZERO:
        f[ch - 1] = 0


def park_frame(width=41):
    """The safe dark frame: PARs off, head centred/up at slow speed, dimmer 0. Send this
    whenever nothing else is being sent (idle, stop, disconnect) — never all-zeros."""
    f = blank_frame()
    set_head(f, PAN_WALL_CENTRE, TILT_UP, 0, 0, 0, 0, 200, 0)
    return f[:width]


def intensity_mask(width=41):
    """Channels a brightness/gain control may scale: PAR R/G/B and the head dimmer."""
    m = [False] * width
    for a in PAR_ADDRS:
        for k in range(3):
            m[a + k] = True
    m[H_DIM - 1] = True
    return m


def readout(values):
    """Human-readable fixture state from a 41-channel frame (for the control panel)."""
    v = list(values) + [0] * (41 - len(values))
    return {
        "pars": [{"addr": a, "rgb": [int(v[a]), int(v[a + 1]), int(v[a + 2])], "strobe": int(v[a - 1 + PAR_STROBE])}
                 for a in PAR_ADDRS],
        "head": {"pan": int(v[H_PAN - 1]), "tilt": int(v[H_TILT - 1]), "dim": int(v[H_DIM - 1]),
                 "colour": int(v[H_COLOUR - 1]), "gobo": int(v[H_GOBO - 1]), "prism": int(v[H_PRISM - 1]),
                 "strobe": int(v[H_STROBE - 1])},
    }
