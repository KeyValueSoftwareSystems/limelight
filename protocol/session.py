"""A session: the container's side of the protocol. The Python half.

This is a port of session.js, and it has to stay a port. Two readers of one
score that disagree by a bar is the failure this project keeps finding, so
session_parity.test.js runs both against the same file and fails if a single
answer differs.

Two clocks live here and keeping them apart is the design:

  the SCORE clock   song seconds -> musical position. Fixed forever. Rate never
                    touches it. Bar 12 beat 3 sits at the same song-second
                    whatever speed the record is played at.

  the TRANSPORT     wall time -> song seconds. Rate lives here and only here.
                    Play, pause and seek are facts about this clock, and the
                    score never hears about them.

The transport is the part that has been getting shows out of sync, because a
transport that counts wall seconds is guessing where the music is rather than
asking. Hand `song_time` a clock that measures -- see clock.py -- and the
guessing stops. Nothing else in this file changes.

    s = Session(score, song_time=clock.position)
    s.now()          -> {"position": {"bar":..,"beat":..}, "phase":.., ...}
    s.next(2000)     -> [{"bar":..,"beat":..,"accent":..,"in_ms":..}, ...]
"""

import json
import math
import time


def _fx(x, n):
    """JS `+x.toFixed(n)`: round to n places and come back as a number."""
    return float(f"{x:.{n}f}")


def _or(v, d):
    """Default on absence, never on falsiness.

    Bar 0 and beat 0 are real values, and `v or d` turns both into d. That is
    the one-bar error that grid.first_bar was introduced to kill, wearing a
    different hat: a 0-based score read its energy a whole bar late, and a
    phrase grid anchored at bar 0 snapped to bar 1.
    """
    return d if v is None else v


def _mod(x, m):
    return ((x % m) + m) % m


