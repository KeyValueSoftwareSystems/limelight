"""arrange.py - from a score to cues, and from cues to a plan of effects.

build_cues(score) reads the sections and turns them into Cues the effects understand:
roles (a rising section right before a drop becomes a `build`, the last drop is the
`final_drop`), drop numbering and an intensity that escalates drop by drop, the
"a bar out, then back" dropout bars inside a drop (`breaks`), the moments that fall in
each cue, and the lane statistics some effects key on.

plan(score, seed) draws one PAR look and one head look per cue from the library with a
seeded random, weighted by how well each effect suits the cue's role, filtered by what
the effect needs from the score. Material the score marks as the same (`like`) gets the
same looks again so the audience recognises it; events (blackouts, hits, pops, finale,
pause) are attached by rule, never by chance. The result is a list of Cues a renderer
can play and a plan file a human can edit.
"""
import random
import statistics
from dataclasses import dataclass, field, asdict

from effects import LIBRARY, EVENT_ORDER
from score import DROP_NAMES

ROLE_PALETTE = {"intro": "gold", "verse": "warm", "build": "cool", "drop": "chord", "final_drop": "chord",
                "breakdown": "cool", "bridge": "chord", "outro": "cool", "gap": "cool"}
BUILD_MAX_BARS = 8
BREAK_RATIO = 0.45              # a bar with energy below this fraction of the drop's median is a dropout
# section names the pipeline emits that aren't one of the nine lit roles, mapped to the
# closest one that effects suit (display keeps the original name; only role_key normalises)
ROLE_ALIAS = {"post-chorus": "bridge", "postchorus": "bridge", "pre-chorus": "build",
              "prechorus": "build", "refrain": "verse", "anthem": "drop", "hook": "drop"}


@dataclass
class Cue:
    role: str
    from_s: float
    to_s: float
    from_bar: int
    to_bar: int
    nth: int = 1
    like: str = None
    rise: float = 0.0
    energy: float = 0.0
    fullness: float = 0.0
    stems: dict = field(default_factory=dict)
    drop_no: int = 0
    n_drops: int = 0
    final: bool = False
    intensity: float = 0.5
    prev_role: str = None
    next_role: str = None
    breaks: list = field(default_factory=list)          # (from_s, to_s, reenter)
    moments: list = field(default_factory=list)
    brightness_min: float = 1.0
    par: str = None
    head: str = None
    events: list = field(default_factory=list)
    params: dict = field(default_factory=dict)

    @property
    def bars(self): return max(1, self.to_bar - self.from_bar)

    @property
    def role_key(self):
        if self.role in DROP_NAMES and self.final:
            return "final_drop"
        r = ROLE_ALIAS.get(self.role, self.role)
        return "drop" if r in DROP_NAMES else r

    def contains(self, t): return self.from_s <= t < self.to_s

    def describe(self):
        return {"role": self.role, "role_key": self.role_key, "from_s": round(self.from_s, 3), "to_s": round(self.to_s, 3),
                "from_bar": self.from_bar, "to_bar": self.to_bar, "nth": self.nth, "like": self.like,
                "intensity": round(self.intensity, 3), "par": self.par, "head": self.head,
                "events": list(self.events), "params": dict(self.params),
                "breaks": [[round(a, 3), round(b, 3), r] for a, b, r in self.breaks],
                "moments": [m.is_ for m in self.moments]}


def _rise_signal_bar(sc, from_bar, to_bar):
    """The earliest bar in [from_bar, to_bar) the score marks as a rise/build, if any."""
    bars = [s.bar for s in sc.signals if s.is_ in ("rise", "build") and from_bar <= s.bar < to_bar]
    return min(bars) if bars else None


def _pace_climbs(sc, cue):
    """Pace higher at the end of the section than a bar before it -- a build the energy
    curve is too flat to show. dont-look-down is the case this is written for."""
    end = sc.lane_bar("pace", cue.to_bar - 1)
    mid = sc.lane_bar("pace", max(cue.from_bar, cue.to_bar - 4))
    return end - mid > 0.3


