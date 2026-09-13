"""score.py - read a hub score (bar/beat positions + per-bar lanes) into seconds.

A score says what a song does in musical positions: {bar, beat} on a grid (bpm,
first_beat_s, beats_per_bar, optional tempo map). Sections, phrases and moments sit on
that grid; energy / width / air / pump / pace / brightness and the stem lanes are one
value per bar; chords are one name per bar. This module turns all of it into seconds
for a renderer and hides two conventions that differ between scores:

  * `from_bar` on every per-bar array (bars may start at 0 or 1);
  * `bar_shift`: whole bars added to every score bar before it is read through the
    grid. Levels arrives with its sections and lanes one bar LATE against the audio
    (its beat list carries a constant -2 beat `off_ms`, and the sections were snapped
    forward from those labels). `align_bar_shift()` measures the shift from the audio
    instead of trusting either side; -1 is what it finds for Levels.

    sc = Score(doc, bar_shift=-1)
    sc.t(9, 1)            # seconds of score bar 9 beat 1
    sc.lane("pace", t)    # per-bar lane value at time t (score bar containing t)
    sc.sections           # [Span], seconds already applied
"""
import json
import math
from dataclasses import dataclass, field

DROP_NAMES = ("drop", "chorus")
PER_BAR = ("energy", "width", "air", "pump", "pace", "brightness")
STEMS = ("drums", "bass", "vocals", "other")


@dataclass
class Span:
    name: str
    from_bar: int
    to_bar: int                    # exclusive
    from_s: float
    to_s: float
    nth: int = 1
    like: str = None
    repeat: str = None
    feels: str = ""
    playing: list = field(default_factory=list)
    fullness: float = 0.0
    rise: float = 0.0
    stems: dict = field(default_factory=dict)     # stem -> "none" | "some" | "full"

    @property
    def bars(self): return self.to_bar - self.from_bar


@dataclass
class Phrase:
    from_bar: int
    to_bar: int                    # exclusive
    from_s: float
    to_s: float
    in_: str = ""
    in_nth: int = 1
    doing: str = None
    also: list = field(default_factory=list)
    says: str = ""
    energy: float = 0.0
    rise: float = 0.0
    playing: list = field(default_factory=list)
    has_break: bool = False


@dataclass
class Moment:
    bar: int
    beat: int
    t_s: float
    to_s: float
    is_: str
    what: str = ""
    weight: float = 0.0
    sure: float = 0.0
    for_beats: float = 0.0
    into_bar: int = None       # a transition leads into this bar
    back_at: int = None        # a pause's held part returns at this bar
    after_beats: float = 0.0   # a release resolves this many beats after it is marked
    still: list = field(default_factory=list)   # stems that keep playing through a pause
    extra: dict = field(default_factory=dict)   # pitch / notes / again_of / from, kept verbatim

    @property
    def span_s(self):
        return max(self.to_s - self.t_s, 0.0)


