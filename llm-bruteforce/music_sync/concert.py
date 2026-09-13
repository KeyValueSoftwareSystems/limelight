"""Timeline-driven concert renderer for the universe-0 rig (4 PARs on an arc + moving head).

A Timeline is a list of phases {start, end, phase} at a fixed BPM. `render()` turns it
into 41-channel frames (ch1-41) at `fps`, one row per frame:
  PARs @1 @8 @15 @22 (7-ch: dim R G B strobe prog speed), head @29 (13-ch, see rig.py).

Phases: intro, verse, build, drop, anthem, breakdown, outro, gap.
The last beat before any drop is a total blackout (head pre-aimed, wheel on white).
Spatial model: PAR positions along the arc x = -1, -0.53, +0.53, +1; head at 0.
Head: whole-room motion (pan 0-255, tilt 0-255), slew-limited so the stream never jumps;
macro/unused/reset channels always 0.
"""
import math
from dataclasses import dataclass

import numpy as np

import rig

GAMMA = 1.6
PAR_X = {a: rig.par_wall_x(a) / rig.par_wall_x(rig.PAR_ADDRS[-1]) for a in rig.PAR_ADDRS}   # -1..1
INNER, OUTER = (8, 15), (1, 22)
PAN_SPAN = 24                    # DMX either side of the wall centre (~±50°) — only the pre-drop aim uses it now
PAN_MAX_STEP = 7                 # DMX per frame at 40 fps: our targets may move up to 280 DMX/s;
TILT_MAX_STEP = 7                # the fixture's own motors cap the real speed, the stream never jumps
PAN_MID, TILT_MID = 127, 127     # room centre: pan straight ahead of the wall, tilt straight up
X_OUTER_CM = rig.par_wall_x(rig.PAR_ADDRS[-1])
COOL = ["blue", "light blue", "white", "pink"]
DROP = ["light blue", "white", "pink", "blue"]
ANTHEM = ["white", "light blue", "pink", "blue"]
CALM = ["blue", "light blue"]
WHEEL = [name for name, _, _ in rig.COLOURS]          # head steps the wheel one slot at a time (no blanking)
GOBOS = [rig.GOBO_OPEN, 40, rig.GOBO_FLOWER, 120]     # four gobo slots of the stepped wheel
SPIN = "spin"                    # colour-wheel continuous rotation (value >= 150)
COLOUR_INDEX = {name: i for i, (name, _, _) in enumerate(rig.COLOURS)}
COLOUR_INDEX[SPIN] = len(rig.COLOURS)
PRE_DROP_BLACKOUT_BEATS = 1.0    # the last beat before any drop is fully dark


def colour_value(name):
    return 170 if name == SPIN else rig.COLOUR_BY_NAME[name][0]


# ----------------------------------------------------------------- time helpers
@dataclass
class BeatGrid:
    bpm: float

    @property
    def beat(self): return 60.0 / self.bpm

    @property
    def bar(self): return 4 * self.beat

    @property
    def bpm_(self): return self.bpm

    def beat_index(self, t): return int(math.floor(t / self.beat + 1e-9))
    def beat_phase(self, t): return (t / self.beat) % 1.0
    def bar_index(self, t): return int(math.floor(t / self.bar + 1e-9))
    def bar_phase(self, t): return (t / self.bar) % 1.0


def beat_grid(bpm): return BeatGrid(bpm)


