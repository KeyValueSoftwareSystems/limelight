"""effects.py - the effect library for the universe-0 rig (4 PARs on an arc + moving head).

An effect is a small function of (cue, score, t, look, params) that writes into a Look:
PAR (rgb, level, strobe) per address and a head target dict. Each is tagged with what it
SUITS (role -> weight), what it NEEDS from the score (a predicate on the cue) and which
layer it belongs to, so an arranger can draw one PAR look, one head look and any number
of rule-fired events per cue and get a coherent frame without two effects fighting over
the same channels.

    PAR looks   comet_chase, ripple_hits, pair_alternate, full_rig_hits, glide_gradient,
                riff_build, pace_build, vocal_swell, brightness_follow, bass_pump,
                half_kit_taps, fade_collapse, dark_hold
    head looks  roam_slow, spotlight, spiral_rise, room_patterns, figure8, corner_snaps,
                sweep_locked, spot_per_bar, head_bloom, park_fade
    events      pre_drop_blackout, drop_hit, break_blackout, strobe_pops,
                strobe_accelerate, wheel_spin_tail, white_finale, pause_hold,
                highlight_flare, release_accent

Roles a cue can have: intro, verse, build, drop, final_drop, breakdown, bridge, outro, gap.
Score lanes an effect may read by time: energy, width, air, pump, pace, brightness,
drums, bass, vocals, other, tension (per beat), the chord of the bar, and the rise span
the score declares (sc.ramp). pace drives chase RATE and tension drives build INTENSITY,
so a build accelerates and swells even when loudness is flat -- the failure the
dont-look-down brief is written against.
"""
import math
import re
from dataclasses import dataclass, field

import rig
import concert
from concert import flash, bump, ease, kick, mix, PAR_X, INNER, OUTER, PAN_MID, TILT_MID, X_OUTER_CM, GOBOS, SPIN

ROLES = ("intro", "verse", "build", "drop", "final_drop", "breakdown", "bridge", "outro", "gap")
LAYERS = ("par", "head", "event")

# chord root -> wheel colour (the head can only do these eight, the PARs copy them)
CHORD_COLOUR = {"C#": "blue", "Db": "blue", "A": "pink", "E": "light blue", "B": "white",
                "F#": "green", "Gb": "green", "G#": "orange", "Ab": "orange", "F": "yellow",
                "D": "red", "G": "green", "C": "white", "Bb": "orange", "A#": "orange", "D#": "red", "Eb": "red"}
PALETTES = {"gold": ["yellow", "orange", "yellow", "white"],
            "warm": ["orange", "pink", "yellow", "orange"],
            "cool": ["blue", "light blue", "white", "pink"],
            "ice": ["light blue", "white", "blue", "light blue"],
            "drop": ["light blue", "white", "pink", "blue"]}
PAIR = {"blue": "pink", "pink": "blue", "light blue": "white", "white": "light blue",
        "green": "pink", "orange": "blue", "yellow": "blue", "red": "white"}
PINGPONG = (0, 1, 2, 3, 2, 1)
LEFT_RIGHT = (0, 1, 2, 3)
DEEP_BLUE = (0.0, 0.08, 1.0)


class Look:
    """What one frame should show, before slew limiting and DMX encoding."""

    def __init__(self):
        self.par = {a: ((0.0, 0.0, 0.0), 0.0, 0) for a in rig.PAR_ADDRS}     # addr -> (rgb, level, strobe)
        self.head = dict(pan=PAN_MID, tilt=rig.TILT_WALL, dim=0.0, colour="white", gobo=0, prism=0, strobe=0)
        self.origin_x = 0.0        # where the PAR gesture is along the arc (-1..1), for a head that follows
        self.hold_head = False     # an event darkened the head: keep its pose, do not re-aim


@dataclass
class Effect:
    name: str
    layer: str
    suits: dict
    fn: callable
    needs: callable = field(default=lambda cue: True)
    doc: str = ""

    def render(self, cue, sc, t, look, params=None):
        self.fn(cue, sc, t, look, params or {})

    def fits(self, cue):
        return self.suits.get(cue.role_key, 0.0) > 0 and bool(self.needs(cue))


LIBRARY = {}


def effect(layer, suits, needs=None, doc=""):
    assert layer in LAYERS
    assert all(r in ROLES for r in suits), suits

    def deco(fn):
        LIBRARY[fn.__name__] = Effect(fn.__name__, layer, dict(suits), fn, needs or (lambda cue: True), doc or (fn.__doc__ or "").strip())
        return fn
    return deco


def by_layer(layer):
    return [e for e in LIBRARY.values() if e.layer == layer]


# --------------------------------------------------------------------- helpers
def progress(cue, t):
    return min(1.0, max(0.0, (t - cue.from_s) / max(cue.to_s - cue.from_s, 1e-9)))


def lbar(cue, sc, t):
    """Bar index within the cue (0 = its first bar)."""
    return max(0, sc.bar_at(t) - cue.from_bar)