def _is_rising(sc, cue):
    phr = [p for p in sc.phrases if cue.from_bar <= p.from_bar < cue.to_bar][-1:]
    hook = any(m.is_ == "hook" and cue.from_bar <= m.bar < cue.to_bar for m in sc.moments)
    intens = any((p.doing in ("intensifying", "expanding")) or ("intensifying" in p.also) for p in phr)
    return (cue.rise > 0.15 or intens or hook
            or _rise_signal_bar(sc, cue.from_bar, cue.to_bar) is not None
            or _pace_climbs(sc, cue))


def build_cues(sc, build_max_bars=BUILD_MAX_BARS):
    cues = []
    for s in sc.sections:
        cues.append(Cue(role=s.name, from_s=s.from_s, to_s=s.to_s, from_bar=s.from_bar, to_bar=s.to_bar, nth=s.nth,
                        like=s.like, rise=s.rise, fullness=s.fullness, stems=dict(s.stems)))
    if not cues:
        return cues
    cues.sort(key=lambda c: c.from_s)
    cues[0].from_s = 0.0                                   # lead-in before the first bar belongs to the first cue
    cues[-1].to_s = max(cues[-1].to_s, sc.duration)        # and the last cue runs to the end of the audio
    # builds: a rising non-drop section right before a drop; at most build_max_bars of it
    out = []
    for i, c in enumerate(cues):
        nxt = cues[i + 1] if i + 1 < len(cues) else None
        if nxt is not None and nxt.role in DROP_NAMES and c.role not in DROP_NAMES and c.role != "intro" and _is_rising(sc, c):
            n = min(build_max_bars, c.to_bar - c.from_bar)
            rb = _rise_signal_bar(sc, c.from_bar, c.to_bar)
            if rb is not None:
                n = min(c.to_bar - c.from_bar, max(2, c.to_bar - rb))     # start the build where the rise is declared
            if n >= c.to_bar - c.from_bar:
                c.role = "build"
                out.append(c)
            else:
                split_bar = c.to_bar - n
                split_s = sc.t(split_bar)
                head = Cue(role=c.role, from_s=c.from_s, to_s=split_s, from_bar=c.from_bar, to_bar=split_bar, nth=c.nth,
                           like=c.like, rise=c.rise, fullness=c.fullness, stems=dict(c.stems))
                tail = Cue(role="build", from_s=split_s, to_s=c.to_s, from_bar=split_bar, to_bar=c.to_bar, nth=c.nth,
                           like=c.like, rise=c.rise, fullness=c.fullness, stems=dict(c.stems))
                out += [head, tail]
        else:
            out.append(c)
    cues = out
    # drops: numbering, escalation, dropout bars
    drops = [c for c in cues if c.role in DROP_NAMES]
    for k, c in enumerate(drops):
        c.drop_no, c.n_drops, c.final = k + 1, len(drops), k == len(drops) - 1
        c.intensity = 0.55 + 0.45 * (k / (len(drops) - 1)) if len(drops) > 1 else 0.8
        e = sc.lane_bars("energy", c.from_bar, c.to_bar)
        med = statistics.median(e) if e else 0.0
        for b in range(c.from_bar + 1, c.to_bar):
            if e[b - c.from_bar] < BREAK_RATIO * med:
                reenter = b + 1 < c.to_bar
                if c.breaks and abs(c.breaks[-1][1] - sc.t(b)) < 1e-6:
                    c.breaks[-1] = (c.breaks[-1][0], sc.t(b + 1), reenter)
                else:
                    c.breaks.append((sc.t(b), sc.t(b + 1), reenter))
    # lane statistics, neighbours, moments
    for i, c in enumerate(cues):
        e = sc.lane_bars("energy", c.from_bar, c.to_bar)
        c.energy = sum(e) / len(e) if e else 0.0
        if c.role not in DROP_NAMES:
            c.intensity = min(1.0, 0.3 + c.energy)
        br = sc.lane_bars("brightness", c.from_bar, c.to_bar, default=1.0)
        c.brightness_min = min(br) if br else 1.0
        c.prev_role = cues[i - 1].role_key if i > 0 else None
        c.next_role = cues[i + 1].role_key if i + 1 < len(cues) else None
        c.moments = [m for m in sc.moments if c.contains(m.t_s)]
    return cues