class BeatList:
    """Grid from real beat/downbeat times (librosa). Extrapolates with the median
    interval before the first / after the last beat."""

    def __init__(self, beats, downbeats):
        self.beats = np.asarray(sorted(beats), dtype=float)
        self.downbeats = np.asarray(sorted(downbeats), dtype=float)
        self._beat = float(np.median(np.diff(self.beats))) if len(self.beats) > 1 else 0.5
        self._bar = float(np.median(np.diff(self.downbeats))) if len(self.downbeats) > 1 else 4 * self._beat

    @property
    def beat(self): return self._beat

    @property
    def bar(self): return self._bar

    @property
    def bpm(self): return 60.0 / self._beat

    @staticmethod
    def _index_phase(times, step, t):
        i = int(np.searchsorted(times, t, side="right")) - 1
        if i < 0:
            k = math.floor((t - times[0]) / step)             # negative
            return k, ((t - times[0]) / step) - k
        if i >= len(times) - 1:
            k = math.floor((t - times[-1]) / step)
            return i + k, ((t - times[-1]) / step) - k
        return i, (t - times[i]) / (times[i + 1] - times[i])

    def beat_index(self, t): return self._index_phase(self.beats, self._beat, t)[0]
    def beat_phase(self, t): return self._index_phase(self.beats, self._beat, t)[1]
    def bar_index(self, t): return self._index_phase(self.downbeats, self._bar, t)[0]
    def bar_phase(self, t): return self._index_phase(self.downbeats, self._bar, t)[1]


@dataclass
class Phase:
    start: float
    end: float
    name: str

    def progress(self, t): return min(1.0, max(0.0, (t - self.start) / max(self.end - self.start, 1e-9)))


class Timeline:
    def __init__(self, bpm=None, phases=(), grid=None):
        self.grid = grid if grid is not None else BeatGrid(float(bpm))
        self.bpm = float(bpm) if bpm is not None else self.grid.bpm
        self.phases = sorted((Phase(float(p["start"]), float(p["end"]), p["phase"]) for p in phases), key=lambda p: p.start)

    @property
    def duration(self): return max(p.end for p in self.phases)

    def phase_at(self, t):
        for p in self.phases:
            if p.start <= t < p.end:
                return p
        return None


# ----------------------------------------------------------------- envelopes
def flash(phase01, decay=0.5):
    """1 at the beat, exponential decay to 5% at `decay` beats."""
    return 0.05 ** (phase01 / decay)


def bump(x, centre, width):
    return math.exp(-0.5 * ((x - centre) / width) ** 2)


def ease(p):
    return p * p * (3 - 2 * p)


def mix(rgb, white, amount):
    return tuple(c * (1 - amount) + white * amount for c in rgb)


def rgb_of(name, t=0.0):
    if name == SPIN:                                       # PARs mimic the spinning wheel: fast hue cycle
        import colorsys
        return colorsys.hsv_to_rgb((t * 1.5) % 1.0, 1.0, 1.0)
    return rig.COLOUR_BY_NAME[name][1]


# ----------------------------------------------------------------- head state
class HeadState:
    """Slew-limits pan/tilt so the head never jumps."""

    def __init__(self, fps):
        self.fps = fps
        self.pan = None
        self.tilt = None
        self.colour = None
        self.blank_left = 0

    def step(self, pan, tilt, dim, colour, gobo, prism, strobe):
        if self.pan is None:
            self.pan, self.tilt = float(pan), float(tilt)
        self.pan += max(-PAN_MAX_STEP, min(PAN_MAX_STEP, pan - self.pan))
        self.tilt += max(-TILT_MAX_STEP, min(TILT_MAX_STEP, tilt - self.tilt))
        self.colour = colour                 # wheel travel is visible; the user found the dimmer blink distracting
        return {"pan": self.pan, "tilt": self.tilt, "dim": dim, "colour_val": colour_value(colour),
                "gobo": gobo, "prism": prism, "strobe": strobe}


# ----------------------------------------------------------------- per-phase looks
def kick(bphase, hold=0.45, fall=0.3):
    """1 while the beat is fresh, then falls: tilt kicks and hard hits."""
    return 1.0 if bphase < hold else flash(bphase - hold, fall)