class Score:
    def __init__(self, doc, bar_shift=0):
        if isinstance(doc, str):
            with open(doc) as fh:
                doc = json.load(fh)
        self.doc = doc
        self.bar_shift = int(bar_shift)
        g = doc["grid"]
        self.bpm = float(g["bpm"])
        self.first_beat_s = float(g["first_beat_s"])
        self.bpb = int(g.get("beats_per_bar", 4))
        self.grid_first_bar = int(g.get("first_bar", 0) or 0)
        self.beat_s = 60.0 / self.bpm
        self.bar_s = self.bpb * self.beat_s
        tempo = g.get("tempo") or [{"from_beat": 0, "at_s": self.first_beat_s, "bpm": self.bpm}]
        self.tempo = sorted(({"from_beat": float(s["from_beat"]), "at_s": float(s["at_s"]), "bpm": float(s["bpm"])}
                             for s in tempo), key=lambda s: s["from_beat"])
        song = doc.get("song") or {}
        self.duration = float(song.get("length_s") or 0.0)
        if not self.duration:
            self.duration = self.beat_time((int(g.get("bars", 0)) + 1) * self.bpb)
        self.name = doc.get("score") or song.get("name") or "score"

    # ------------------------------------------------------------- grid <-> time
    def beat_time(self, k):
        """Seconds of grid beat number k (0 = first_beat_s), through the tempo map."""
        seg = self.tempo[0]
        for s in self.tempo:
            if s["from_beat"] <= k:
                seg = s
        return seg["at_s"] + (k - seg["from_beat"]) * 60.0 / seg["bpm"]

    def beat_at(self, t):
        """Grid beat number (float) at time t."""
        seg = self.tempo[0]
        for s in self.tempo:
            if s["at_s"] <= t:
                seg = s
        return seg["from_beat"] + (t - seg["at_s"]) * seg["bpm"] / 60.0

    def t(self, bar, beat=1.0):
        """Seconds of score position (bar, beat) with the bar shift applied."""
        k = (bar + self.bar_shift - self.grid_first_bar) * self.bpb + (beat - 1.0)
        return self.beat_time(k)

    def bar_at(self, t):
        """Score bar number containing t (lanes index by this)."""
        return int(math.floor(self.beat_at(t) / self.bpb + 1e-9)) + self.grid_first_bar - self.bar_shift

    def bar_phase(self, t):
        return (self.beat_at(t) / self.bpb) % 1.0

    def beat_index(self, t):
        return int(math.floor(self.beat_at(t) + 1e-9))

    def beat_phase(self, t):
        return self.beat_at(t) % 1.0

    def beat_in_bar(self, t):
        """0..bpb-1 within the (shifted) bar."""
        return self.beat_index(t) % self.bpb

    # ------------------------------------------------------------- per-bar lanes
    def _lane(self, name):
        d = self.doc
        if name in STEMS:
            st = d.get("stems") or {}
            vals = (st.get("lanes") or {}).get(name)
            if vals is None:
                vals = (d.get("layers") or {}).get(name)
            return int(st.get("from_bar", self.grid_first_bar) or 0), vals or []
        v = d.get(name)
        if isinstance(v, dict):
            return int(v.get("from_bar", self.grid_first_bar) or 0), v.get("values") or []
        if isinstance(v, list):
            cur = (d.get("curves") or {}).get(name) or {}
            fb = cur.get("from_bar")
            if fb is None:
                e = d.get("energy")
                fb = e.get("from_bar", self.grid_first_bar) if isinstance(e, dict) else self.grid_first_bar
            return int(fb or 0), v
        cur = (d.get("curves") or {}).get(name)
        if isinstance(cur, dict):
            return int(cur.get("from_bar", self.grid_first_bar) or 0), cur.get("values") or []
        return self.grid_first_bar, []

    def lane_bar(self, name, bar, default=0.0):
        fb, vals = self._lane(name)
        if not vals:
            return default
        i = max(0, min(len(vals) - 1, int(bar) - fb))
        v = vals[i]
        return default if v is None else float(v)

    def lane(self, name, t, default=0.0):
        return self.lane_bar(name, self.bar_at(t), default)

    def lane_smooth(self, name, t, default=0.0):
        """Linear interpolation from this bar's value to the next bar's across the bar."""
        b = self.bar_at(t)
        a, c = self.lane_bar(name, b, default), self.lane_bar(name, b + 1, default)
        u = self.bar_phase(t)
        return a + (c - a) * u

    def lane_bars(self, name, from_bar, to_bar, default=0.0):
        return [self.lane_bar(name, b, default) for b in range(from_bar, to_bar)]

    def chord_bar(self, bar):
        h = self.doc.get("harmony") or {}
        chords = h.get("chords")
        if chords:
            i = int(bar) - int(h.get("from_bar", self.grid_first_bar) or 0)
            return chords[i] if 0 <= i < len(chords) else None
        for c in self.doc.get("chords") or []:
            if isinstance(c, dict) and c.get("bar") == bar:
                return c.get("name")
        return None

    def chord(self, t):
        return self.chord_bar(self.bar_at(t))

    # ------------------------------------------------------------- structure
    def _pos(self, p):
        return int(p["bar"]), int(p.get("beat", 1))

    @property
    def sections(self):
        out = []
        for s in self.doc.get("sections") or []:
            fb, fbeat = self._pos(s["from"])
            tb, tbeat = self._pos(s["to"])
            stems = {k: (v.get("is") if isinstance(v, dict) else v) for k, v in (s.get("stems") or {}).items()}
            out.append(Span(name=s.get("name") or "section", from_bar=fb, to_bar=tb,
                            from_s=self.t(fb, fbeat), to_s=min(self.duration, self.t(tb, tbeat)),
                            nth=int(s.get("nth") or 1), like=s.get("like"), repeat=s.get("repeat"),
                            feels=s.get("feels") or "", playing=list(s.get("playing") or []),
                            fullness=float(s.get("fullness") or 0.0), rise=float(s.get("rise") or 0.0), stems=stems))
        return out

    @property
    def phrases(self):
        out = []
        for p in self.doc.get("phrases") or []:
            fb, tb = int(p["from_bar"]), int(p["to_bar"]) + 1
            out.append(Phrase(from_bar=fb, to_bar=tb, from_s=self.t(fb), to_s=min(self.duration, self.t(tb)),
                              in_=p.get("in") or "", in_nth=int(p.get("in_nth") or 1), doing=p.get("doing"),
                              also=list(p.get("also") or []), says=p.get("says") or "",
                              energy=float(p.get("energy") or 0.0), rise=float(p.get("rise") or 0.0),
                              playing=list(p.get("playing") or []), has_break=bool(p.get("has_break"))))
        return out

    _EXTRA = ("pitch", "notes", "again_of", "from", "into_bar", "back_at", "still", "after_beats")

    def _moment(self, m, bar, beat):
        t0 = self.t(bar, beat)
        fbts = float(m.get("for_beats") or 0.0)
        return Moment(bar=bar, beat=beat, t_s=t0, to_s=t0 + max(fbts, 1.0) * self.beat_s, is_=m.get("is") or "",
                      what=m.get("what") or "", weight=float(m.get("weight") or 0.0), sure=float(m.get("sure") or 0.0),
                      for_beats=fbts, into_bar=m.get("into_bar"), back_at=m.get("back_at"),
                      after_beats=float(m.get("after_beats") or 0.0), still=list(m.get("still") or []),
                      extra={k: m[k] for k in self._EXTRA if k in m and k not in ("into_bar", "back_at", "still", "after_beats")})

    @property
    def moments(self):
        return [self._moment(m, *self._pos(m["at"])) for m in self.doc.get("moments") or []]

    @property
    def signals(self):
        """The full detector list (a superset of `moments`: fill / accent / entrance / exit /
        rise / hook / change / highlight / transition / pause / release), each positioned by
        its own bar/beat rather than an `at` object."""
        out = []
        for m in self.doc.get("signals") or []:
            if "bar" not in m:
                continue
            out.append(self._moment(m, int(m["bar"]), int(m.get("beat", 1))))
        return out

    # ------------------------------------------------------------- per-beat lanes
    def _beat_lane(self, name):
        v = self.doc.get(name)
        if isinstance(v, dict) and v.get("per") == "beat":
            return int(v.get("from_bar", self.grid_first_bar) or 0), int(v.get("from_beat", 1) or 1), v.get("values") or []
        return self.grid_first_bar, 1, []

    def bar_of_beat(self, k):
        """Score bar that grid-beat index k falls in (bar_shift applied, like bar_at)."""
        return int(math.floor(k / self.bpb)) + self.grid_first_bar - self.bar_shift

    def beat_lane_at(self, name, bar, beat, default=None):
        fb, fbe, vals = self._beat_lane(name)
        if not vals:
            return default
        idx = (int(bar) - fb) * self.bpb + (int(beat) - fbe)
        if idx < 0 or idx >= len(vals):
            return default
        v = vals[idx]
        return default if v is None else float(v)

    def tension(self, t, default=0.0):
        """The per-beat tension value for the beat containing t (0..1)."""
        v = self.beat_lane_at("tension", self.bar_at(t), self.beat_in_bar(t) + 1)
        return default if v is None else v

    def tension_bar(self, bar, default=0.0):
        """Mean tension across a score bar."""
        vals = [self.beat_lane_at("tension", bar, b, None) for b in range(1, self.bpb + 1)]
        vals = [v for v in vals if v is not None]
        return sum(vals) / len(vals) if vals else default

    def rises(self):
        """Spans (from_s, to_s) the score marks as a rise/build, from its stated length."""
        out = []
        for s in self.signals + self.moments:
            if s.is_ in ("rise", "build") and s.for_beats:
                out.append((s.t_s, s.t_s + s.for_beats * self.beat_s))
        return sorted(set(out))

    def ramp(self, t, default=None):
        """Progress 0..1 through the rise span covering t (the run the score declared),
        or `default` when no rise is active."""
        for a, b in self.rises():
            if a <= t < b:
                return (t - a) / max(b - a, 1e-9)
        return default

    def grid_beats(self):
        """Grid beat times inside the song, and the downbeats among them (shift applied,
        so a downbeat is beat 1 of a score bar)."""
        beats, downs = [], []
        k0 = int(math.floor(self.beat_at(0.0)))
        k = k0
        while True:
            t = self.beat_time(k)
            if t >= self.duration:
                break
            if t >= 0:
                beats.append(round(t, 4))
                if (k % self.bpb) == 0:
                    downs.append(round(t, 4))
            k += 1
        return beats, downs