def pace_steps(sc, cue, t):
    """Continuous chase-step position from integrating the `pace` lane beat by beat since
    the cue began: steps-per-beat = pace, so pace 0.5 advances one lamp every two beats and
    pace 1.5 advances 1.5 lamps a beat. Because pace is per bar the rate steps at the bar
    line, so a double-time bar makes the chase JUMP rather than ease."""
    b0 = sc.beat_index(cue.from_s)
    bi = sc.beat_index(t)
    total = 0.0
    for k in range(b0, bi):
        total += max(0.25, sc.lane_bar("pace", sc.bar_of_beat(k), 1.0))
    return total + sc.beat_phase(t) * max(0.25, sc.lane_bar("pace", sc.bar_of_beat(bi), 1.0))


def chord_root(name):
    m = re.match(r"([A-G][#b]?)", name or "")
    return m.group(1) if m else None


def colour_name(cue, sc, t, P, k=None):
    """Palette colour for the moment: 'chord' follows the harmony lane, anything else steps
    through a named palette every `colour_bars` bars of the cue."""
    pal = P.get("palette", "cool")
    if pal == "chord":
        c = CHORD_COLOUR.get(chord_root(sc.chord(t)))
        if c:
            return c
        pal = "drop"
    names = PALETTES.get(pal, PALETTES["cool"])
    if k is None:
        k = lbar(cue, sc, t) // max(1, int(P.get("colour_bars", 1)))
    return names[k % len(names)]


def rgb(name, t=0.0):
    return concert.rgb_of(name, t)


def lerp_rgb(a, b, m):
    return tuple(x * (1 - m) + y * m for x, y in zip(a, b))


def comet_levels(u, order, tail):
    """Level 0..1 of each of the four lamps for a chase at continuous step position u:
    the lamp lit at step floor(u) is brightest, the ones lit before trail off by `tail` per
    step, and the decay runs continuously through the step so hand-offs never snap."""
    k = int(math.floor(u))
    frac = u - k
    n = len(order)
    out = [0.0] * 4
    for i in range(4):
        for j in range(n):
            if order[(k - j) % n] == i:
                out[i] = tail ** (j + frac)
                break
    return out


def set_all(look, rgb_, level, strobe=0):
    for a in rig.PAR_ADDRS:
        look.par[a] = (rgb_, level, strobe)


# --------------------------------------------------------------------- PAR looks
@effect("par", {"intro": 1.0, "breakdown": 0.7, "bridge": 0.5, "outro": 0.3})
def comet_chase(cue, sc, t, look, P):
    """One bright lamp travels the arc with a decaying tail. Speed follows the pace lane
    (one lamp per beat, per half beat, per quarter), colour steps per bar, direction flips
    when the section is falling away."""
    pace, energy = sc.lane("pace", t), sc.lane("energy", t)
    step = P.get("step") or (1.0 if pace < 0.8 else 0.5 if pace < 1.8 else 0.25)
    u = (t - cue.from_s) / (step * sc.beat_s)
    order = PINGPONG if P.get("bounce", True) else LEFT_RIGHT
    if cue.rise < -0.2:
        order = tuple(reversed(order))
    lv = comet_levels(u, order, P.get("tail", 0.45))
    floor_ = P.get("floor", 0.04 + 0.12 * energy)
    peak = P.get("peak", 0.85)
    col = rgb(colour_name(cue, sc, t, P))
    for i, a in enumerate(rig.PAR_ADDRS):
        look.par[a] = (col, min(1.0, floor_ + peak * lv[i]), 0)
    look.origin_x = PAR_X[rig.PAR_ADDRS[order[int(math.floor(u)) % len(order)]]]


@effect("par", {"drop": 1.0, "final_drop": 0.6})
def ripple_hits(cue, sc, t, look, P):
    """Every beat hits all four lamps, but the hit reaches each lamp a few ms later the
    further it is from an origin that moves left / right / centre each bar, so the same
    movement ripples across the rig instead of blinking as one. Spread follows the width
    lane; the downbeat hit is white."""
    I = cue.intensity
    spread_s = 0.03 + 0.09 * sc.lane("width", t)
    origin = (-1.0, 1.0, 0.0)[lbar(cue, sc, t) % 3]
    floor_ = 0.18 + 0.22 * I
    big = I >= 0.75                          # the bigger drop: two chord colours and an off-beat ghost
    bp, down = sc.beat_phase(t), sc.beat_in_bar(t) == 0
    c1 = colour_name(cue, sc, t, P)
    c2 = PAIR.get(c1, "white") if big else c1
    for a in rig.PAR_ADDRS:
        ph = bp - spread_s * abs(PAR_X[a] - origin) / sc.beat_s
        if ph < 0:
            ph += 1.0
        lvl = floor_ + (1 - floor_) * flash(ph, 0.45) + (0.35 * bump(ph, 0.5, 0.05) if big else 0.0)
        col = rgb(c1 if a in INNER else c2)
        look.par[a] = ((1.0, 1.0, 1.0) if (down and ph < 0.12) else col, min(1.0, lvl), 0)
    look.origin_x = origin