def look(phase, t, g, n_bars_in_phase=None, drop_no=1):
    """Return (par: {addr: (rgb, level, strobe)}, head: dict) for time t in `phase`.
    The head is free: its colours, gobos and motion are independent of the PARs."""
    p = phase.progress(t)
    tl = t - phase.start
    bar, bph, beat, bphase = g.bar_index(t), g.bar_phase(t), g.beat_index(t), g.beat_phase(t)
    lbar = max(0, g.bar_index(t) - g.bar_index(phase.start + 1e-6))
    par, head = {}, {}
    n = phase.name
    C = rig.PAN_WALL_CENTRE
    wheel = lambda k: WHEEL[k % len(WHEEL)]
    gobo_of = lambda k: GOBOS[k % len(GOBOS)]

    if n in ("intro", "outro"):
        fade = (1 - p) if n == "outro" else 1.0
        floor = 0.25 + 0.25 * (0.5 + 0.5 * math.sin(2 * math.pi * t / g.bar))
        swap = (bar // 2) % 2
        for a in rig.PAR_ADDRS:
            inner = a in INNER
            par[a] = (rgb_of(CALM[(inner + swap) % 2]), floor * fade, 0)
        ang = 2 * math.pi * t / 16.0                              # big slow circle round the whole room
        pan, tilt = PAN_MID + 110 * math.sin(ang), TILT_MID + 70 * math.cos(ang)
        if n == "outro":
            pan, tilt = C + (pan - C) * (1 - p), tilt + (rig.TILT_UP - tilt) * ease(p)
        head = dict(pan=pan, tilt=tilt, dim=0.45 * fade, colour=wheel(3 + bar // 2), gobo=rig.GOBO_FLOWER, prism=0, strobe=0)

    elif n == "verse":
        col = COOL[(beat // 2) % len(COOL)]
        direction = 1 if bar % 2 == 0 else -1
        floor = 0.28
        for a in rig.PAR_ADDRS:
            pos = (PAR_X[a] * direction + 1) / 2
            delay = 0.08 + 0.55 * pos
            lvl = floor + 0.72 * bump(bphase, delay, 0.08) + 0.18 * bump(bphase, 0.5 + 0.55 * (1 - pos) * 0.5, 0.06)
            par[a] = (rgb_of(col), min(1.0, lvl), 0)
        head = dict(pan=PAN_MID + 115 * math.sin(2 * math.pi * t / 5.3),        # room-wide figure
                    tilt=TILT_MID + 85 * math.sin(2 * math.pi * t / 3.7),
                    dim=0.6 + 0.4 * flash(bphase, 0.5), colour=wheel(bar), gobo=gobo_of(bar // 2), prism=0, strobe=0)

    elif n == "build":                                            # every beat hits; floor and motion rise
        col = COOL[bar % len(COOL)]
        whiten = ease(p)
        floor = 0.15 + 0.35 * p
        strobe = int(30 + 220 * (p - 0.7) / 0.3) if p > 0.7 else 0
        for a in rig.PAR_ADDRS:
            lvl = floor + (1 - floor) * kick(bphase, 0.08, 0.3)     # hard hit on every beat
            par[a] = (mix(rgb_of(col), 1.0, whiten), min(1.0, lvl), strobe)
        w = 2 * math.pi * t * (0.4 + 1.6 * p)                      # spiral: faster and wider as it rises
        head = dict(pan=PAN_MID + (15 + 110 * p) * math.sin(w), tilt=40 + 170 * ease(p) * (0.6 + 0.4 * math.cos(w)),
                    dim=(0.5 + 0.5 * p) * (0.6 + 0.4 * flash(bphase, 0.4)), colour=wheel(bar), gobo=gobo_of(bar),
                    prism=rig.PRISM_6 if p > 0.85 else 0, strobe=150 if p > 0.88 else 0)

    elif n == "drop":
        first_beat = tl < g.beat
        last_bar = n_bars_in_phase is not None and lbar >= n_bars_in_phase - 1
        big = drop_no >= 2
        finale = big and last_bar
        col = SPIN if (last_bar and not big) else DROP[(beat // 2 if big else lbar) % len(DROP)]
        col2 = DROP[((beat // 2 if big else lbar) + 2) % len(DROP)]
        flip = (lbar // 2) % 2
        on_pair = INNER if ((beat + flip) % 2 == 0) else OUTER
        downbeat = beat % 4 == 0
        pop = (downbeat or (big and beat % 2 == 0)) and bphase < 0.22 and not first_beat
        for a in rig.PAR_ADDRS:
            if first_beat:
                par[a] = ((1, 1, 1), 1.0, 0); continue
            if finale:
                par[a] = ((1, 1, 1), 1.0, 220); continue
            if big:                                                 # every beat, both pairs, two colours
                c = col if a in INNER else col2
                lvl = 0.6 + 0.4 * flash(bphase, 0.5) + 0.4 * bump(bphase, 0.5, 0.05)
                if downbeat and bphase < 0.15:
                    c = (1, 1, 1)
                par[a] = (c if isinstance(c, tuple) else rgb_of(c, t), min(1.0, lvl), 220 if pop else 0)
            else:
                hit = 1.0 if (a in on_pair or downbeat) else 0.0
                ghost = 0.35 * bump(bphase, 0.5, 0.05) if a not in on_pair else 0.0
                lvl = 0.55 + 0.45 * hit * flash(bphase, 0.55) + ghost
                par[a] = (rgb_of(col, t), min(1.0, lvl), 220 if pop else 0)
        # motion = energy: room-wide, fast, different every bar; faster still when big
        pat = (lbar + (1 if big else 0)) % 3
        rate = 2.0 if big else 1.0
        if first_beat:                                          # burst out of the blackout
            pan, tilt = 250 if (drop_no % 2) else 5, 220
        elif pat == 0:                                          # full-width sweep, tilt kicking
            sweep = 1 - abs(2 * ((tl * rate / g.bar) % 1.0) - 1)
            pan, tilt = 5 + 245 * sweep, 40 + 185 * kick(bphase)
        elif pat == 1:                                          # snap between far corners on every beat
            k = beat if big else beat // 1
            pan = 30 if k % 2 == 0 else 225
            tilt = 60 + 150 * ((k // 2) % 2) + 30 * kick(bphase) * (1 if k % 2 else -1)
        else:                                                   # fast figure-8 through the whole room
            w = 2 * math.pi * tl * rate / g.bar
            pan, tilt = PAN_MID + 120 * math.sin(w), TILT_MID + 95 * math.sin(2 * w)
        if finale:
            w = 2 * math.pi * tl * 3 / g.bar
            pan, tilt = PAN_MID + 125 * math.sin(w), TILT_MID + 100 * math.cos(w)
        hcol = SPIN if (finale or (big and lbar % 4 == 3) or (last_bar and not big)) else wheel(1 + (beat // 2 if big else lbar) * 3)
        head = dict(pan=pan, tilt=tilt,
                    dim=1.0 if (first_beat or finale) else 0.85 + 0.15 * flash(bphase, 0.5),
                    colour="white" if first_beat else hcol,
                    gobo=gobo_of((beat // 2) if big else (lbar % 2) * 2), prism=rig.PRISM_6,
                    strobe=200 if (finale or (big and downbeat and bphase < 0.2 and not first_beat)) else 0)

    elif n == "anthem":
        col = ANTHEM[lbar % len(ANTHEM)]
        col2 = ANTHEM[(lbar + 1) % len(ANTHEM)]
        pop = beat % 4 == 0 and bphase < 0.2 and p > 0.5
        for a in rig.PAR_ADDRS:
            c = col if a in INNER else col2
            lvl = 0.6 + 0.4 * flash(bphase, 0.5) + 0.3 * bump(bphase, 0.5, 0.05)
            par[a] = (rgb_of(c), min(1.0, lvl), 220 if pop else 0)
        sweep = 1 - abs(2 * ((tl / g.bar) % 1.0) - 1)              # wall to wall every bar
        head = dict(pan=10 + 235 * sweep,
                    tilt=TILT_MID + 80 * math.sin(2 * math.pi * tl / (2 * g.bar)) + 25 * kick(bphase),
                    dim=0.65 + 0.35 * flash(bphase, 0.5), colour=SPIN if p > 0.5 else wheel(5 + lbar),
                    gobo=gobo_of(lbar // 2), prism=rig.PRISM_6, strobe=0)

    elif n == "breakdown":                                        # "where are you now": every beat lands
        swap = lbar % 2
        for a in rig.PAR_ADDRS:
            inner = a in INNER
            col = "blue" if inner ^ swap else "pink"
            lvl = 0.12 + 0.88 * kick(bphase, 0.08, 0.3)
            if p > 0.5:
                lvl += 0.3 * bump(bphase, 0.5, 0.05)
            par[a] = (rgb_of(col), min(1.0, lvl), 0)
        # a new spot in the room every bar (the move itself is the downbeat), tilt kicks on every beat
        spot_pan = PAN_MID + 115 * math.sin(lbar * 2.4)
        spot_tilt = 70 + 120 * ((lbar // 2) % 2)
        head = dict(pan=spot_pan, tilt=spot_tilt + 40 * kick(bphase, 0.3, 0.3),
                    dim=0.3 + 0.7 * flash(bphase, 0.4), colour=wheel(3 + lbar // 2), gobo=0, prism=0, strobe=0)

    else:                                                         # gap / unknown
        for a in rig.PAR_ADDRS:
            par[a] = ((1, 1, 1), 0.03, 0)
        head = dict(pan=C, tilt=90, dim=0.0, colour="white", gobo=0, prism=0, strobe=0)

    return par, head


# ----------------------------------------------------------------- render
def render(timeline, fps=40):
    g = timeline.grid
    n = int(math.ceil(timeline.duration * fps))
    frames = np.zeros((n, 41), dtype=np.uint8)
    hs = HeadState(fps)
    phases = timeline.phases
    drop_no = {}
    k = 0
    for q in phases:
        if q.name == "drop":
            k += 1; drop_no[id(q)] = k
    for i in range(n):
        t = i / fps
        phase = timeline.phase_at(t)
        if phase is None:
            phase = Phase(t, t + 1, "gap")
        nxt = next((q for q in phases if q.start >= phase.end), None)
        n_bars = max(1, int(round((phase.end - phase.start) / g.bar)))
        par, head = look(phase, t, g, n_bars, drop_no.get(id(phase), 1))
        if nxt is not None and nxt.name == "drop" and phase.name != "drop" \
                and nxt.start - t <= PRE_DROP_BLACKOUT_BEATS * g.beat:
            par = {a: ((0, 0, 0), 0.0, 0) for a in rig.PAR_ADDRS}
            head = dict(pan=PAN_MID, tilt=40, dim=0.0, colour="white", gobo=0, prism=rig.PRISM_6, strobe=0)
        f = [0] * 512
        for a, (rgb, lvl, strobe) in par.items():
            enc = tuple(max(0.0, min(1.0, c * lvl)) ** GAMMA for c in rgb)
            rig.set_par(f, a, enc, 1.0, 255)
            f[a - 1 + rig.PAR_STROBE] = int(strobe)
        h = hs.step(**head)
        rig.set_head(f, h["pan"], h["tilt"], 255 * h["dim"], h["colour_val"], h["gobo"], h["prism"],
                     rig.SPEED_FAST, h["strobe"])
        frames[i] = f[:41]
    meta = {"bpm": timeline.bpm, "fps": fps, "duration": timeline.duration,
            "phases": [{"start": p.start, "end": p.end, "phase": p.name} for p in timeline.phases]}
    return frames, meta


C_PARK = rig.PAN_WALL_CENTRE


def park_frame():
    return rig.park_frame()