# ------------------------------------------------------------------- alignment
def align_bar_shift(doc, wav_path, candidates=(-1, 0, 1), sr_target=22050):
    """Measure which whole-bar shift makes the score's drum entrances/exits coincide with
    bass-energy jumps in the audio. Returns (best_shift, {shift: score_dB}). Needs
    soundfile + librosa (the analysis venv)."""
    import numpy as np
    import soundfile as sf
    import librosa

    y, sr = sf.read(wav_path, dtype="float32", always_2d=True)
    y = y.mean(axis=1)
    if sr != sr_target:
        y = librosa.resample(y, orig_sr=sr, target_sr=sr_target)
        sr = sr_target
    hop = 512
    S = np.abs(librosa.stft(y, n_fft=1024, hop_length=hop)) ** 2
    freqs = librosa.fft_frequencies(sr=sr, n_fft=1024)
    bass = S[freqs < 120].sum(axis=0)

    def db_between(t0, t1):
        f0, f1 = int(max(0, t0) * sr / hop), int(max(0, t1) * sr / hop)
        if f1 <= f0 or f0 >= len(bass):
            return None
        return 10 * math.log10(float(bass[f0:min(f1, len(bass))].mean()) + 1e-9)

    base = Score(doc, 0)
    edges = []
    secs = base.sections
    for a, b in zip(secs, secs[1:]):
        da, db_ = a.stems.get("drums"), b.stems.get("drums")
        if da == db_:
            continue
        sign = 1.0 if db_ == "full" or (da == "none" and db_ == "some") else -1.0
        edges.append((b.from_bar, sign))
    table = {}
    for shift in candidates:
        sc = Score(doc, shift)
        total = 0.0
        for bar, sign in edges:
            t = sc.t(bar)
            before, after = db_between(t - sc.bar_s, t), db_between(t, t + sc.bar_s)
            if before is None or after is None:
                continue
            total += sign * (after - before)
        table[shift] = round(total, 2)
    best = max(table, key=table.get) if table else 0
    return best, table