class Session:
    def __init__(self, score, now=None, song_time=None):
        score = _adapt(score)
        g = (score or {}).get("grid") or {}
        self.bpm = g.get("bpm")
        if not self.bpm:
            raise ValueError("a score needs grid.bpm")
        self.bpb = _or(g.get("beats_per_bar"), 4)
        self.first = _or(g.get("first_beat_s"), 0.0)
        # Which number the first bar carries. Some songs open on a pickup and
        # call it bar 0; others call it bar 1. The score states it, so we read
        # it and renumber nothing: bar 33 here is bar 33 in the score, in the
        # pipeline, and in any conversation about the song.
        self.first_bar = _or(g.get("first_bar"), 1)

        self.beat_s = 60.0 / self.bpm  # song seconds per beat, never scaled
        self.bar_s = self.beat_s * self.bpb
        # A song may change tempo. grid.tempo is the map: from beat `from_beat`
        # onward, which lands at `at_s`, the tempo is `bpm`. A score without one
        # is a song that never changes tempo, which is a map of length one -- so
        # everything walks the map and there is no second path to keep in step.
        self.tempo = sorted(
            g.get("tempo") or [{"from_beat": 0, "at_s": self.first, "bpm": self.bpm}],
            key=lambda x: x["from_beat"],
        )

        # The tempo map is a fit; the beat list is the measurement. Where a
        # measured beat exists it wins, which keeps this in step with
        # session.js -- the parity suite compares the two answer for answer.
        struck = []
        for b in (score.get("beats") or []) if isinstance(score, dict) else []:
            t = b.get("t") if isinstance(b, dict) else b
            if isinstance(t, (int, float)):
                struck.append(float(t))
        self._struck = struck

        self._wall = now or (lambda: time.monotonic())
        # A real music container already has a clock, and the thing playing the
        # audio knows its position better than we ever will. When one is handed
        # to us we read it instead of running a second clock beside it.
        self._song_time = song_time

        self.score = score
        self.layers = (score or {}).get("layers") or {}
        self._energy = (score or {}).get("energy")

        self.playing = False
        self._rate = 1.0
        self._held = 0.0  # song seconds, while paused
        self._since = self._wall()

    # ---- song seconds. The only place rate appears. ------------------------
    def seconds(self):
        if self._song_time:
            return float(self._song_time())
        if self.playing:
            return self._held + (self._wall() - self._since) * self._rate
        return self._held

    # ---- the score clock: pure, and rate cannot reach it -------------------
    @staticmethod
    def _snap(x):
        """Pull a beat count that is a hair off a boundary back onto it.

        Bar 61 of a 127.999 bpm song comes back out of seconds_at as
        60.99999999999999, and a bare floor then answers bar 60 -- a whole bar
        early, for a song that was never wrong. The tolerance is a billionth of
        a beat, under a microsecond, so it can absorb arithmetic error and
        never a real measurement.
        """
        return round(x) if abs(x - round(x)) < 1e-9 else x

    def _seg_at_beat(self, n):
        k = 0
        while k + 1 < len(self.tempo) and self.tempo[k + 1]["from_beat"] <= n:
            k += 1
        return self.tempo[k]

    def _seg_at_time(self, t):
        k = 0
        while k + 1 < len(self.tempo) and self.tempo[k + 1]["at_s"] <= t:
            k += 1
        return self.tempo[k]

    def _at_beat(self, n):
        k = self._struck
        if len(k) > 1 and 0 <= n <= len(k) - 1:
            lo = int(math.floor(n))
            frac = n - lo
            if frac < 1e-9:
                return k[lo]
            if lo + 1 < len(k):
                return k[lo] + (k[lo + 1] - k[lo]) * frac
        s = self._seg_at_beat(n)
        return s["at_s"] + (n - s["from_beat"]) * (60.0 / s["bpm"])

    def _beat_at(self, t):
        k = self._struck
        if len(k) > 1 and k[0] <= t <= k[-1]:
            lo, hi = 0, len(k) - 1
            while hi - lo > 1:
                mid = (lo + hi) // 2
                if k[mid] <= t:
                    lo = mid
                else:
                    hi = mid
            span = k[hi] - k[lo]
            return lo + ((t - k[lo]) / span if span > 0 else 0.0)
        s = self._seg_at_time(t)
        return s["from_beat"] + (t - s["at_s"]) / (60.0 / s["bpm"])

    def position_at(self, t):
        i = self._snap(self._beat_at(t))
        return {
            "bar": 1 + int(math.floor(i / self.bpb)),
            "beat": _fx(_mod(i, self.bpb) + 1, 4),
            "before_first_beat": t < self.first,
        }

    def seconds_at(self, bar, beat=1):
        # Bar 1 begins on the first downbeat. With first_bar 0 that bar is the
        # pickup BEFORE it, so anchoring there put every cue one bar late.
        return self._at_beat((bar - 1) * self.bpb + (_or(beat, 1) - 1))

    def _index(self, t):
        return self._snap(self._beat_at(t))

    def _from_index(self, i):
        return {"bar": 1 + int(math.floor(i / self.bpb)), "beat": _mod(i, self.bpb) + 1}

    # ---- sections, in layers ----------------------------------------------
    def _at(self, q):
        return (q["bar"] - 1) * self.bpb + (_or(q.get("beat"), 1) - 1)

    def _covers(self, sp, x):
        return self._at(sp["from"]) <= x < self._at(sp["to"])

    def sections_at(self, pos):
        x = self._at(pos)
        found = {}
        for name, L in self.layers.items():
            if L.get("kind") == "rule":
                n, frm = _or(L.get("every_bars"), 8), _or(L.get("from_bar"), 1)
                # Before the anchor there is no phrase to be in -- an intro is a
                # pickup, not phrase zero. Say nothing rather than a number.
                if pos["bar"] < frm:
                    found[name] = None
                    continue
                i = int(math.floor((pos["bar"] - frm) / n))
                found[name] = {
                    "index": i + 1,
                    "from": {"bar": frm + i * n, "beat": 1},
                    "to": {"bar": frm + (i + 1) * n, "beat": 1},
                    "through": _fx(
                        (((pos["bar"] - frm) % n) + (pos["beat"] - 1) / self.bpb) / n, 4
                    ),
                }
                continue
            hit = [sp for sp in (L.get("spans") or []) if self._covers(sp, x)]
            # a partition can only be in one place at a time; everything else is
            # a list, because overlap is the point of having layers at all
            found[name] = (
                (hit[0] if hit else None) if L.get("kind") == "partition" else hit
            )
        return found

    def until(self, layer, pos=None):
        q = pos or self.position_at(self.seconds())
        f = self.sections_at(q).get(layer)
        sp = (f[0] if f else None) if isinstance(f, list) else f
        if not sp or not sp.get("to"):
            return None
        left = self._at(sp["to"]) - self._at(q)
        return {
            "name": sp.get("name"),
            "ends_at": sp["to"],
            "bars": _fx(left / self.bpb, 3),
            "in_ms": round(left * self.beat_s / self._rate * 1000),
        }

    # ---- energy: one number per bar, interpolated here ---------------------
    def energy_at(self, pos):
        EN = self._energy
        if not EN or not EN.get("values"):
            return None
        v = EN["values"]
        x = (pos["bar"] - _or(EN.get("from_bar"), 1)) + (pos["beat"] - 1) / self.bpb
        if x <= 0:
            return v[0]
        if x >= len(v) - 1:
            return v[-1]
        i = int(math.floor(x))
        return _fx(v[i] + (v[i + 1] - v[i]) * (x - i), 4)

    # ---- the two questions a container actually asks -----------------------
    def now(self):
        t = self.seconds()
        within = _mod(self._index(t), 1)  # 0 exactly on the beat
        pos = self.position_at(t)
        return {
            "playing": self.playing,
            "rate": self._rate,
            "seconds": _fx(t, 4),
            "position": pos,
            "phase": _fx(within, 4),
            "to_next_beat_ms": round((1 - within) * self.beat_s / self._rate * 1000),
            "energy": self.energy_at(pos),
            "sections": self.sections_at(pos),
        }

    def next(self, lead_ms):
        """What is coming in the next stretch of the CALLER'S time.

        A container asks in its own milliseconds because that is what it will
        schedule against, and rate is applied once, here, at the boundary.
        """
        t = self.seconds()
        ahead = (lead_ms / 1000.0) * self._rate
        i0, i1 = self._index(t), self._index(t + ahead)
        out = []
        for i in range(int(math.ceil(i0)), int(math.ceil(i1))):
            p = self._from_index(i)
            out.append(
                {
                    "bar": p["bar"],
                    "beat": p["beat"],
                    "accent": p["beat"] == 1,
                    "in_ms": round(
                        (self.seconds_at(p["bar"], p["beat"]) - t) / self._rate * 1000
                    ),
                }
            )
        p0, p1 = self.position_at(t), self.position_at(t + ahead)
        a0, a1 = self._at(p0), self._at(p1)

        def ms(q):
            return round(
                (self.seconds_at(q["bar"], q.get("beat", 1)) - t) / self._rate * 1000
            )

        def inside(q):
            return a0 <= self._at(q) < a1

        # Boundaries matter as much as beats. Anything with lead time needs to
        # know a section ends in 900 ms, not to find out once it already has.
        for name, L in self.layers.items():
            if L.get("kind") == "rule":
                continue
            for sp in L.get("spans") or []:
                if inside(sp["from"]):
                    out.append(
                        {
                            "what": name + " starts",
                            "layer": name,
                            "name": sp.get("name"),
                            "bar": sp["from"]["bar"],
                            "beat": sp["from"]["beat"],
                            "in_ms": ms(sp["from"]),
                        }
                    )
                if inside(sp["to"]):
                    out.append(
                        {
                            "what": name + " ends",
                            "layer": name,
                            "name": sp.get("name"),
                            "bar": sp["to"]["bar"],
                            "beat": sp["to"]["beat"],
                            "in_ms": ms(sp["to"]),
                        }
                    )
        for mo in self.score.get("moments") or []:
            at = mo.get("at")
            if not at:
                continue
            if inside(at):
                what = mo.get("kind") or mo.get("type")
                out.append(
                    {
                        "what": what,
                        "layer": "moment",
                        "name": what,
                        "bar": at["bar"],
                        "beat": at["beat"],
                        "in_ms": ms(at),
                    }
                )
        out.sort(key=lambda x: x["in_ms"])
        return out

    # ---- transport. None of this is the score's business. ------------------
    # When the container owns the clock these only record what it told us, so
    # that now() can report playing/rate honestly. The container moves its own
    # audio; we are not going to fight it for control of the playhead.
    def play(self):
        if not self.playing:
            if not self._song_time:
                self._held, self._since = self.seconds(), self._wall()
            self.playing = True
        return self

    def pause(self):
        if self.playing:
            if not self._song_time:
                self._held = self.seconds()
            self.playing = False
        return self

    def seek(self, t):
        if not self._song_time:
            self._held, self._since = t, self._wall()
        return self

    def rate(self, r=None):
        if r is None:
            return self._rate
        if not self._song_time:
            self._held, self._since = self.seconds(), self._wall()
        self._rate = r
        return self