def _draw(cands, rng):
    total = sum(w for _, w in cands)
    r = rng.random() * total
    for e, w in cands:
        r -= w
        if r <= 0:
            return e.name
    return cands[-1][0].name


def _material_key(c):
    """Cues that should get the SAME look. Drops and the final drop share by `like`, so the
    last chorus is lit like the first only bigger, not with an unrelated finale look."""
    family = "drop" if c.role in DROP_NAMES else c.role_key
    return (family, c.like if c.like else c.role_key)


def _candidates(layer, members):
    """Effects of `layer` that suit EVERY cue sharing a material (so the shared look fits
    the drop and the final drop alike), weighted by their weakest suitability across them."""
    pool = [(e, min(e.suits.get(c.role_key, 0.0) for c in members))
            for e in LIBRARY.values()
            if e.layer == layer and all(e.suits.get(c.role_key, 0.0) > 0 and e.fits(c) for c in members)]
    if pool:
        return pool
    c = members[0]                                              # fall back to the first member's role alone
    pool = [(e, e.suits[c.role_key]) for e in LIBRARY.values() if e.layer == layer and c.role_key in e.suits]
    return pool or [(e, 1.0) for e in LIBRARY.values() if e.layer == layer]


def choose(cues, seed=1, overrides=None):
    """Assign par / head / events / params to every cue. Deterministic for a seed."""
    rng = random.Random(seed)
    groups = {}
    for c in cues:
        groups.setdefault(_material_key(c), []).append(c)
    drawn = {}
    for key, members in groups.items():
        drawn[key] = (_draw(_candidates("par", members), rng), _draw(_candidates("head", members), rng))
    for c in cues:
        c.par, c.head = drawn[_material_key(c)]
        c.events = [n for n in EVENT_ORDER if LIBRARY[n].fits(c)]
        c.params = {"palette": ROLE_PALETTE.get(c.role_key, "cool")}
    for i, c in enumerate(cues):
        o = (overrides or {}).get(str(i)) or (overrides or {}).get(f"{c.role}#{c.nth}")
        if o:
            apply_override(c, o)
    return cues


def apply_override(c, o):
    if o.get("par") in LIBRARY:
        c.par = o["par"]
    if o.get("head") in LIBRARY:
        c.head = o["head"]
    if "events" in o:
        c.events = [n for n in EVENT_ORDER if n in o["events"]]
    if "params" in o:
        c.params.update(o["params"])
    if o.get("intensity") is not None:
        c.intensity = max(0.0, min(1.0, float(o["intensity"])))


def plan(sc, seed=1, overrides=None):
    return choose(build_cues(sc), seed, overrides)


def plan_doc(sc, cues, seed=None):
    return {"score": sc.name, "seed": seed, "bar_shift": sc.bar_shift, "bpm": sc.bpm,
            "cues": [dict(i=i, **c.describe()) for i, c in enumerate(cues)]}


def apply_plan(cues, doc):
    """Take par/head/params/intensity from a saved plan, matched by cue index and start bar.
    Events are rule-fired, not a saved choice, so they are always recomputed from the cue --
    that way an event added to the library later shows up on shows planned before it existed."""
    saved = {(p["i"], p["from_bar"]): p for p in doc.get("cues", [])}
    for i, c in enumerate(cues):
        p = saved.get((i, c.from_bar))
        if p:
            apply_override(c, {k: v for k, v in p.items() if k != "events"})
            c.events = [n for n in EVENT_ORDER if LIBRARY[n].fits(c)]
    return cues


def cue_at(cues, t):
    for c in cues:
        if c.contains(t):
            return c
    return None


def table(cues):
    def mmss(x): return f"{int(x // 60)}:{x % 60:05.2f}"
    rows = []
    for i, c in enumerate(cues):
        ev = ",".join(e.replace("_", "-") for e in c.events)
        rows.append(f"{i:2d} {mmss(c.from_s)}-{mmss(c.to_s)} {c.role_key:10s} {c.bars:3d}b I={c.intensity:.2f} "
                    f"par={c.par:<17s} head={c.head:<14s} {ev}")
    return rows