@effect("par", {"drop": 0.8, "final_drop": 0.3, "bridge": 0.3})
def pair_alternate(cue, sc, t, look, P):
    """Inner and outer pairs answer each other beat by beat in two colours (the chord
    colour and its partner); the resting pair carries a ghost bump on the off-beat."""
    I = cue.intensity
    bi, bp, lb = sc.beat_index(t), sc.beat_phase(t), lbar(cue, sc, t)
    on = INNER if (bi + (lb // 2) % 2) % 2 == 0 else OUTER
    c1 = colour_name(cue, sc, t, P)
    c2 = PAIR.get(c1, "white")
    down = sc.beat_in_bar(t) == 0
    for a in rig.PAR_ADDRS:
        hit = 1.0 if (a in on or down) else 0.0
        ghost = (0.25 + 0.2 * I) * bump(bp, 0.5, 0.05) if a not in on else 0.0
        lvl = (0.3 + 0.2 * I) + (0.7 - 0.2 * I) * hit * flash(bp, 0.55) + ghost
        look.par[a] = (rgb(c1 if a in INNER else c2), min(1.0, lvl), 0)
    look.origin_x = 0.0 if on is INNER else 1.0


@effect("par", {"final_drop": 1.0, "drop": 0.4}, needs=lambda c: c.intensity >= 0.7)
def full_rig_hits(cue, sc, t, look, P):
    """All four lamps on every beat, inner and outer in two chord colours, white on the
    downbeat, ghost on the off-beat: the biggest PAR look, for the biggest drop."""
    bp, down = sc.beat_phase(t), sc.beat_in_bar(t) == 0
    c1 = colour_name(cue, sc, t, P)
    c2 = PAIR.get(c1, "white")
    for a in rig.PAR_ADDRS:
        lvl = 0.6 + 0.4 * flash(bp, 0.5) + 0.4 * bump(bp, 0.5, 0.05)
        col = (1.0, 1.0, 1.0) if (down and bp < 0.15) else rgb(c1 if a in INNER else c2, t)
        look.par[a] = (col, min(1.0, lvl), 0)


@effect("par", {"breakdown": 1.0, "intro": 0.5, "outro": 0.4, "verse": 0.3})
def glide_gradient(cue, sc, t, look, P):
    """A two-colour gradient slides along the arc over two bars while each lamp breathes
    out of phase with its neighbours: nothing holds still and nothing snaps. The outer
    lamps sit back when the energy is very low."""
    energy = sc.lane("energy", t)
    c1 = colour_name(cue, sc, t, P, k=0)
    c2 = colour_name(cue, sc, t, {"palette": "cool"}, k=1) if P.get("palette") == "chord" else PAIR.get(c1, "white")
    A, B = rgb(c1), rgb(c2)
    slide = (t - cue.from_s) / (2 * sc.bar_s)
    for a in rig.PAR_ADDRS:
        x = PAR_X[a]
        m = 0.5 + 0.5 * math.sin(math.pi * (0.5 * x + slide))
        breath = 0.5 + 0.5 * math.sin(2 * math.pi * t / (2 * sc.bar_s) + 1.2 * x)
        lvl = (0.16 + 0.34 * breath) * (0.7 + 0.3 * min(1.0, energy * 3))
        if a in OUTER and energy < 0.1:
            lvl *= 0.55
        look.par[a] = (lerp_rgb(A, B, m), min(1.0, lvl), 0)


@effect("par", {"build": 1.0})
def riff_build(cue, sc, t, look, P):
    """The riff chase accelerates through the build (one lamp per beat, then per half,
    quarter, eighth) and a second comet running the other way joins halfway: busier every
    bar, whitening slightly, but not brighter. The strobe belongs to strobe_accelerate."""
    p, lb, bph = progress(cue, t), lbar(cue, sc, t), sc.bar_phase(t)
    bars = max(1, cue.bars)

    def steps_per_bar(b):
        q = b / bars
        return 4 if q < 0.25 else 8 if q < 0.5 else 16 if q < 0.8 else 32
    u = sum(steps_per_bar(b) for b in range(lb)) + bph * steps_per_bar(lb)
    lv = comet_levels(u, PINGPONG, 0.5)
    lv2 = comet_levels(u + 3, tuple(reversed(PINGPONG)), 0.5) if p > 0.5 else [0.0] * 4
    col = mix(rgb(colour_name(cue, sc, t, P)), 1.0, 0.35 * p)
    peak = 0.78 - 0.3 * p                      # busier, not brighter: two faster comets share the light of one
    for i, a in enumerate(rig.PAR_ADDRS):
        look.par[a] = (col, min(1.0, 0.06 + peak * max(lv[i], lv2[i])), 0)
    look.origin_x = PAR_X[rig.PAR_ADDRS[PINGPONG[int(math.floor(u)) % 6]]]


@effect("par", {"build": 1.0})
def pace_build(cue, sc, t, look, P):
    """A build that reads the score, not the clock. The chase RATE is the pace lane (on the
    bar when pace is low, on the beat, then twice a beat as it climbs; a double-time bar
    makes it jump), and the floor and a second counter-comet come in with TENSION, not
    loudness -- so a build whose energy sits flat still visibly accelerates and fills. The
    swell follows the rise span the score declares (sc.ramp) when there is one."""
    ten = sc.tension(t, default=None)
    ramp = sc.ramp(t)
    ramp = progress(cue, t) if ramp is None else ramp
    lift = ramp if ten is None else max(ten, 0.3 * ramp)
    u = pace_steps(sc, cue, t)
    lv = comet_levels(u, PINGPONG, 0.5)
    lv2 = comet_levels(u + 3, tuple(reversed(PINGPONG)), 0.5) if lift > 0.55 else [0.0] * 4
    col = mix(rgb(colour_name(cue, sc, t, P)), 1.0, 0.4 * ramp)
    floor_ = 0.05 + 0.20 * lift
    peak = 0.55 + 0.25 * lift
    for i, a in enumerate(rig.PAR_ADDRS):
        look.par[a] = (col, min(1.0, floor_ + peak * max(lv[i], lv2[i])), 0)
    look.origin_x = PAR_X[rig.PAR_ADDRS[PINGPONG[int(math.floor(u)) % 6]]]


@effect("par", {"verse": 1.0, "breakdown": 0.3}, needs=lambda c: c.stems.get("vocals") in ("full", "some"))
def vocal_swell(cue, sc, t, look, P):
    """The inner pair swells and fades with the vocal lane in warm colours (the phrase
    shape is in the lane); the outer pair breathes deep blue underneath and pulses softly
    with the bass on beats 1 and 3."""
    v = max(0.0, min(1.0, sc.lane_smooth("vocals", t)))
    warm = rgb(colour_name(cue, sc, t, dict(P, palette=P.get("palette", "warm"), colour_bars=2)))
    bp, bi = sc.beat_phase(t), sc.beat_index(t)
    shimmer = 0.04 * math.sin(2 * math.pi * t * 3 / sc.bar_s)
    for a in rig.PAR_ADDRS:
        if a in INNER:
            look.par[a] = (warm, min(1.0, max(0.0, 0.10 + 0.78 * v + shimmer)), 0)
        else:
            breath = 0.5 + 0.5 * math.sin(2 * math.pi * t / sc.bar_s + (0.0 if a == rig.PAR_ADDRS[0] else math.pi))
            pulse = 0.12 * flash(bp, 0.5) if (bi % 2 == 0 and sc.lane("bass", t) > 0.2) else 0.0
            look.par[a] = (DEEP_BLUE, min(1.0, 0.05 + 0.12 * breath + pulse), 0)


@effect("par", {"breakdown": 1.0, "verse": 0.4, "bridge": 0.4}, needs=lambda c: c.brightness_min < 0.5)
def brightness_follow(cue, sc, t, look, P):
    """Follows the brightness lane: dark, saturated colour while the filter is closed,
    blooming towards white as it opens; the outer lamps only join as it brightens."""
    b = max(0.0, min(1.0, sc.lane_smooth("brightness", t)))
    col = mix(rgb(colour_name(cue, sc, t, dict(P, colour_bars=4))), 1.0, 0.6 * b * b)
    breath = 0.5 + 0.5 * math.sin(2 * math.pi * t / (2 * sc.bar_s))
    scale = 0.6 + 0.4 * min(1.0, 3 * sc.lane("energy", t))
    for a in rig.PAR_ADDRS:
        lvl = (0.06 + 0.55 * b * b + 0.06 * breath) * scale
        if a in OUTER:
            lvl *= ease(max(0.0, min(1.0, (b - 0.3) / 0.4)))
        look.par[a] = (col, min(1.0, lvl), 0)


@effect("par", {"bridge": 1.0, "breakdown": 0.4, "verse": 0.2}, needs=lambda c: c.stems.get("bass") in ("full", "some"))
def bass_pump(cue, sc, t, look, P):
    """Side-chain pump: the outer pair ducks on every beat and swells back (depth from the
    pump lane) while the inner pair runs a two-lamp hat chase, fast when the pace is up."""
    depth, pace, bp = 0.22 + 0.4 * sc.lane("pump", t), sc.lane("pace", t), sc.beat_phase(t)
    c1 = colour_name(cue, sc, t, P)
    c2 = PAIR.get(c1, "white")
    duck = 1.0 - flash(bp, 0.6)
    for a in OUTER:
        look.par[a] = (rgb(c1), min(1.0, 0.06 + depth * duck), 0)
    step = 0.25 if pace >= 1.5 else 0.5
    u = (t - cue.from_s) / (step * sc.beat_s)
    k = int(math.floor(u))
    frac = u - k
    for j, a in enumerate(INNER):
        lvl = 0.08 + (0.5 if (k % 2) == j else 0.25) * (0.5 ** frac)
        look.par[a] = (rgb(c2), min(1.0, lvl), 0)
    look.origin_x = -0.5 if k % 2 == 0 else 0.5


@effect("par", {"breakdown": 0.9, "bridge": 0.5, "outro": 0.3}, needs=lambda c: c.stems.get("drums") == "some")
def half_kit_taps(cue, sc, t, look, P):
    """Half a kit: soft taps on every beat under a slow comet chase."""
    comet_chase(cue, sc, t, look, dict(P, step=P.get("step", 0.5), tail=0.5, peak=0.55))
    tap = 0.3 * kick(sc.beat_phase(t), 0.06, 0.25) * min(1.0, sc.lane("drums", t) * 2)
    for a in rig.PAR_ADDRS:
        col, lvl, s = look.par[a]
        look.par[a] = (col, min(1.0, lvl + tap), s)


@effect("par", {"outro": 1.0})
def fade_collapse(cue, sc, t, look, P):
    """The light collapses inward and cools to deep blue: the outer pair is gone by
    halfway, the inner pair breathes down to nothing, the bass still taps while it lasts."""
    p, bp = progress(cue, t), sc.beat_phase(t)
    col = lerp_rgb(rgb(colour_name(cue, sc, t, dict(P, colour_bars=4))), (0.0, 0.0, 1.0), ease(p))
    breath = 0.5 + 0.5 * math.sin(2 * math.pi * t / (2 * sc.bar_s))
    pulse = 0.2 * flash(bp, 0.5) * (1 - p) if sc.lane("bass", t) > 0.4 else 0.0
    for a in rig.PAR_ADDRS:
        if a in INNER:
            lvl = 0.32 * (1 - p) ** 1.5 * (0.7 + 0.3 * breath) + pulse
        else:
            lvl = 0.28 * max(0.0, 1 - 2 * p) ** 1.5 * (0.7 + 0.3 * breath)
        look.par[a] = (col, min(1.0, lvl), 0)


@effect("par", {"gap": 1.0})
def dark_hold(cue, sc, t, look, P):
    """Near-dark: a whisper of white on every lamp so the rig reads as 'on', nothing else."""
    set_all(look, (1.0, 1.0, 1.0), 0.03)


# --------------------------------------------------------------------- head looks
@effect("head", {"intro": 1.0, "breakdown": 0.8, "outro": 0.5, "verse": 0.3, "gap": 1.0})
def roam_slow(cue, sc, t, look, P):
    """A big slow ellipse round the whole room, flower gobo, colour stepping every two
    bars; brighter as the energy lane rises."""
    energy = sc.lane("energy", t)
    ang = 2 * math.pi * t / 16.0
    look.head = dict(pan=PAN_MID + 110 * math.sin(ang), tilt=TILT_MID + 70 * math.cos(ang),
                     dim=0.3 + 0.3 * min(1.0, energy * 3), colour=colour_name(cue, sc, t, dict(P, colour_bars=2)),
                     gobo=rig.GOBO_FLOWER, prism=0, strobe=0)


@effect("head", {"verse": 1.0, "breakdown": 0.3}, needs=lambda c: c.stems.get("vocals") in ("full", "some"))
def spotlight(cue, sc, t, look, P):
    """A warm open spot drifting gently on the wall, breathing with the vocal lane."""
    v = max(0.0, min(1.0, sc.lane_smooth("vocals", t)))
    lb = lbar(cue, sc, t)
    look.head = dict(pan=rig.PAN_WALL_CENTRE + 7 * math.sin(2 * math.pi * t / (4 * sc.bar_s)),
                     tilt=rig.TILT_WALL + 6 * math.sin(2 * math.pi * t / (3 * sc.bar_s)),
                     dim=0.12 + 0.6 * v, colour=("orange", "yellow")[(lb // 4) % 2], gobo=rig.GOBO_OPEN, prism=0, strobe=0)


@effect("head", {"build": 1.0})
def spiral_rise(cue, sc, t, look, P):
    """A spiral that widens, speeds up and climbs to the ceiling as the build rises; prism
    on for the last stretch."""
    p, bp, lb = progress(cue, t), sc.beat_phase(t), lbar(cue, sc, t)
    w = 2 * math.pi * (t - cue.from_s) * (0.4 + 1.6 * p)
    look.head = dict(pan=PAN_MID + (15 + 110 * p) * math.sin(w), tilt=40 + 170 * ease(p) * (0.6 + 0.4 * math.cos(w)),
                     dim=(0.5 + 0.5 * p) * (0.6 + 0.4 * flash(bp, 0.4)), colour=colour_name(cue, sc, t, P),
                     gobo=GOBOS[lb % len(GOBOS)], prism=rig.PRISM_6 if p > 0.85 else 0, strobe=0)


@effect("head", {"drop": 1.0, "final_drop": 1.0})
def room_patterns(cue, sc, t, look, P):
    """Room-wide motion that changes pattern every bar (full sweep with tilt kicks, corner
    snaps, fast figure-8), faster with intensity; prism on in the big drops."""
    I, lb, tl = cue.intensity, lbar(cue, sc, t), t - cue.from_s
    bp, bi = sc.beat_phase(t), sc.beat_index(t)
    rate = 1.0 + I
    pat = (lb + cue.drop_no) % 3
    if pat == 0:
        sweep = 1 - abs(2 * ((tl * rate / sc.bar_s) % 1.0) - 1)
        pan, tilt = 5 + 245 * sweep, 40 + 185 * kick(bp)
    elif pat == 1:
        pan = 30 if bi % 2 == 0 else 225
        tilt = 60 + 150 * ((bi // 2) % 2) + 30 * kick(bp) * (1 if bi % 2 else -1)
    else:
        w = 2 * math.pi * tl * rate / sc.bar_s
        pan, tilt = PAN_MID + 120 * math.sin(w), TILT_MID + 95 * math.sin(2 * w)
    look.head = dict(pan=pan, tilt=tilt, dim=0.85 + 0.15 * flash(bp, 0.5), colour=colour_name(cue, sc, t, P),
                     gobo=GOBOS[(bi // 2) % len(GOBOS)], prism=rig.PRISM_6 if I > 0.6 else 0, strobe=0)


@effect("head", {"drop": 0.7, "final_drop": 0.5})
def figure8(cue, sc, t, look, P):
    """A fast figure-8 through the whole room, prism on, gobo changing every two beats."""
    tl, bp, bi = t - cue.from_s, sc.beat_phase(t), sc.beat_index(t)
    w = 2 * math.pi * tl * (1.0 + cue.intensity) / sc.bar_s
    look.head = dict(pan=PAN_MID + 120 * math.sin(w), tilt=TILT_MID + 95 * math.sin(2 * w),
                     dim=0.85 + 0.15 * flash(bp, 0.5), colour=colour_name(cue, sc, t, P),
                     gobo=GOBOS[(bi // 2) % len(GOBOS)], prism=rig.PRISM_6, strobe=0)


@effect("head", {"drop": 0.6, "final_drop": 0.7})
def corner_snaps(cue, sc, t, look, P):
    """Snaps between the far corners of the room on every beat, the tilt kicking with the kick."""
    bp, bi, lb = sc.beat_phase(t), sc.beat_index(t), lbar(cue, sc, t)
    pan = 30 if bi % 2 == 0 else 225
    tilt = 60 + 150 * ((bi // 2) % 2) + 30 * kick(bp) * (1 if bi % 2 else -1)
    look.head = dict(pan=pan, tilt=tilt, dim=0.8 + 0.2 * flash(bp, 0.4), colour=colour_name(cue, sc, t, P),
                     gobo=GOBOS[lb % len(GOBOS)], prism=rig.PRISM_6 if cue.intensity > 0.6 else 0, strobe=0)


@effect("head", {"bridge": 1.0, "intro": 0.4, "breakdown": 0.4, "drop": 0.2})
def sweep_locked(cue, sc, t, look, P):
    """The head's spot follows the PAR gesture along the wall (the chase position or the
    hit origin), so the rig moves as one instrument; tilt kicks lightly on the beat."""
    x = max(-1.0, min(1.0, look.origin_x)) * X_OUTER_CM
    bp = sc.beat_phase(t)
    look.head = dict(pan=rig.pan_for_x(x), tilt=rig.TILT_WALL + 25 * kick(bp, 0.3, 0.3),
                     dim=(0.35 + 0.45 * flash(bp, 0.5)) * (0.5 + 0.5 * cue.intensity),
                     colour=PAIR.get(colour_name(cue, sc, t, P), "white"),
                     gobo=rig.GOBO_OPEN, prism=0, strobe=0)


@effect("head", {"breakdown": 0.7, "bridge": 0.5, "verse": 0.2})
def spot_per_bar(cue, sc, t, look, P):
    """Jumps to a new spot in the room every bar (the move itself is the downbeat); the
    tilt kicks on every beat; dim breathes with the beat."""
    lb, bp = lbar(cue, sc, t), sc.beat_phase(t)
    look.head = dict(pan=PAN_MID + 115 * math.sin(lb * 2.4), tilt=70 + 120 * ((lb // 2) % 2) + 40 * kick(bp, 0.3, 0.3),
                     dim=0.3 + 0.7 * flash(bp, 0.4), colour=colour_name(cue, sc, t, dict(P, colour_bars=2)),
                     gobo=rig.GOBO_OPEN, prism=0, strobe=0)


@effect("head", {"breakdown": 0.6, "bridge": 0.3}, needs=lambda c: c.brightness_min < 0.5)
def head_bloom(cue, sc, t, look, P):
    """Follows the brightness lane like brightness_follow does for the PARs: a dim spot
    low on the wall while the filter is closed, climbing towards the ceiling and opening
    to white as the record brightens."""
    b = max(0.0, min(1.0, sc.lane_smooth("brightness", t)))
    drift = 25 * math.sin(2 * math.pi * t / (4 * sc.bar_s))
    look.head = dict(pan=rig.PAN_WALL_CENTRE + drift, tilt=rig.TILT_WALL + (rig.TILT_UP - rig.TILT_WALL) * ease(b),
                     dim=0.08 + 0.7 * b, colour="white" if b > 0.8 else colour_name(cue, sc, t, dict(P, colour_bars=4)),
                     gobo=rig.GOBO_OPEN if b > 0.5 else rig.GOBO_FLOWER, prism=0, strobe=0)


@effect("head", {"outro": 1.0, "gap": 0.5})
def park_fade(cue, sc, t, look, P):
    """Drifts back to the wall centre and up to the park position, dimming to nothing."""
    p = progress(cue, t)
    ang = 2 * math.pi * t / 16.0
    pan, tilt = PAN_MID + 110 * math.sin(ang), TILT_MID + 70 * math.cos(ang)
    look.head = dict(pan=rig.PAN_WALL_CENTRE + (pan - rig.PAN_WALL_CENTRE) * (1 - p), tilt=tilt + (rig.TILT_UP - tilt) * ease(p),
                     dim=0.4 * (1 - p), colour=colour_name(cue, sc, t, dict(P, colour_bars=4)), gobo=rig.GOBO_FLOWER, prism=0, strobe=0)


# --------------------------------------------------------------------- events
# Rendered after the looks, in EVENT_ORDER; later ones win.
EVENT_ORDER = ("break_blackout", "strobe_pops", "strobe_accelerate", "wheel_spin_tail",
               "highlight_flare", "release_accent", "pause_hold", "white_finale", "drop_hit",
               "pre_drop_blackout")


@effect("event", {r: 1.0 for r in ROLES if r not in ("drop", "final_drop")},
        needs=lambda c: c.next_role in ("drop", "final_drop"))
def pre_drop_blackout(cue, sc, t, look, P):
    """The last beat before a drop is total darkness; the head is pre-aimed at the wall on
    white with the prism ready so the hit bursts out of nothing."""
    if cue.to_s - t <= sc.beat_s * float(P.get("beats", 1.0)):
        set_all(look, (0.0, 0.0, 0.0), 0.0)
        look.head = dict(pan=PAN_MID, tilt=rig.TILT_WALL, dim=0.0, colour="white", gobo=0, prism=rig.PRISM_6, strobe=0)


@effect("event", {"drop": 1.0, "final_drop": 1.0})
def drop_hit(cue, sc, t, look, P):
    """The first beat of a drop: every PAR white at full, the head at full on white,
    flung to a far corner - the release lands ON the beat."""
    if t - cue.from_s < sc.beat_s:
        set_all(look, (1.0, 1.0, 1.0), 1.0)
        look.head = dict(pan=250 if cue.drop_no % 2 else 5, tilt=220, dim=1.0, colour="white", gobo=0, prism=rig.PRISM_6, strobe=0)


@effect("event", {"drop": 1.0, "final_drop": 1.0}, needs=lambda c: bool(c.breaks))
def break_blackout(cue, sc, t, look, P):
    """'A bar out, then back': the dropout bar goes black, the lamps creep back in one by
    one from the outside, and the re-entry beat bursts white. The head goes dark but holds
    its pose."""
    for b0, b1, reenter in cue.breaks:
        if b0 <= t < b1:
            u = (t - b0) / (b1 - b0)
            for j, a in enumerate((rig.PAR_ADDRS[0], rig.PAR_ADDRS[3], rig.PAR_ADDRS[1], rig.PAR_ADDRS[2])):
                look.par[a] = ((0.8, 0.9, 1.0), 0.22 if u >= 0.5 + 0.11 * j else 0.0, 0)
            look.head["dim"] = 0.0
            look.head["strobe"] = 0
            look.hold_head = True
        elif reenter and b1 <= t < b1 + 0.5 * sc.beat_s:
            set_all(look, (1.0, 1.0, 1.0), 1.0)
            look.head["dim"] = 1.0
            look.head["colour"] = "white"


@effect("event", {"drop": 1.0, "final_drop": 1.0})
def strobe_pops(cue, sc, t, look, P):
    """Short strobe pops on the downbeats, on beat 3 as well when the drop is big, and on
    the head too in the final drop. Never on the hit beat itself."""
    if t - cue.from_s < sc.beat_s:
        return
    bib, bp = sc.beat_in_bar(t), sc.beat_phase(t)
    if bp < 0.2 and (bib == 0 or (cue.intensity >= 0.8 and bib == 2)):
        for a in rig.PAR_ADDRS:
            c, l, _ = look.par[a]
            look.par[a] = (c, l, 220)
        if cue.final and bib == 0:
            look.head["strobe"] = 200


@effect("event", {"build": 1.0})
def strobe_accelerate(cue, sc, t, look, P):
    """The last two bars of a build: PAR strobe accelerating from slow to fast, the head
    strobing with the prism in the final bar."""
    left = cue.to_s - t
    span = float(P.get("bars", 2)) * sc.bar_s
    if 0 <= left <= span:
        q = 1 - left / span
        for a in rig.PAR_ADDRS:
            c, l, _ = look.par[a]
            look.par[a] = (c, l, int(30 + 200 * q))
        if q > 0.5:
            look.head["strobe"] = 150
            look.head["prism"] = rig.PRISM_6


@effect("event", {"final_drop": 1.0}, needs=lambda c: c.bars >= 12)
def wheel_spin_tail(cue, sc, t, look, P):
    """The colour wheel spins continuously through the four bars before the finale (final
    drops of twelve bars or more); earlier drops keep their chord colours so the finale
    still has somewhere to go."""
    left = cue.to_s - t
    if sc.bar_s < left <= 5 * sc.bar_s:
        look.head["colour"] = SPIN


@effect("event", {"final_drop": 1.0})
def white_finale(cue, sc, t, look, P):
    """The last bar of the final drop: white strobe on every lamp, the colour wheel
    spinning, the head circling at full with the prism and its own strobe."""
    if cue.to_s - t <= sc.bar_s:
        set_all(look, (1.0, 1.0, 1.0), 1.0, 220)
        w = 2 * math.pi * (t - cue.from_s) * 3 / sc.bar_s
        look.head = dict(pan=PAN_MID + 125 * math.sin(w), tilt=TILT_MID + 100 * math.cos(w), dim=1.0, colour=SPIN,
                         gobo=0, prism=rig.PRISM_6, strobe=200)


@effect("event", {r: 1.0 for r in ROLES}, needs=lambda c: any(m.is_ == "pause" for m in c.moments))
def pause_hold(cue, sc, t, look, P):
    """A 'pause' moment (everything stops but one part) for exactly its `for_beats`: the rig
    goes dark but for the part still playing. If the voice is what is left (still=['voice'])
    the inner pair holds the voice's colour and follows the vocal lane; otherwise one inner
    lamp breathes deep blue. The head goes dark and holds its pose -- the drop bursts out of
    this hole."""
    for m in cue.moments:
        # only an "everything but X" pause is a hole; a lone stem dropout (pause 'drums') is
        # not a blackout -- the rest of the mix keeps playing, so the base look continues.
        hole = bool(m.still) or (m.what or "").startswith("everything")
        if m.is_ == "pause" and hole and m.t_s <= t < m.to_s:
            voice = any(v in ("voice", "vocals") for v in m.still)
            if voice:
                v = max(0.0, min(1.0, sc.lane_smooth("vocals", t)))
                col = rgb(colour_name(cue, sc, t, dict(P, palette=P.get("still_palette", "warm"), colour_bars=16)))
                for a in rig.PAR_ADDRS:
                    look.par[a] = (col, min(1.0, 0.12 + 0.72 * v) if a in INNER else 0.0, 0)
            else:
                keep = INNER[sc.bar_at(t) % 2]
                for a in rig.PAR_ADDRS:
                    lvl = (0.16 + 0.08 * math.sin(2 * math.pi * (t - m.t_s) / sc.bar_s)) if a == keep else 0.0
                    look.par[a] = (DEEP_BLUE, lvl, 0)
            look.head["dim"] = 0.0
            look.head["strobe"] = 0
            look.hold_head = True


@effect("event", {r: 1.0 for r in ROLES}, needs=lambda c: any(m.is_ == "highlight" for m in c.moments))
def highlight_flare(cue, sc, t, look, P):
    """A 'highlight' moment (a vocal run, the voice at full reach): a white bloom across
    whatever the base look is drawing, brightest at the mark and decaying over the
    highlight's length, with the head lifting to meet it. It rides on top; it claims no
    colour of its own."""
    for m in cue.moments:
        span = max(m.for_beats, 1.0) * sc.beat_s
        if m.is_ == "highlight" and m.t_s <= t < m.t_s + span:
            g = flash((t - m.t_s) / span, 0.5)
            for a in rig.PAR_ADDRS:
                col, l, strobe = look.par[a]
                look.par[a] = (mix(col, 1.0, 0.6 * g), min(1.0, l + 0.5 * g), strobe)
            look.head["dim"] = max(look.head["dim"], 0.55 + 0.45 * g)


@effect("event", {r: 1.0 for r in ROLES}, needs=lambda c: any(m.is_ == "release" for m in c.moments))
def release_accent(cue, sc, t, look, P):
    """A 'release' moment: a short white bloom and head lift ON the release beat, so the
    tension lets go on the beat, not after it. A drop's own hit (drop_hit) overrides it when
    they land together, so it shows for a release inside a build or verse."""
    for m in cue.moments:
        if m.is_ == "release" and 0.0 <= t - m.t_s < sc.beat_s:
            g = flash((t - m.t_s) / sc.beat_s, 0.4)
            for a in rig.PAR_ADDRS:
                col, l, strobe = look.par[a]
                look.par[a] = (mix(col, 1.0, 0.7 * g), min(1.0, l + 0.6 * g), strobe)
            look.head["dim"] = max(look.head["dim"], 0.3 + 0.6 * g)


def catalogue():
    """One line per effect, for the README / a picker UI."""
    rows = []
    for layer in LAYERS:
        for e in by_layer(layer):
            suits = ", ".join(f"{r} {w:g}" for r, w in e.suits.items() if w > 0)
            rows.append(f"{layer:5s} {e.name:18s} [{suits}]  {e.doc.splitlines()[0] if e.doc else ''}")
    return rows