# ---- reading the pipeline's shape -----------------------------------------
def _position_of(sc, t):
    g = sc["grid"]
    n = _or(g.get("beats_per_bar"), 4)
    tempo = g.get("tempo") or [
        {"from_beat": 0, "at_s": g["first_beat_s"], "bpm": g["bpm"]}
    ]
    k = 0
    while k + 1 < len(tempo) and tempo[k + 1]["at_s"] <= t:
        k += 1
    b = (tempo[k]["from_beat"] + (t - tempo[k]["at_s"]) / (60.0 / tempo[k]["bpm"])) / n
    return {"bar": 1 + int(math.floor(b)), "beat": _fx(_mod(b, 1) * n + 1, 3)}


def _adapt(sc):
    """Read the pipeline's score shape directly, once, at the edge.

    Two shapes exist: the pipeline writes `parts` and `bars.intensity`, this
    library was written against `layers` and `energy`. Keeping two formats in
    step by hand is how the two scores for Levels ended up 9.89 beats apart
    without anything failing.
    """
    secs = sc.get("sections") if sc else None
    if (
        sc
        and isinstance(secs, list)
        and secs
        and not secs[0].get("from")
        and not (sc.get("layers") or {}).get("form")
    ):
        grid = sc.get("grid") or {}
        per = grid.get("beats_per_bar") or 4
        base = _or(grid.get("first_bar"), 1)
        tempo = grid.get("tempo") or [
            {
                "from_beat": 0,
                "at_s": grid.get("first_beat_s") or 0,
                "bpm": grid.get("bpm") or 120,
            }
        ]

        def _put(t):
            k = 0
            while k + 1 < len(tempo) and tempo[k + 1]["at_s"] <= t:
                k += 1
            seg = tempo[k]
            n = int(round(seg["from_beat"] + (t - seg["at_s"]) / (60.0 / seg["bpm"])))
            return {"bar": max(base, 1 + n // per), "beat": 1 + (n % per)}

        sc = dict(sc)
        layers = dict(sc.get("layers") or {})
        layers["form"] = {
            "kind": "partition",
            "note": "from `sections`, placed on the tempo map.",
            "spans": [
                {
                    "from": _put(x["start"]),
                    "to": _put(x["end"]),
                    "name": x.get("label"),
                    "nth": i + 1,
                    "like": x.get("label"),
                }
                for i, x in enumerate(secs)
            ],
        }
        sc["layers"] = layers

    moments = (sc.get("moments") or []) if sc else []
    if moments and not (moments[0].get("at")):
        sc = dict(sc)
        sc["moments"] = [
            {
                "at": (
                    _position_of(sc, m["time_s"])
                    if m.get("time_s") is not None
                    else {"bar": m.get("bar"), "beat": m.get("beat")}
                ),
                "kind": m.get("is") if m.get("is") is not None else m.get("type"),
                "what": m.get("what"),
                "weight": (
                    m.get("weight")
                    if m.get("weight") is not None
                    else m.get("intensity")
                ),
                "sure": m.get("sure"),
                **({"description": m["description"]} if m.get("description") else {}),
                **({"with": m["with"]} if m.get("with") else {}),
                **({"for_beats": m["for_beats"]} if m.get("for_beats") else {}),
                **({"back_at": m["back_at"]} if m.get("back_at") is not None else {}),
                **(
                    {"into_bar": m["into_bar"]} if m.get("into_bar") is not None else {}
                ),
            }
            for m in moments
        ]

    if not sc or sc.get("layers") or not sc.get("parts"):
        return sc
    out = dict(sc)
    out["layers"] = {
        "form": {
            "kind": "partition",
            "note": "from `parts`. Bars are not renumbered -- grid.first_bar says "
            "where they start. `to_bar` is inclusive, so the half-open end is +1.",
            "spans": [
                {
                    "from": {"bar": p["from_bar"], "beat": 1},
                    "to": {"bar": p["to_bar"] + 1, "beat": 1},
                    # role is the bare word and `nth` carries the occurrence.
                    # Matching on the role string used to miss every drop after
                    # the first, because the string was "drop 2". Keep them apart.
                    "name": p.get("role"),
                    "nth": p.get("nth"),
                    "like": p.get("like"),
                    "returns": p.get("returns"),
                    "feels": p.get("feels"),
                    "fullness": p.get("fullness"),
                }
                for p in sc["parts"]
            ],
        }
    }
    inten = (sc.get("bars") or {}).get("intensity")
    if inten:
        out["energy"] = {
            "per": "bar",
            "from_bar": _or((sc.get("grid") or {}).get("first_bar"), 1),
            "values": inten,
            "note": "from `bars.intensity`",
        }
    # The weighted moments are the real ones. Mapping releases over the top
    # discarded every one of them before a reader saw it -- the same bug the
    # JS half had, and the reason the two halves disagreed on how many events
    # are coming.
    moments = sc.get("moments") or []
    if moments and not (moments[0].get("at")):
        out["moments"] = [
            {
                "at": {"bar": m.get("bar"), "beat": m.get("beat")},
                "kind": m.get("is"),
                "what": m.get("what"),
                "weight": m.get("weight"),
                "sure": m.get("sure"),
                **({"for_beats": m["for_beats"]} if m.get("for_beats") else {}),
                **({"back_at": m["back_at"]} if m.get("back_at") is not None else {}),
                **(
                    {"into_bar": m["into_bar"]} if m.get("into_bar") is not None else {}
                ),
            }
            for m in moments
        ]
    elif sc.get("releases"):
        out["moments"] = [
            {"at": _position_of(sc, r["at_s"]), "kind": "drop", "size": r.get("size")}
            for r in sc["releases"]
        ]
    return out


def load(path):
    with open(path) as f:
        return Session(json.load(f))
